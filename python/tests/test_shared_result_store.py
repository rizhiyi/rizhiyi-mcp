"""共享结果存储（M1 损坏文件容错 / M2 文件名编码过期时间）测试。

覆盖 CODE_REVIEW.md 的 M1、M2 两条：
- M1：单个损坏的结果文件不得让整个存储不可用；损坏文件被隔离到 ``corrupt/``。
- M2：过期时间编码进文件名（``<expiresAtEpochMilliseconds>-<handle>.json``），清理走文件名快路径；
  旧格式（``<handle>.json``）文件仍可读、不会被误删，走读内容的慢路径。

另含一条跨实现文件名约定校验：读取 ``config/shared-store-parity.golden.json``
（由 ``ts/scripts/shared-store-test.mjs --write`` 生成），断言 Python 侧生成 / 解析
的文件名与 TypeScript 侧逐字节一致。
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from rizhiyi_mcp.analysis_constants import get_analysis_constants
from rizhiyi_mcp.config import RuntimeConfig
from rizhiyi_mcp.shared_result_store import (
    SharedResultStoreError,
    build_shared_result_file_name,
    build_shared_result_resource_uri,
    cleanup_expired_results,
    delete_shared_result,
    list_shared_results,
    parse_shared_result_file_name,
    read_shared_result,
    reset_shared_result_cleanup_throttle,
    save_shared_result,
)
from rizhiyi_mcp.types import SharedResultSummary

_REPO_ROOT = Path(__file__).resolve().parents[2]
_GOLDEN_PATH = _REPO_ROOT / "config" / "shared-store-parity.golden.json"

_CORRUPT_DIR_NAME = "corrupt"


@pytest.fixture(autouse=True)
def _reset_cleanup_throttle() -> Any:
    """写路径清理降频状态是模块级的，逐测试重置，避免相互干扰。"""
    reset_shared_result_cleanup_throttle()
    yield
    reset_shared_result_cleanup_throttle()


@pytest.fixture()
def config(tmp_path: Path) -> RuntimeConfig:
    return RuntimeConfig(
        logease_base_url="http://logease.example",
        log_tools_result_store_dir=tmp_path,
        log_tools_result_ttl_seconds=60,
        log_tools_result_inline_max_bytes=1024,
        log_tools_result_max_file_bytes=5 * 1024 * 1024,
    )


def _store_dir(config: RuntimeConfig) -> Path:
    return config.log_tools_result_store_dir


def _save(config: RuntimeConfig, *, ttl_seconds: int = 60, payload: Any = None) -> Any:
    return save_shared_result(
        config,
        route_name="log-tools",
        tool_name="trend_summary",
        result_kind="timeseries",
        payload={"value": 1} if payload is None else payload,
        summary=SharedResultSummary(title="t", text="t"),
        ttl_seconds=ttl_seconds,
    )


def _write_envelope(path: Path, *, handle: str, expires_at: str, route_name: str = "log-tools") -> None:
    now = datetime.now(timezone.utc)
    payload = {"value": 1}
    envelope = {
        "handle": handle,
        "resource_uri": build_shared_result_resource_uri(handle),
        "resource_title": "t",
        "resource_type": "timeseries",
        "resource_mime_type": "application/json",
        "created_at": (now - timedelta(minutes=5)).isoformat(),
        "expires_at": expires_at,
        "tool_name": "trend_summary",
        "result_kind": "timeseries",
        "payload_bytes": len(json.dumps(payload)),
        "summary": {"title": "t", "text": "t", "key_metrics": {}, "preview_fields": [], "warnings": []},
        "payload": payload,
        "route_name": route_name,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(envelope), encoding="utf-8")


# ---------------------------------------------------------------------------
# M2：文件名编码过期时间
# ---------------------------------------------------------------------------


def test_save_uses_expiry_prefixed_file_name(config: RuntimeConfig) -> None:
    envelope = _save(config)
    files = list(_store_dir(config).glob("*.json"))
    assert len(files) == 1

    parsed = parse_shared_result_file_name(files[0].name)
    assert parsed is not None, f"新写入的文件名应为新格式，实际：{files[0].name}"
    expires_epoch_milliseconds, handle = parsed
    assert handle == envelope.handle
    expected_epoch = int(datetime.fromisoformat(envelope.expires_at).timestamp() * 1000)
    assert expires_epoch_milliseconds == expected_epoch


def test_cleanup_removes_expired_new_format_file_by_name(config: RuntimeConfig) -> None:
    handle = "a" * 32
    expired_epoch = int(time.time() * 1000) - 100 * 1000
    path = _store_dir(config) / build_shared_result_file_name(expired_epoch, handle)
    # 内容故意写坏：快路径只应看文件名，绝不能因为读不到内容而漏清理。
    path.write_text("{ not json", encoding="utf-8")

    cleanup_expired_results(config)

    assert not path.exists(), "过期的结果文件应按文件名被清理"
    assert (_store_dir(config) / f"{handle}.expired.json").exists()


def test_cleanup_keeps_unexpired_new_format_file(config: RuntimeConfig) -> None:
    handle = "b" * 32
    future_epoch = int(time.time() * 1000) + 3600 * 1000
    path = _store_dir(config) / build_shared_result_file_name(future_epoch, handle)
    _write_envelope(path, handle=handle, expires_at=datetime.now(timezone.utc).isoformat())

    cleanup_expired_results(config)

    assert path.exists()


def test_legacy_file_is_not_deleted_and_stays_readable(config: RuntimeConfig) -> None:
    """向后兼容：旧格式（无过期前缀）文件不能被当成垃圾删掉，且仍可读取。"""
    handle = "c" * 32
    legacy = _store_dir(config) / f"{handle}.json"
    _write_envelope(
        legacy,
        handle=handle,
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    )

    cleanup_expired_results(config)

    assert legacy.exists(), "未过期的旧格式文件不应被清理"
    result = read_shared_result(config, build_shared_result_resource_uri(handle))
    assert result.handle == handle


def test_expired_legacy_file_is_cleaned_via_slow_path(config: RuntimeConfig) -> None:
    handle = "d" * 32
    legacy = _store_dir(config) / f"{handle}.json"
    _write_envelope(
        legacy,
        handle=handle,
        expires_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
    )

    cleanup_expired_results(config)

    assert not legacy.exists(), "过期的旧格式文件应走慢路径被清理"
    assert (_store_dir(config) / f"{handle}.expired.json").exists()


def test_write_path_cleanup_is_throttled(config: RuntimeConfig) -> None:
    reset_shared_result_cleanup_throttle()
    _save(config)  # 首次保存会触发一次写路径清理

    handle = "e" * 32
    expired_path = _store_dir(config) / build_shared_result_file_name(int(time.time() * 1000) - 100 * 1000, handle)
    expired_path.write_text("{ not json", encoding="utf-8")

    _save(config)  # 距上次清理不足 60s，写路径应跳过清理
    assert expired_path.exists(), "降频窗口内保存不应触发全目录清理"

    reset_shared_result_cleanup_throttle()
    _save(config)  # 重置后再次保存应触发清理
    assert not expired_path.exists(), "降频窗口过后保存应触发清理"


# ---------------------------------------------------------------------------
# M1：损坏文件容错
# ---------------------------------------------------------------------------


def test_corrupt_new_format_file_does_not_break_store(config: RuntimeConfig) -> None:
    good = _save(config)

    bad_handle = "f" * 32
    bad_path = _store_dir(config) / build_shared_result_file_name(int(time.time() * 1000) + 3600 * 1000, bad_handle)
    bad_path.write_text("{ this is not json", encoding="utf-8")

    # 保存仍应正常工作
    another = _save(config)

    # 列表不应因坏文件而报错，也不应包含坏文件
    listed = list_shared_results(config)
    handles = {item.handle for item in listed}
    assert good.handle in handles
    assert another.handle in handles
    assert bad_handle not in handles

    # 读取坏 handle 按「不存在」处理，抛 HANDLE_NOT_FOUND 而不是解析异常
    with pytest.raises(SharedResultStoreError) as context:
        read_shared_result(config, build_shared_result_resource_uri(bad_handle))
    assert context.value.code == "HANDLE_NOT_FOUND"

    # 坏文件已被隔离到 corrupt/，不再位于 storeDir 根目录
    assert not bad_path.exists()
    corrupt_dir = _store_dir(config) / _CORRUPT_DIR_NAME
    assert corrupt_dir.is_dir()
    assert any(entry.name.endswith(".json") for entry in corrupt_dir.iterdir())


def test_corrupt_legacy_file_is_quarantined(config: RuntimeConfig) -> None:
    handle = "1" * 32
    legacy = _store_dir(config) / f"{handle}.json"
    legacy.write_text("not-json-at-all", encoding="utf-8")

    good = _save(config)
    listed = list_shared_results(config)

    assert {item.handle for item in listed} == {good.handle}
    assert not legacy.exists(), "损坏的旧格式文件应被隔离"
    assert (_store_dir(config) / _CORRUPT_DIR_NAME).is_dir()


def test_corrupt_file_is_not_rescanned_as_result(config: RuntimeConfig) -> None:
    """隔离目录本身不能被当成结果文件扫到（否则每次扫描都会重复报错）。"""
    handle = "2" * 32
    bad_path = _store_dir(config) / f"{handle}.json"
    bad_path.write_text("broken", encoding="utf-8")

    cleanup_expired_results(config)  # 触发隔离
    cleanup_expired_results(config)  # 再扫一次，不应再次命中
    cleanup_expired_results(config)

    corrupt_dir = _store_dir(config) / _CORRUPT_DIR_NAME
    quarantined = list(corrupt_dir.iterdir())
    assert len(quarantined) == 1, f"隔离目录不应被重复扫描，实际：{[p.name for p in quarantined]}"
    assert list_shared_results(config) == []


def test_delete_removes_new_format_file(config: RuntimeConfig) -> None:
    envelope = _save(config)
    assert delete_shared_result(config, envelope.resource_uri) is True
    assert list(_store_dir(config).glob("*.json")) == []
    assert delete_shared_result(config, envelope.resource_uri) is False


# ---------------------------------------------------------------------------
# 跨实现文件名约定（黄金文件）
# ---------------------------------------------------------------------------


def test_file_name_convention_matches_golden() -> None:
    if not _GOLDEN_PATH.exists():
        pytest.skip(
            f"缺少 {_GOLDEN_PATH}，请先运行："
            "npm --prefix ts run test:shared-store -- --write"
        )
    golden = json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))

    for sample in golden["fileNameSamples"]:
        name = build_shared_result_file_name(sample["expiresAtEpochMilliseconds"], sample["handle"])
        assert name == sample["fileName"]
        assert parse_shared_result_file_name(name) == (
            sample["expiresAtEpochMilliseconds"],
            sample["handle"],
        )

    for legacy_name in golden["legacyFileNames"]:
        assert parse_shared_result_file_name(legacy_name) is None

    rules = get_analysis_constants().shared_result_store
    assert rules.cleanup_interval_seconds == golden["cleanupIntervalSeconds"]
    assert rules.corrupt_dir_name == golden["corruptDirName"]
