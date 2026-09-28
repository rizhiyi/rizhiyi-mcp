from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .analysis_constants import get_analysis_constants
from .config import RuntimeConfig
from .spl_guardrails import apply_output_guardrails, guardrail_config_from_runtime
from .types import SharedResultEnvelope, SharedResultKind, SharedResultSummary

_LOGGER = logging.getLogger(__name__)

_RESOURCE_PROTOCOL = "logease"
_RESOURCE_HOST = "shared-result"
_RESOURCE_MIME_TYPE = "application/json"
_EXPIRED_MARKER_SUFFIX = ".expired.json"
_HANDLE_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{8,}$")

# 结果文件名格式（TS / Python 逐字节一致，契约见 config/shared-store-parity.golden.json）：
#   <expiresAtEpochMilliseconds>-<handle>.json
#
# 过期时间编码进文件名后，清理路径只需比对文件名即可判定过期，无需读取、解析每个文件
# （见 CODE_REVIEW.md M2）。使用毫秒而非秒，是为了让按文件名判定的过期时刻与真实
# expires_at 的误差 < 1ms，从而不影响「刚过期即从列表消失」这类精度敏感的语义。
# 旧格式（无过期前缀）文件仍可读：降级到「读取内容再判断」的慢路径。
_SHARED_RESULT_FILE_NAME_PATTERN = re.compile(r"^(\d{13,})-([A-Za-z0-9_-]{8,})\.json$")


class SharedResultStoreError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def build_shared_result_file_name(expires_at_epoch_milliseconds: int, handle: str) -> str:
    """生成新格式结果文件名。与 TypeScript ``buildSharedResultFileName`` 行为一致。"""
    return f"{expires_at_epoch_milliseconds}-{handle}.json"


def parse_shared_result_file_name(file_name: str) -> tuple[int, str] | None:
    """解析新格式结果文件名，非新格式（旧格式 / 过期标记 / 其它文件）返回 None。

    与 TypeScript ``parseSharedResultFileName`` 行为一致。
    """
    match = _SHARED_RESULT_FILE_NAME_PATTERN.match(file_name)
    if match is None:
        return None
    return int(match.group(1)), match.group(2)


def build_shared_result_resource_uri(handle: str) -> str:
    _assert_valid_handle(handle)
    return f"{_RESOURCE_PROTOCOL}://{_RESOURCE_HOST}/{handle}"


def save_shared_result(
    runtime_config: RuntimeConfig,
    *,
    route_name: str,
    tool_name: str,
    result_kind: SharedResultKind,
    payload: Any,
    summary: SharedResultSummary,
    source_query: str | None = None,
    time_range: str | None = None,
    index_name: str | None = None,
    upstream_sid: str | None = None,
    ttl_seconds: int | None = None,
) -> SharedResultEnvelope[Any]:
    _maybe_cleanup_on_save(runtime_config)
    _ensure_store_dir(runtime_config)

    guardrail_config = guardrail_config_from_runtime(runtime_config)
    payload, sanitized_values, truncated_events, truncated_paths = apply_output_guardrails(
        payload,
        guardrail_config,
    )
    source_query, source_query_sanitized, _, _ = apply_output_guardrails(
        source_query,
        guardrail_config,
    )
    sanitized_values += source_query_sanitized
    summary_payload, _, _, _ = apply_output_guardrails(asdict(summary), guardrail_config)
    summary = SharedResultSummary(**summary_payload)
    if isinstance(payload, dict) and (sanitized_values or truncated_events):
        payload = dict(payload)
        payload["guardrail_output"] = {
            "sanitized_values": sanitized_values,
            "truncated_events": truncated_events,
            "truncated_paths": truncated_paths,
        }

    resolved_ttl = ttl_seconds if ttl_seconds and ttl_seconds > 0 else runtime_config.log_tools_result_ttl_seconds
    handle = uuid4().hex
    created_at = _utcnow()
    expires_at = created_at + timedelta(seconds=resolved_ttl)
    payload_bytes = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    if payload_bytes > runtime_config.log_tools_result_max_file_bytes:
        raise SharedResultStoreError(
            "PAYLOAD_TOO_LARGE",
            (
                f"共享结果大小 {payload_bytes} bytes 超过上限 "
                f"{runtime_config.log_tools_result_max_file_bytes} bytes。"
            ),
        )

    envelope = SharedResultEnvelope(
        handle=handle,
        resource_uri=build_shared_result_resource_uri(handle),
        resource_title=_build_resource_title(tool_name, summary, handle),
        resource_type=result_kind,
        resource_mime_type=_RESOURCE_MIME_TYPE,
        created_at=created_at.isoformat(),
        expires_at=expires_at.isoformat(),
        tool_name=tool_name,
        result_kind=result_kind,
        payload_bytes=payload_bytes,
        summary=summary,
        payload=payload,
        source_query=source_query if isinstance(source_query, str) else None,
        time_range=time_range,
        index_name=index_name,
        upstream_sid=upstream_sid,
        route_name=route_name,
    )
    # 过期时间（毫秒）编码进文件名；按文件名判定过期的误差 < 1ms。
    expires_at_epoch_milliseconds = int(expires_at.timestamp() * 1000)
    _write_json(
        _build_active_file_path(runtime_config, expires_at_epoch_milliseconds, handle),
        asdict(envelope),
    )
    return envelope


def read_shared_result(runtime_config: RuntimeConfig, resource_uri: str) -> SharedResultEnvelope[Any]:
    _ensure_store_dir(runtime_config)
    state = _load_shared_result_state(runtime_config, resource_uri)
    if state["status"] == "missing":
        raise SharedResultStoreError("HANDLE_NOT_FOUND", "共享结果不存在，可能已被删除或尚未生成。")
    if state["status"] == "expired":
        raise SharedResultStoreError("HANDLE_EXPIRED", "共享结果已过期，请重新执行源工具。")

    envelope = state["envelope"]
    if envelope is None:
        raise SharedResultStoreError("HANDLE_NOT_FOUND", "共享结果不存在，可能已被删除或尚未生成。")
    return envelope


def list_shared_results(
    runtime_config: RuntimeConfig,
    *,
    route_name: str | None = None,
) -> list[SharedResultEnvelope[Any]]:
    cleanup_expired_results(runtime_config)
    _ensure_store_dir(runtime_config)

    store_dir = runtime_config.log_tools_result_store_dir
    now_epoch_milliseconds = int(time.time() * 1000)
    envelopes: list[SharedResultEnvelope[Any]] = []
    for path in store_dir.glob("*.json"):
        if path.name.endswith(_EXPIRED_MARKER_SUFFIX):
            continue
        # 快路径：文件名已表明过期（清理失败或竞态残留）时直接跳过，不读取内容。
        parsed_name = parse_shared_result_file_name(path.name)
        if parsed_name is not None and parsed_name[0] <= now_epoch_milliseconds:
            continue
        envelope = _safe_read_envelope(path, store_dir)
        if envelope is None:
            continue
        if route_name and envelope.route_name != route_name:
            continue
        envelopes.append(envelope)

    return sorted(envelopes, key=lambda item: item.created_at, reverse=True)


def delete_shared_result(runtime_config: RuntimeConfig, resource_uri: str) -> bool:
    _ensure_store_dir(runtime_config)
    state = _load_shared_result_state(runtime_config, resource_uri)
    if state["status"] == "missing":
        return False
    if state["status"] == "expired":
        raise SharedResultStoreError("HANDLE_EXPIRED", "共享结果已过期，无需重复删除，请重新执行源工具。")

    if state["file_path"] is not None:
        _remove_file_if_exists(state["file_path"])
    _remove_file_if_exists(state["marker_path"])
    return True


def cleanup_expired_results(runtime_config: RuntimeConfig) -> None:
    _ensure_store_dir(runtime_config)
    store_dir = runtime_config.log_tools_result_store_dir
    now = _utcnow()
    now_epoch_milliseconds = int(time.time() * 1000)
    for path in store_dir.glob("*.json"):
        if path.name.endswith(_EXPIRED_MARKER_SUFFIX):
            continue
        # 快路径：过期时间已编码进文件名，直接按文件名判断，无需读取 / 解析内容。
        parsed_name = parse_shared_result_file_name(path.name)
        if parsed_name is not None:
            expires_at_epoch_milliseconds, handle = parsed_name
            if expires_at_epoch_milliseconds <= now_epoch_milliseconds:
                _mark_expired_result(
                    runtime_config,
                    handle,
                    expires_at=_epoch_milliseconds_to_isoformat(expires_at_epoch_milliseconds),
                    active_file_path=path,
                )
            continue
        # 慢路径：旧格式文件没有过期前缀，只能读取内容判断是否过期。
        envelope = _safe_read_envelope(path, store_dir)
        if envelope is None:
            # 不存在（并发删除）或损坏（已隔离）：都跳过，绝不删除 / 抛错。
            continue
        if _is_expired(envelope, now):
            _mark_expired_result(runtime_config, envelope.handle, envelope=envelope, active_file_path=path)


# 写路径清理降频状态。
# 保存是最高频的入口，若每次都全目录扫描，固定开销会随存量线性增长（CODE_REVIEW.md M2）。
# 这里改为「距上次写路径清理不足 cleanup_interval_seconds 时直接跳过」；正确性不依赖写路径
# 清理——读取 / 列表路径仍会按 TTL 判定过期。
_last_write_path_cleanup_at: float | None = None


def reset_shared_result_cleanup_throttle() -> None:
    """仅供测试：重置写路径清理降频状态。"""
    global _last_write_path_cleanup_at
    _last_write_path_cleanup_at = None


def _maybe_cleanup_on_save(runtime_config: RuntimeConfig) -> None:
    global _last_write_path_cleanup_at
    interval = get_analysis_constants().shared_result_store.cleanup_interval_seconds
    now = time.monotonic()
    if _last_write_path_cleanup_at is not None and now - _last_write_path_cleanup_at < interval:
        return
    _last_write_path_cleanup_at = now
    cleanup_expired_results(runtime_config)


def _assert_valid_handle(handle: str) -> None:
    if not _HANDLE_PATTERN.fullmatch(handle):
        raise SharedResultStoreError("INVALID_RESOURCE_URI", "共享资源 URI 中的 handle 格式不合法。")


def _resolve_handle_reference(resource_uri: str) -> str:
    prefix = f"{_RESOURCE_PROTOCOL}://{_RESOURCE_HOST}/"
    if not isinstance(resource_uri, str) or not resource_uri.startswith(prefix):
        raise SharedResultStoreError("INVALID_RESOURCE_URI", "请传入共享资源 URI（resource_uri）。")

    handle = resource_uri[len(prefix) :].strip()
    _assert_valid_handle(handle)
    return handle


def _build_resource_title(tool_name: str, summary: SharedResultSummary, handle: str) -> str:
    base_title = summary.title.strip() if summary.title.strip() else f"{tool_name} 结果"
    return f"{base_title} [{handle[:8]}]"


def _ensure_store_dir(runtime_config: RuntimeConfig) -> None:
    runtime_config.log_tools_result_store_dir.mkdir(parents=True, exist_ok=True)


def _build_active_file_path(
    runtime_config: RuntimeConfig,
    expires_at_epoch_milliseconds: int,
    handle: str,
) -> Path:
    return runtime_config.log_tools_result_store_dir / build_shared_result_file_name(
        expires_at_epoch_milliseconds, handle
    )


def _build_legacy_file_path(runtime_config: RuntimeConfig, handle: str) -> Path:
    """旧格式路径：``<handle>.json``，仅在读取历史文件时使用。"""
    return runtime_config.log_tools_result_store_dir / f"{handle}.json"


def _build_expired_marker_path(runtime_config: RuntimeConfig, handle: str) -> Path:
    return runtime_config.log_tools_result_store_dir / f"{handle}{_EXPIRED_MARKER_SUFFIX}"


def _build_corrupt_dir(runtime_config: RuntimeConfig) -> Path:
    return runtime_config.log_tools_result_store_dir / get_analysis_constants().shared_result_store.corrupt_dir_name


def _find_active_file_path(runtime_config: RuntimeConfig, handle: str) -> Path | None:
    """在 storeDir 中定位某个 handle 对应的结果文件。

    优先返回新格式（``<expires>-<handle>.json``），找不到时回退旧格式（``<handle>.json``）。
    只做文件名匹配，不读取文件内容。
    """
    store_dir = runtime_config.log_tools_result_store_dir
    legacy_name = f"{handle}.json"
    legacy_path = store_dir / legacy_name
    try:
        entries = list(store_dir.iterdir())
    except FileNotFoundError:
        return None

    for entry in entries:
        if not entry.is_file():
            continue
        parsed_name = parse_shared_result_file_name(entry.name)
        if parsed_name is not None and parsed_name[1] == handle:
            return entry
        if entry.name == legacy_name:
            legacy_path = entry
    return legacy_path if legacy_path.exists() else None


def _quarantine_corrupt_file(file_path: Path, store_dir: Path, reason: Exception) -> None:
    """把损坏文件移动到 ``corrupt/`` 隔离目录，避免每次扫描都重复报错。

    移动失败必须可容忍（只记录日志），绝不能中断批量流程。
    """
    _LOGGER.warning("共享结果文件损坏，已按不存在处理并隔离：%s（%s）", file_path, reason)
    try:
        corrupt_dir = store_dir / get_analysis_constants().shared_result_store.corrupt_dir_name
        corrupt_dir.mkdir(parents=True, exist_ok=True)
        target = corrupt_dir / file_path.name
        if target.exists():
            target = corrupt_dir / f"{file_path.name}.{int(time.time() * 1000)}"
        file_path.replace(target)
    except OSError as error:  # pragma: no cover - 隔离失败只能记录日志
        _LOGGER.warning("隔离损坏文件失败，已忽略：%s（%s）", file_path, error)


def _safe_read_envelope(file_path: Path, store_dir: Path) -> SharedResultEnvelope[Any] | None:
    """读取并解析 envelope。任何失败（不存在 / 损坏 / 权限）都返回 None，绝不抛异常：
    单个坏文件不应让整个存储不可用（见 CODE_REVIEW.md M1）。
    """
    try:
        content = file_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as error:
        _LOGGER.warning("读取共享结果文件失败，已按不存在处理：%s（%s）", file_path, error)
        return None

    try:
        payload = json.loads(content)
        envelope_dict = _normalize_envelope_dict(payload)
        summary = SharedResultSummary(**envelope_dict["summary"])
        envelope_dict["summary"] = summary
        return SharedResultEnvelope(**envelope_dict)
    except (json.JSONDecodeError, KeyError, TypeError, ValueError, SharedResultStoreError) as error:
        _quarantine_corrupt_file(file_path, store_dir, error)
        return None


def _normalize_envelope_dict(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("共享结果内容不是 JSON 对象")
    envelope = dict(payload)
    handle = envelope.get("handle")
    if not isinstance(handle, str) or not handle:
        raise ValueError("共享结果缺少 handle 字段")
    expires_at = envelope.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at:
        raise ValueError("共享结果缺少 expires_at 字段")
    datetime.fromisoformat(expires_at)
    envelope["handle"] = handle
    envelope.setdefault("resource_uri", build_shared_result_resource_uri(handle))
    envelope.setdefault(
        "resource_title",
        _build_resource_title(
            str(envelope.get("tool_name", "shared_result")),
            SharedResultSummary(**envelope["summary"]),
            handle,
        ),
    )
    envelope.setdefault("resource_type", envelope["result_kind"])
    envelope.setdefault("resource_mime_type", _RESOURCE_MIME_TYPE)
    envelope.setdefault("route_name", None)
    return envelope


def _load_shared_result_state(runtime_config: RuntimeConfig, resource_uri: str) -> dict[str, Any]:
    handle = _resolve_handle_reference(resource_uri)
    file_path = _find_active_file_path(runtime_config, handle)
    marker_path = _build_expired_marker_path(runtime_config, handle)
    envelope = (
        _safe_read_envelope(file_path, runtime_config.log_tools_result_store_dir)
        if file_path is not None
        else None
    )

    if envelope is not None:
        if _is_expired(envelope):
            _mark_expired_result(runtime_config, handle, envelope=envelope, active_file_path=file_path)
            return {
                "status": "expired",
                "file_path": file_path,
                "marker_path": marker_path,
                "envelope": None,
            }
        return {
            "status": "active",
            "file_path": file_path,
            "marker_path": marker_path,
            "envelope": envelope,
        }

    if marker_path.exists():
        return {
            "status": "expired",
            "file_path": file_path,
            "marker_path": marker_path,
            "envelope": None,
        }

    return {
        "status": "missing",
        "file_path": file_path,
        "marker_path": marker_path,
        "envelope": None,
    }


def _mark_expired_result(
    runtime_config: RuntimeConfig,
    handle: str,
    *,
    envelope: SharedResultEnvelope[Any] | None = None,
    expires_at: str | None = None,
    active_file_path: Path | None = None,
) -> None:
    resolved_expires_at = expires_at
    if resolved_expires_at is None:
        resolved_expires_at = envelope.expires_at if envelope else _utcnow().isoformat()
    marker_payload = {
        "handle": handle,
        "resource_uri": envelope.resource_uri if envelope else build_shared_result_resource_uri(handle),
        "expired_at": resolved_expires_at,
    }
    _write_json(_build_expired_marker_path(runtime_config, handle), marker_payload)
    if active_file_path is not None:
        _remove_file_if_exists(active_file_path)


def _remove_file_if_exists(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return


def _is_expired(envelope: SharedResultEnvelope[Any], now: datetime | None = None) -> bool:
    current = now or _utcnow()
    expires_at = datetime.fromisoformat(envelope.expires_at)
    return expires_at <= current


def _epoch_milliseconds_to_isoformat(epoch_milliseconds: int) -> str:
    return datetime.fromtimestamp(epoch_milliseconds / 1000, tz=timezone.utc).isoformat()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
