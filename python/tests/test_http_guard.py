from __future__ import annotations

import asyncio
import unittest

from fastapi.testclient import TestClient

from rizhiyi_mcp.config import RuntimeConfig
from rizhiyi_mcp.gateway import collect_stale_sessions, create_http_app
from rizhiyi_mcp.servers import RizhiyiFastMCPServer, ServiceRuntimeState
from rizhiyi_mcp.types import ToolCallResult
from tests.support import HttpGatewayTestCase
from tests.support import STREAMABLE_JSON_ACCEPT


def _initialize_payload(request_id: int = 1) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "http-guard-test", "version": "1.0.0"},
        },
    }


class HttpGuardConfigTestCase(unittest.TestCase):
    """H2/H3/H4 新增配置项的默认值与校验（须与 TS 端完全一致）。"""

    def test_defaults_match_ts(self) -> None:
        config = RuntimeConfig(_env_file=None)
        self.assertEqual(config.upstream_timeout_seconds, 30.0)
        self.assertEqual(config.mcp_http_max_body_bytes, 4 * 1024 * 1024)
        self.assertEqual(config.mcp_http_session_idle_ttl_seconds, 1800)
        self.assertEqual(config.mcp_http_session_max_count, 256)

    def test_overrides_applied(self) -> None:
        config = RuntimeConfig(
            _env_file=None,
            upstream_timeout_seconds=5,
            mcp_http_max_body_bytes=1024,
            mcp_http_session_idle_ttl_seconds=10,
            mcp_http_session_max_count=2,
        )
        self.assertEqual(config.upstream_timeout_seconds, 5.0)
        self.assertEqual(config.mcp_http_max_body_bytes, 1024)
        self.assertEqual(config.mcp_http_session_idle_ttl_seconds, 10)
        self.assertEqual(config.mcp_http_session_max_count, 2)

    def test_invalid_values_rejected(self) -> None:
        for overrides in (
            {"upstream_timeout_seconds": 0},
            {"mcp_http_max_body_bytes": 0},
            {"mcp_http_session_idle_ttl_seconds": 0},
            {"mcp_http_session_max_count": 0},
        ):
            with self.assertRaises(ValueError):
                RuntimeConfig(_env_file=None, **overrides)


class CollectStaleSessionsTestCase(unittest.IsolatedAsyncioTestCase):
    """H4：session 回收优先级与 transport 关闭。"""

    async def test_idle_ttl_evicts_and_closes(self) -> None:
        closed: list[str] = []

        async def closer(session_id: str) -> bool:
            closed.append(session_id)
            return True

        state = ServiceRuntimeState(route_name="log-tools")
        state.session_auth["old"] = "apikey demo-user:demo-secret"
        state.touch_session("old", now=100.0)
        state.session_auth["fresh"] = "apikey demo-user:demo-secret"
        state.touch_session("fresh", now=996.0)

        evicted = await collect_stale_sessions(
            [(state, closer)],
            idle_ttl_seconds=5.0,
            max_count=100,
            now=1000.0,
        )

        self.assertEqual(evicted, ["old"])
        self.assertNotIn("old", state.session_auth)
        self.assertIn("fresh", state.session_auth)
        self.assertEqual(closed, ["old"])

    async def test_max_count_evicts_oldest(self) -> None:
        closed: list[str] = []

        async def closer(session_id: str) -> bool:
            closed.append(session_id)
            return True

        state = ServiceRuntimeState(route_name="log-tools")
        for session_id, seen in (("a", 100.0), ("b", 200.0), ("c", 300.0)):
            state.session_auth[session_id] = "apikey demo-user:demo-secret"
            state.touch_session(session_id, now=seen)

        evicted = await collect_stale_sessions(
            [(state, closer)],
            idle_ttl_seconds=10_000.0,
            max_count=2,
            now=1000.0,
        )

        self.assertEqual(evicted, ["a"])
        self.assertEqual(sorted(state.session_auth), ["b", "c"])
        self.assertEqual(closed, ["a"])


class ExecutionTimeoutTestCase(unittest.IsolatedAsyncioTestCase):
    """H2：工具执行超时与护栏解耦。"""

    @staticmethod
    def _build_server(config: RuntimeConfig) -> RizhiyiFastMCPServer:
        async def slow_handler(_arguments: dict) -> ToolCallResult:
            await asyncio.sleep(0.3)
            return ToolCallResult(structured_content={"ok": True}, content=[], is_error=False)

        return RizhiyiFastMCPServer(
            route_name="log-tools",
            server_name="rizhiyi_search",
            title="log-tools",
            description="test",
            runtime_config=config,
            service_state=ServiceRuntimeState(route_name="log-tools"),
            tool_handlers={"slow_tool": slow_handler},
        )

    async def test_timeout_applies_without_guardrails(self) -> None:
        config = RuntimeConfig(
            _env_file=None,
            upstream_timeout_seconds=0.05,
            mcp_guardrails_enabled=False,
        )
        server = self._build_server(config)

        result = await server._execute_tool_with_guardrails("slow_tool", {})

        self.assertTrue(result.is_error)
        self.assertEqual(result.structured_content["error_code"], "SPL_EXECUTION_TIMEOUT")
        self.assertEqual(result.structured_content["details"]["timeout_seconds"], 0.05)

    async def test_guardrail_enforce_uses_guardrail_threshold(self) -> None:
        # 护栏 enforce + log-tools 命中护栏路径：使用 1s 护栏阈值，
        # 而不是 0.05s 的 upstream_timeout_seconds，因此 0.3s 的调用不会被中断。
        config = RuntimeConfig(
            _env_file=None,
            upstream_timeout_seconds=0.05,
            mcp_guardrails_enabled=True,
            mcp_guardrail_enforce_mode="enforce",
            mcp_guardrail_exec_timeout_seconds=1,
        )
        server = self._build_server(config)

        result = await server._execute_tool_with_guardrails("slow_tool", {})

        self.assertFalse(result.is_error)
        self.assertEqual(result.structured_content["ok"], True)


class HttpGuardGatewayTestCase(HttpGatewayTestCase):
    """H3/H4：网关层 413 与 session_count。"""

    def test_healthz_exposes_session_count(self) -> None:
        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_count"], 0)

    def test_request_body_over_limit_returns_413(self) -> None:
        config = self.build_runtime_config(mcp_http_max_body_bytes=512)
        with TestClient(create_http_app(config)) as client:
            response = client.post(
                "/mcp/log-tools",
                headers={"Authorization": "apikey demo-user:demo-secret", "Accept": STREAMABLE_JSON_ACCEPT},
                json={**_initialize_payload(), "params": {"padding": "x" * 2000}},
            )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"], "REQUEST_BODY_TOO_LARGE")

    def test_session_max_count_evicts_oldest(self) -> None:
        config = self.build_runtime_config(mcp_http_session_max_count=1)
        headers = {"Authorization": "apikey demo-user:demo-secret", "Accept": STREAMABLE_JSON_ACCEPT}
        with TestClient(create_http_app(config)) as client:
            first = client.post("/mcp/log-tools", headers=headers, json=_initialize_payload(1))
            self.assertEqual(first.status_code, 200)
            first_session = first.headers["mcp-session-id"]

            second = client.post("/mcp/log-tools", headers=headers, json=_initialize_payload(2))
            self.assertEqual(second.status_code, 200)
            second_session = second.headers["mcp-session-id"]
            self.assertNotEqual(first_session, second_session)

            self.assertEqual(client.get("/healthz").json()["session_count"], 1)

            # 最旧的 session 应已被淘汰：再次使用它的 id 会被当作未知 session 拒绝。
            # （Python SDK 对已终止 session 返回 404，TS 端对未知 session 返回 400，均为“不可用”。）
            reused = client.post(
                "/mcp/log-tools",
                headers={**headers, "mcp-session-id": first_session},
                json={"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}},
            )
            self.assertIn(reused.status_code, (400, 404))


if __name__ == "__main__":
    unittest.main()
