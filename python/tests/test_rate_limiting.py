from __future__ import annotations

import json

from pydantic import ValidationError

from rizhiyi_mcp.config import RuntimeConfig
from rizhiyi_mcp.rate_limiting import FixedWindowRateLimiter
from tests.support import HttpGatewayTestCase


class FixedWindowRateLimiterTestCase(HttpGatewayTestCase):
    def _restart_client(self, **config_overrides) -> None:
        self._client_cm.__exit__(None, None, None)
        self.runtime_config = self.build_runtime_config(**config_overrides)

        from fastapi.testclient import TestClient
        from rizhiyi_mcp.gateway import create_http_app

        self._client_cm = TestClient(create_http_app(self.runtime_config))
        self.client = self._client_cm.__enter__()

    def test_global_limit_counts_only_tool_calls(self) -> None:
        self._restart_client(mcp_rate_limit_global_per_minute=1)
        session_id = self._initialize_session()

        tools = self._tools_list("log-tools", session_id)
        self.assertTrue(tools)

        first = self._call_tool("log-tools", session_id, "list_fields")
        self.assertNotEqual(first["structuredContent"].get("error_code"), "RATE_LIMIT_EXCEEDED")

        limited = self._call_tool("log-tools", session_id, "query_precheck", request_id=4)
        payload = limited["structuredContent"]
        self.assertTrue(limited["isError"])
        self.assertEqual(payload["error_code"], "RATE_LIMIT_EXCEEDED")
        self.assertEqual(payload["details"]["scope"], "global")
        self.assertEqual(payload["details"]["limit"], 1)
        self.assertGreaterEqual(payload["details"]["retry_after_seconds"], 1)

    def test_route_qualified_per_tool_limit_does_not_affect_other_tools(self) -> None:
        self._restart_client(mcp_rate_limit_per_tool={"log-tools/list_fields": 1})
        session_id = self._initialize_session()

        self._call_tool("log-tools", session_id, "list_fields")
        limited = self._call_tool("log-tools", session_id, "list_fields", request_id=4)
        other = self._call_tool("log-tools", session_id, "query_precheck", request_id=5)

        self.assertEqual(limited["structuredContent"]["error_code"], "RATE_LIMIT_EXCEEDED")
        self.assertEqual(limited["structuredContent"]["details"]["scope"], "tool")
        self.assertNotEqual(other["structuredContent"].get("error_code"), "RATE_LIMIT_EXCEEDED")

    def test_healthz_reports_rate_limit_status_without_exposing_rules(self) -> None:
        self._restart_client(
            mcp_rate_limit_global_per_minute=100,
            mcp_rate_limit_per_tool={"log_search_sheet": 10},
        )

        rate_limiting = self.client.get("/healthz").json()["rate_limiting"]
        self.assertEqual(
            rate_limiting,
            {
                "enabled": True,
                "global_per_minute": 100,
                "per_tool_count": 1,
            },
        )

    def test_usage_log_records_success_and_rate_limit_without_arguments(self) -> None:
        self._restart_client(mcp_rate_limit_global_per_minute=1)
        session_id = self._initialize_session("manage")

        self._call_tool("manage", session_id, "select_module")
        self._call_tool("manage", session_id, "select_module", request_id=4)

        log_paths = sorted(self.runtime_config.rizhiyi_log_dir.glob("mcp-server-*.log"))
        self.assertEqual(len(log_paths), 1)
        entries = [json.loads(line) for line in log_paths[0].read_text(encoding="utf-8").splitlines()]
        self.assertEqual([entry["status"] for entry in entries], ["ok", "ok-limited"])
        self.assertEqual(entries[1]["error_code"], "RATE_LIMIT_EXCEEDED")
        self.assertEqual(entries[0]["session_id"], session_id)
        self.assertEqual(entries[0]["serverName"], "manage")
        self.assertEqual(entries[0]["routeName"], "manage")
        self.assertEqual(entries[0]["tool"], "select_module")
        self.assertEqual(entries[0]["user"], "demo-user")
        self.assertNotIn("arguments", entries[0])


def test_fixed_window_resets_on_natural_boundary() -> None:
    now = [119.9]
    limiter = FixedWindowRateLimiter(global_limit=1, clock=lambda: now[0])

    assert limiter.consume(route_name="log-tools", tool_name="list_fields").allowed
    denied = limiter.consume(route_name="log-tools", tool_name="list_fields")
    assert not denied.allowed
    assert denied.retry_after_seconds == 1

    now[0] = 120.0
    assert limiter.consume(route_name="log-tools", tool_name="list_fields").allowed


def test_unqualified_tool_rule_shares_count_across_routes() -> None:
    limiter = FixedWindowRateLimiter(per_tool_limits={"shared_tool": 1})

    assert limiter.consume(route_name="first", tool_name="shared_tool").allowed
    denied = limiter.consume(route_name="second", tool_name="shared_tool")
    assert not denied.allowed
    assert denied.scope == "tool"


def test_rate_limit_config_rejects_non_positive_values() -> None:
    try:
        RuntimeConfig(mcp_rate_limit_global_per_minute=0)
    except ValidationError:
        pass
    else:  # pragma: no cover - assertion guard
        raise AssertionError("global rate limit 0 should be rejected")

    try:
        RuntimeConfig(mcp_rate_limit_per_tool={"list_fields": 0})
    except ValidationError:
        pass
    else:  # pragma: no cover - assertion guard
        raise AssertionError("per-tool rate limit 0 should be rejected")
