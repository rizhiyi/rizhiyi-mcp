from __future__ import annotations

import json
import re
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import RuntimeConfig
from .types import SharedResultEnvelope, SharedResultKind, SharedResultSummary

_RESOURCE_PROTOCOL = "logease"
_RESOURCE_HOST = "shared-result"
_RESOURCE_MIME_TYPE = "application/json"
_EXPIRED_MARKER_SUFFIX = ".expired.json"
_HANDLE_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{8,}$")


class SharedResultStoreError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


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
    cleanup_expired_results(runtime_config)
    _ensure_store_dir(runtime_config)

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
        source_query=source_query,
        time_range=time_range,
        index_name=index_name,
        upstream_sid=upstream_sid,
        route_name=route_name,
    )
    _write_json(_build_file_path(runtime_config, handle), asdict(envelope))
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

    envelopes: list[SharedResultEnvelope[Any]] = []
    for path in runtime_config.log_tools_result_store_dir.glob("*.json"):
        if path.name.endswith(_EXPIRED_MARKER_SUFFIX):
            continue
        envelope = _safe_read_envelope(path)
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

    _remove_file_if_exists(state["file_path"])
    _remove_file_if_exists(state["marker_path"])
    return True


def cleanup_expired_results(runtime_config: RuntimeConfig) -> None:
    _ensure_store_dir(runtime_config)
    now = _utcnow()
    for path in runtime_config.log_tools_result_store_dir.glob("*.json"):
        if path.name.endswith(_EXPIRED_MARKER_SUFFIX):
            continue
        envelope = _safe_read_envelope(path)
        if envelope is None:
            _remove_file_if_exists(path)
            continue
        if _is_expired(envelope, now):
            _mark_expired_result(runtime_config, envelope.handle, envelope)


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


def _build_file_path(runtime_config: RuntimeConfig, handle: str) -> Path:
    return runtime_config.log_tools_result_store_dir / f"{handle}.json"


def _build_expired_marker_path(runtime_config: RuntimeConfig, handle: str) -> Path:
    return runtime_config.log_tools_result_store_dir / f"{handle}{_EXPIRED_MARKER_SUFFIX}"


def _safe_read_envelope(file_path: Path) -> SharedResultEnvelope[Any] | None:
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    envelope_dict = _normalize_envelope_dict(payload)
    summary = SharedResultSummary(**envelope_dict["summary"])
    envelope_dict["summary"] = summary
    return SharedResultEnvelope(**envelope_dict)


def _normalize_envelope_dict(payload: dict[str, Any]) -> dict[str, Any]:
    envelope = dict(payload)
    handle = str(envelope["handle"])
    envelope.setdefault("resource_uri", build_shared_result_resource_uri(handle))
    envelope.setdefault("resource_title", _build_resource_title(str(envelope.get("tool_name", "shared_result")), SharedResultSummary(**envelope["summary"]), handle))
    envelope.setdefault("resource_type", envelope["result_kind"])
    envelope.setdefault("resource_mime_type", _RESOURCE_MIME_TYPE)
    envelope.setdefault("route_name", None)
    return envelope


def _load_shared_result_state(runtime_config: RuntimeConfig, resource_uri: str) -> dict[str, Any]:
    handle = _resolve_handle_reference(resource_uri)
    file_path = _build_file_path(runtime_config, handle)
    marker_path = _build_expired_marker_path(runtime_config, handle)
    envelope = _safe_read_envelope(file_path)

    if envelope is not None:
        if _is_expired(envelope):
            _mark_expired_result(runtime_config, handle, envelope)
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
    envelope: SharedResultEnvelope[Any] | None,
) -> None:
    marker_payload = {
        "handle": handle,
        "resource_uri": envelope.resource_uri if envelope else build_shared_result_resource_uri(handle),
        "expired_at": envelope.expires_at if envelope else _utcnow().isoformat(),
    }
    _write_json(_build_expired_marker_path(runtime_config, handle), marker_payload)
    _remove_file_if_exists(_build_file_path(runtime_config, handle))


def _remove_file_if_exists(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return


def _is_expired(envelope: SharedResultEnvelope[Any], now: datetime | None = None) -> bool:
    current = now or _utcnow()
    expires_at = datetime.fromisoformat(envelope.expires_at)
    return expires_at <= current


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
