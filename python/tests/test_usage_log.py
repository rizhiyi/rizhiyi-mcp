from __future__ import annotations

from datetime import datetime, timedelta
import json
import os
from pathlib import Path

from rizhiyi_mcp.usage_log import (
    UsageLogConfig,
    UsageLogger,
    create_usage_log_entry,
)


def _entry(*, status: str = "ok", error_code: str | None = None):
    return create_usage_log_entry(
        session_id="session-1",
        server_name="manage",
        tool="select_module",
        route_name="manage",
        status=status,  # type: ignore[arg-type]
        duration_ms=3,
        user="demo-user",
        error_code=error_code,
    )


def test_size_rotation_and_retention(tmp_path: Path) -> None:
    local_timezone = datetime.now().astimezone().tzinfo
    now = datetime(2026, 9, 21, 10, 0, tzinfo=local_timezone)
    logger = UsageLogger(
        UsageLogConfig(
            directory=tmp_path,
            name_prefix="audit",
            rotate_bytes=1,
            rotate_interval="1d",
            keep_files=2,
        ),
        clock=lambda: now,
    )

    logger.write_sync(_entry())
    logger.write_sync(_entry(status="ok-limited", error_code="RATE_LIMIT_EXCEEDED"))
    logger.write_sync(_entry(status="error"))

    paths = sorted(tmp_path.glob("audit-*.log"))
    assert [path.name for path in paths] == ["audit-20260921.1.log", "audit-20260921.2.log"]
    latest = json.loads(paths[-1].read_text(encoding="utf-8"))
    assert latest["status"] == "error"
    assert latest["session_id"] == "session-1"
    assert latest["user"] == "demo-user"
    assert "query" not in latest


def test_hourly_rotation_when_size_rotation_disabled(tmp_path: Path) -> None:
    local_timezone = datetime.now().astimezone().tzinfo
    current = [datetime(2026, 9, 21, 10, 0, tzinfo=local_timezone)]
    logger = UsageLogger(
        UsageLogConfig(
            directory=tmp_path,
            name_prefix="hourly",
            rotate_bytes=0,
            rotate_interval="1h",
            keep_files=7,
        ),
        clock=lambda: current[0],
    )

    logger.write_sync(_entry())
    first_path = tmp_path / "hourly-20260921.log"
    os.utime(first_path, (current[0].timestamp(), current[0].timestamp()))
    current[0] += timedelta(hours=1)
    logger.write_sync(_entry())

    assert sorted(path.name for path in tmp_path.glob("hourly-*.log")) == [
        "hourly-20260921.1.log",
        "hourly-20260921.log",
    ]


def test_cache_invalidation_detects_external_new_file(tmp_path: Path) -> None:
    local_timezone = datetime.now().astimezone().tzinfo
    now = datetime(2026, 9, 21, 10, 0, tzinfo=local_timezone)
    logger = UsageLogger(
        UsageLogConfig(
            directory=tmp_path,
            name_prefix="invalidate",
            rotate_bytes=1,
            rotate_interval="1d",
            keep_files=5,
        ),
        clock=lambda: now,
    )

    logger.write_sync(_entry())
    logger.write_sync(_entry())
    # 模拟另一个进程创建了更高序号的文件；依赖目录 mtime 失效才能被发现。
    (tmp_path / "invalidate-20260921.5.log").write_text("external\n", encoding="utf-8")
    logger.write_sync(_entry())

    assert sorted(path.name for path in tmp_path.glob("invalidate-*.log")) == [
        "invalidate-20260921.1.log",
        "invalidate-20260921.5.log",
        "invalidate-20260921.6.log",
        "invalidate-20260921.log",
    ]


def test_size_cache_updates_after_append(tmp_path: Path) -> None:
    local_timezone = datetime.now().astimezone().tzinfo
    now = datetime(2026, 9, 21, 10, 0, tzinfo=local_timezone)
    logger = UsageLogger(
        UsageLogConfig(
            directory=tmp_path,
            name_prefix="size",
            rotate_bytes=500,
            rotate_interval="1d",
            keep_files=100,
        ),
        clock=lambda: now,
    )

    for _ in range(20):
        logger.write_sync(_entry())

    paths = sorted(tmp_path.glob("size-*.log"))
    # 若追加后不更新缓存大小，就会一直复用同一文件并突破 rotate_bytes。
    assert len(paths) >= 2
    assert all(path.stat().st_size <= 500 for path in paths)
