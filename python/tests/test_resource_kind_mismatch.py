from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from rizhiyi_mcp.config import RuntimeConfig
from rizhiyi_mcp.log_tools_server import LogToolsServer, ResourceKindMismatch
from rizhiyi_mcp.shared_result_store import save_shared_result
from rizhiyi_mcp.types import SharedResultSummary


@pytest.fixture()
def config(tmp_path: Path) -> RuntimeConfig:
    return RuntimeConfig(
        logease_base_url="http://logease.example",
        log_tools_result_store_dir=tmp_path,
        log_tools_result_ttl_seconds=60,
        log_tools_result_inline_max_bytes=1024,
        log_tools_result_max_file_bytes=5 * 1024 * 1024,
    )


def _save_rows_resource(config: RuntimeConfig) -> str:
    """模拟 log_search_sheet 产出的 rows 类型资源。"""
    envelope = save_shared_result(
        config,
        route_name="log-tools",
        tool_name="log_search_sheet",
        result_kind="rows",
        payload={"hits": [{"status": "500"}], "total": 1},
        summary=SharedResultSummary(title="日志明细", text="1 条"),
        source_query="*",
        time_range="now-15m,now",
        ttl_seconds=60,
    )
    return envelope.resource_uri


def test_assert_resource_kind_accepts_matching_kind(config: RuntimeConfig) -> None:
    server = _make_server(config)
    envelope = save_shared_result(
        config,
        route_name="log-tools",
        tool_name="trend_summary",
        result_kind="timeseries",
        payload={"series": [{"timestamp": "t", "value": 1, "count": 1}]},
        summary=SharedResultSummary(title="时间序列", text="1 点"),
        ttl_seconds=60,
    )
    # 不抛异常即为通过
    server._assert_resource_kind(envelope, ("timeseries",), "anomaly_points")


def test_assert_resource_kind_rejects_mismatch(config: RuntimeConfig) -> None:
    server = _make_server(config)
    envelope_uri = _save_rows_resource(config)
    from rizhiyi_mcp.shared_result_store import read_shared_result

    envelope = read_shared_result(config, envelope_uri)
    with pytest.raises(ResourceKindMismatch) as excinfo:
        server._assert_resource_kind(envelope, ("timeseries",), "anomaly_points")
    message = str(excinfo.value)
    # 错误信息必须自描述：指出实际类型、期望类型，并给出修正建议
    assert "rows" in message
    assert "log_search_sheet" in message
    assert "anomaly_points" in message
    assert "timeseries" in message
    assert "建议" in message


async def test_read_resource_payload_raises_on_mismatch(config: RuntimeConfig) -> None:
    server = _make_server(config)
    uri = _save_rows_resource(config)
    with pytest.raises(ResourceKindMismatch):
        server._read_resource_payload(uri, expected=("timeseries",), consumer="trend_summary")


async def test_dispatch_wraps_mismatch_into_tool_error(config: RuntimeConfig) -> None:
    server = _make_server(config)
    uri = _save_rows_resource(config)
    result = await server.call_tool("anomaly_points", {"resource_uri": uri})
    assert result.is_error is True
    text = result.content[0]["text"]
    assert "RESOURCE_KIND_MISMATCH" in text
    # 不应退化成误导性的"无数据"
    assert "未找到符合条件的时间序列数据" not in text
    assert "rows" in text and "anomaly_points" in text and "timeseries" in text


def _make_server(config: RuntimeConfig) -> LogToolsServer:
    server = LogToolsServer.__new__(LogToolsServer)
    server.runtime_config = config
    return server