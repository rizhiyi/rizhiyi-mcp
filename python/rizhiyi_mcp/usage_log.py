from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from threading import RLock
from typing import Callable, Literal

UsageLogRotateInterval = Literal["1d", "1h"]
UsageLogStatus = Literal["ok", "ok-limited", "error"]

# 清理降频阈值：没有超额文件时，最多每 N 次写入或每 60s 执行一次清理。
_CLEANUP_EVERY_WRITES = 50
_CLEANUP_MIN_INTERVAL_SECONDS = 60.0


@dataclass(frozen=True, slots=True)
class UsageLogConfig:
    directory: Path
    name_prefix: str
    rotate_bytes: int
    rotate_interval: UsageLogRotateInterval
    keep_files: int


@dataclass(frozen=True, slots=True)
class UsageLogEntry:
    ts: str
    epoch_ms: int
    session_id: str | None
    serverName: str
    tool: str
    routeName: str
    status: UsageLogStatus
    duration_ms: int
    user: str | None
    error_code: str | None
    guardrail_action: str | None = None
    guardrail_risk_score: int | None = None
    guardrail_denied_commands: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class _LogFile:
    path: Path
    date_key: str
    sequence: int
    size: int
    modified_seconds: float


class UsageLogger:
    def __init__(
        self,
        config: UsageLogConfig,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.config = config
        self._clock = clock or (lambda: datetime.now().astimezone())
        self._lock = RLock()
        self._active_bucket: str | None = None
        self._active_path: Path | None = None
        # (目录 mtime 纳秒, 文件清单)。按目录 mtime 失效，因此外部进程新建文件后会被发现。
        self._file_cache: tuple[int, list[_LogFile]] | None = None
        self._writes_since_cleanup = 0
        self._last_cleanup_seconds: float | None = None
        self._filename_pattern = re.compile(
            rf"^{re.escape(config.name_prefix)}-(\d{{8}})(?:\.(\d+))?\.log$"
        )

    async def write(self, entry: UsageLogEntry) -> None:
        await asyncio.to_thread(self.write_sync, entry)

    def write_sync(self, entry: UsageLogEntry) -> None:
        with self._lock:
            self.config.directory.mkdir(parents=True, exist_ok=True)
            line = json.dumps(asdict(entry), ensure_ascii=False, separators=(",", ":")) + "\n"
            line_bytes = len(line.encode("utf-8"))
            now = self._ensure_local(self._clock())
            active_path = self._resolve_active_path(now, line_bytes)
            with active_path.open("a", encoding="utf-8") as stream:
                stream.write(line)
            self._note_appended(active_path, line_bytes, now)
            self._cleanup_old_files(active_path, now)

    def _resolve_active_path(self, now: datetime, line_bytes: int) -> Path:
        date_key = now.strftime("%Y%m%d")
        bucket_key = (
            date_key
            if self.config.rotate_bytes > 0
            else self._format_time_bucket(now)
        )

        # 快路径：active 缓存命中且文件缓存新鲜时直接复用，无需任何目录扫描。
        # 缓存按目录 mtime 失效，因此外部进程新建文件后这里会自然回退到慢路径。
        if self._active_bucket == bucket_key and self._active_path is not None:
            cached = self._cached_file(self._active_path)
            if cached is not None and (
                self.config.rotate_bytes <= 0
                or cached.size == 0
                or cached.size + line_bytes <= self.config.rotate_bytes
            ):
                return self._active_path

        files = self._list_log_files()
        today_files = sorted(
            (item for item in files if item.date_key == date_key),
            key=self._sort_key,
        )
        latest = today_files[-1] if today_files else None

        if self.config.rotate_bytes > 0:
            if latest is None:
                active_path = self._file_path(date_key, 0)
            elif latest.size == 0 or latest.size + line_bytes <= self.config.rotate_bytes:
                active_path = latest.path
            else:
                active_path = self._file_path(date_key, latest.sequence + 1)
        elif latest is None:
            active_path = self._file_path(date_key, 0)
        else:
            modified = datetime.fromtimestamp(latest.modified_seconds).astimezone()
            if self._format_time_bucket(modified) == bucket_key:
                active_path = latest.path
            else:
                active_path = self._file_path(date_key, latest.sequence + 1)

        self._active_bucket = bucket_key
        self._active_path = active_path
        return active_path

    def _list_log_files(self) -> list[_LogFile]:
        dir_mtime_ns = self._directory_mtime_ns()
        if dir_mtime_ns is None:
            self._file_cache = None
            return []
        if self._file_cache is not None and self._file_cache[0] == dir_mtime_ns:
            return self._file_cache[1]

        files: list[_LogFile] = []
        for path in self.config.directory.iterdir():
            match = self._filename_pattern.fullmatch(path.name)
            if match is None:
                continue
            try:
                info = path.stat()
            except FileNotFoundError:
                continue
            if not path.is_file():
                continue
            files.append(
                _LogFile(
                    path=path,
                    date_key=match.group(1),
                    sequence=int(match.group(2) or 0),
                    size=info.st_size,
                    modified_seconds=info.st_mtime,
                )
            )
        self._file_cache = (dir_mtime_ns, files)
        return files

    def _directory_mtime_ns(self) -> int | None:
        try:
            return self.config.directory.stat().st_mtime_ns
        except FileNotFoundError:
            return None

    def _cached_file(self, path: Path) -> _LogFile | None:
        """仅在文件缓存新鲜（目录 mtime 未变）时返回缓存元数据，否则返回 None。"""
        dir_mtime_ns = self._directory_mtime_ns()
        if dir_mtime_ns is None or self._file_cache is None or self._file_cache[0] != dir_mtime_ns:
            return None
        return next((item for item in self._file_cache[1] if item.path == path), None)

    def _note_appended(self, path: Path, line_bytes: int, now: datetime) -> None:
        """写入后更新缓存中的文件大小，避免快路径基于过期大小重复追加导致超出 rotate_bytes。"""
        if self._file_cache is None:
            return
        files = self._file_cache[1]
        for index, item in enumerate(files):
            if item.path == path:
                files[index] = replace(
                    item,
                    size=item.size + line_bytes,
                    modified_seconds=now.timestamp(),
                )
                return
        # 新建文件会改变目录 mtime，缓存自然失效，下一轮 _list_log_files 会重新扫描。

    def _cleanup_old_files(self, active_path: Path, now: datetime) -> None:
        files = sorted(self._list_log_files(), key=self._sort_key)
        self._writes_since_cleanup += 1
        if not self._should_run_cleanup(len(files), now):
            return

        excess = len(files) - self.config.keep_files
        for item in files:
            if excess <= 0:
                break
            if item.path == active_path:
                continue
            try:
                item.path.unlink()
            except FileNotFoundError:
                pass
            else:
                excess -= 1
        self._writes_since_cleanup = 0
        self._last_cleanup_seconds = now.timestamp()
        # 删除改变了目录，缓存失效。
        self._file_cache = None

    def _should_run_cleanup(self, file_count: int, now: datetime) -> bool:
        if file_count > self.config.keep_files:
            # 存在超额文件时立即清理，保证 keep_files 语义不被降频破坏。
            return True
        if self._writes_since_cleanup >= _CLEANUP_EVERY_WRITES:
            return True
        if self._last_cleanup_seconds is None:
            return False
        return now.timestamp() - self._last_cleanup_seconds >= _CLEANUP_MIN_INTERVAL_SECONDS

    def _file_path(self, date_key: str, sequence: int) -> Path:
        sequence_suffix = f".{sequence}" if sequence > 0 else ""
        return self.config.directory / f"{self.config.name_prefix}-{date_key}{sequence_suffix}.log"

    def _format_time_bucket(self, value: datetime) -> str:
        date_key = value.strftime("%Y%m%d")
        return f"{date_key}{value:%H}" if self.config.rotate_interval == "1h" else date_key

    @staticmethod
    def _sort_key(item: _LogFile) -> tuple[str, int, float, str]:
        return (item.date_key, item.sequence, item.modified_seconds, item.path.name)

    @staticmethod
    def _ensure_local(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.astimezone()
        return value.astimezone()


def create_usage_log_entry(
    *,
    session_id: str | None,
    server_name: str,
    tool: str,
    route_name: str,
    status: UsageLogStatus,
    duration_ms: int,
    user: str | None,
    error_code: str | None,
    guardrail: dict | None = None,
    now: datetime | None = None,
) -> UsageLogEntry:
    timestamp = UsageLogger._ensure_local(now or datetime.now().astimezone())
    utc_timestamp = timestamp.astimezone(timezone.utc)
    return UsageLogEntry(
        ts=utc_timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        epoch_ms=int(timestamp.timestamp() * 1000),
        session_id=session_id,
        serverName=server_name,
        tool=tool,
        routeName=route_name,
        status=status,
        duration_ms=max(0, duration_ms),
        user=user,
        error_code=error_code,
        guardrail_action=str(guardrail.get("action")) if guardrail else None,
        guardrail_risk_score=(
            int(guardrail.get("risk_score"))
            if guardrail and isinstance(guardrail.get("risk_score"), int)
            else None
        ),
        guardrail_denied_commands=tuple(
            str(item) for item in (guardrail.get("denied_commands") or [])
        ) if guardrail else (),
    )
