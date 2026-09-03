from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from rizhiyi_mcp.config import RuntimeConfig, create_server_context
from rizhiyi_mcp.servers import ServiceRuntimeState, pop_request_runtime_context, push_request_runtime_context
from rizhiyi_mcp.service_chatspl import ChatSplService
from rizhiyi_mcp.sse_client import SseChatResult, SseEvent, SseStep, extract_spl_from_markdown, _process_event
from rizhiyi_mcp.types import ApiResponse, AuthContext

from tests.support import HttpGatewayTestCase, make_api_response


def _api_ok(data) -> ApiResponse:
    return make_api_response(status=200, data=data)


class ChatSplServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.service = ChatSplService()

    def test_list_rules_parses_objects(self) -> None:
        async def fake_request_json(method, path, *, params=None, data=None, headers=None):
            self.assertEqual(path, "/api/v3/chatsplrules/")
            self.assertEqual(params, {"page": 1, "size": 50})
            return _api_ok(
                {
                    "result": True,
                    "meta": {"total": 1},
                    "objects": [
                        {
                            "id": 1,
                            "knowledge_text": '{"input":"华为交换机","output":"appname:huawei_switch"}',
                            "creator_id": 5,
                            "domain_id": 1,
                            "create_time": "2026-09-03",
                            "update_time": "2026-09-03",
                        }
                    ],
                }
            )

        with patch.object(self.service, "request_json", new=fake_request_json):
            result = asyncio.run(self.service.list_rules({"page": 1, "size": 50}))

        self.assertNotIn("error", result)
        data = result["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["input"], "华为交换机")
        self.assertEqual(data["items"][0]["output"], "appname:huawei_switch")

    def test_list_rules_upstream_business_error(self) -> None:
        async def fake_request_json(method, path, *, params=None, data=None, headers=None):
            return _api_ok({"result": False})

        with patch.object(self.service, "request_json", new=fake_request_json):
            result = asyncio.run(self.service.list_rules({"page": 1, "size": 50}))

        self.assertEqual(result["error_code"], "UPSTREAM_BUSINESS_ERROR")

    def test_create_rule_requires_knowledge_text(self) -> None:
        result = asyncio.run(self.service.create_rule({}))
        self.assertEqual(result["error_code"], "MISSING_REQUIRED_PARAM")

    def test_create_rule_rejects_invalid_json(self) -> None:
        result = asyncio.run(self.service.create_rule({"knowledge_text": "not-json"}))
        self.assertEqual(result["error_code"], "INVALID_JSON")

    def test_create_rule_rejects_missing_fields(self) -> None:
        result = asyncio.run(self.service.create_rule({"knowledge_text": '{"input":"x"}'}))
        self.assertEqual(result["error_code"], "INVALID_KNOWLEDGE_TEXT")

    def test_create_rule_success(self) -> None:
        async def fake_request_json(method, path, *, params=None, data=None, headers=None):
            self.assertEqual(method, "post")
            self.assertEqual(path, "/api/v3/chatsplrules/")
            self.assertEqual(data, {"knowledge_text": '{"input":"a","output":"b"}'})
            return _api_ok({"result": True})

        with patch.object(self.service, "request_json", new=fake_request_json):
            result = asyncio.run(self.service.create_rule({"knowledge_text": '{"input":"a","output":"b"}'}))

        self.assertNotIn("error", result)
        self.assertTrue(result["data"]["success"])

    def test_delete_rule_requires_id(self) -> None:
        result = asyncio.run(self.service.delete_rule({"id": 0}))
        self.assertEqual(result["error_code"], "MISSING_REQUIRED_PARAM")

    def test_delete_rule_success(self) -> None:
        async def fake_request_json(method, path, *, params=None, data=None, headers=None):
            self.assertEqual(method, "delete")
            self.assertEqual(path, "/api/v3/chatsplrules/7/")
            return _api_ok({"result": True})

        with patch.object(self.service, "request_json", new=fake_request_json):
            result = asyncio.run(self.service.delete_rule({"id": 7}))

        self.assertNotIn("error", result)
        self.assertTrue(result["data"]["success"])

    def test_delete_rules_batch_builds_id_list(self) -> None:
        async def fake_request_json(method, path, *, params=None, data=None, headers=None):
            self.assertEqual(method, "delete")
            self.assertEqual(path, "/api/v3/chatsplrules/set/")
            self.assertEqual(params, {"id_list": "1,2,3"})
            return _api_ok({"result": True})

        with patch.object(self.service, "request_json", new=fake_request_json):
            result = asyncio.run(self.service.delete_rules_batch({"ids": [1, 2, 3]}))

        self.assertNotIn("error", result)
        self.assertTrue(result["data"]["success"])

    def test_delete_rules_batch_requires_ids(self) -> None:
        result = asyncio.run(self.service.delete_rules_batch({"ids": []}))
        self.assertEqual(result["error_code"], "MISSING_REQUIRED_PARAM")

    def test_chat_spl_requires_content(self) -> None:
        result = asyncio.run(self.service.chat_spl({}))
        self.assertEqual(result["error_code"], "MISSING_REQUIRED_PARAM")

    def test_chat_spl_aggregates_sse_result(self) -> None:
        async def fake_request_sse(*, url, headers, body, config, timeout_ms, **kwargs):
            self.assertIn("/api/v3/copilot/chat/", url)
            self.assertIn("agent=chatspl", url)
            self.assertIn("demo", headers["Authorization"])
            self.assertIn('"content": "检索今天的错误日志"', body)
            return SseChatResult(
                conversation_id=7,
                conversation={"summary": "已完成"},
                spl="appname:gateway count()",
                steps=[
                    SseStep(id="s1", title="生成SPL", status="DONE", tool_name="generate_spl"),
                    SseStep(id="s2", title="发送SPL", status="DONE", tool_name="send_spl"),
                ],
            )

        runtime_config = RuntimeConfig(
            logease_base_url="http://logease.example",
            logease_username="demo",
        )
        auth_context = AuthContext(
            authorization=None,
            headers={"Authorization": "apikey demo-secret"},
            username="demo",
        )
        server_context = create_server_context(runtime_config, auth_context, source="http")
        service_state = ServiceRuntimeState(route_name="chatspl")
        tokens = push_request_runtime_context(server_context, service_state)
        try:
            with patch("rizhiyi_mcp.service_chatspl.request_sse", new=fake_request_sse):
                result = asyncio.run(
                    self.service.chat_spl(
                        {"content": "检索今天的错误日志", "deep_think": True, "lang": "zh_CN"}
                    )
                )
        finally:
            pop_request_runtime_context(tokens)

        self.assertNotIn("error", result)
        data = result["data"]
        self.assertEqual(data["spl"], "appname:gateway count()")
        self.assertEqual(data["conversation_id"], 7)
        self.assertEqual(data["conversation_summary"], "已完成")
        self.assertEqual(len(data["steps"]), 2)

    def test_chat_spl_no_spl_returns_error(self) -> None:
        async def fake_request_sse(*, url, headers, body, config, timeout_ms, **kwargs):
            return SseChatResult()

        runtime_config = RuntimeConfig(logease_base_url="http://logease.example")
        auth_context = AuthContext(authorization=None, headers={"Authorization": "apikey demo-secret"})
        server_context = create_server_context(runtime_config, auth_context, source="http")
        service_state = ServiceRuntimeState(route_name="chatspl")
        tokens = push_request_runtime_context(server_context, service_state)
        try:
            with patch("rizhiyi_mcp.service_chatspl.request_sse", new=fake_request_sse):
                result = asyncio.run(self.service.chat_spl({"content": "查询日志"}))
        finally:
            pop_request_runtime_context(tokens)

        self.assertEqual(result["error_code"], "NO_SPL_GENERATED")

    def test_chat_spl_reports_step_progress(self) -> None:
        async def fake_request_sse(*, url, headers, body, config, timeout_ms, on_event=None, **kwargs):
            if on_event is not None:
                await on_event(SseEvent(event="CREATE_STEP", data='{"id":"s1"}'))
                await on_event(SseEvent(event="CREATE_STEP", data='{"id":"s2"}'))
            return SseChatResult(spl="x")

        progress_calls: list[tuple[int, int, str | None]] = []

        async def on_progress(progress: int, total: int, message: str | None) -> None:
            progress_calls.append((progress, total, message))

        runtime_config = RuntimeConfig(logease_base_url="http://logease.example")
        auth_context = AuthContext(authorization=None, headers={"Authorization": "apikey demo-secret"})
        server_context = create_server_context(runtime_config, auth_context, source="http")
        service_state = ServiceRuntimeState(route_name="chatspl")
        tokens = push_request_runtime_context(server_context, service_state)
        try:
            with patch("rizhiyi_mcp.service_chatspl.request_sse", new=fake_request_sse):
                result = asyncio.run(
                    self.service.chat_spl({"content": "查询日志"}, on_progress=on_progress)
                )
        finally:
            pop_request_runtime_context(tokens)

        self.assertNotIn("error", result)
        self.assertEqual(progress_calls[0], (1, 7, "重写问题"))
        self.assertEqual(progress_calls[1], (2, 7, "问题分类"))


class SseClientTestCase(unittest.TestCase):
    def test_extract_spl_from_markdown_removes_fence(self) -> None:
        content = "结果：\n```spl\nappname:gateway | timechart span=1m count()\n```"
        self.assertEqual(extract_spl_from_markdown(content), "appname:gateway | timechart span=1m count()")

    def test_extract_spl_without_fence_strips_codeblocks(self) -> None:
        content = "```json\n{}\n```  plain"
        self.assertEqual(extract_spl_from_markdown(content), "plain")

    def test_process_events_aggregates_steps_and_spl(self) -> None:
        result = SseChatResult()
        events = [
            SseEvent(event="META", data='{"conversation":{"summary":"已完成"}}'),
            SseEvent(event="CREATE_STEP", data='{"id":"s1","title":"发送SPL","details":{"tool_name":"send_spl"}}'),
            SseEvent(event="SET_STATUS", data='{"id":"s1","status":"DONE"}'),
            SseEvent(
                event="STEP_OUTPUT",
                data='{"id":"s1","content":"```spl\\nappname:x count()\\n```"}',
            ),
            SseEvent(event="DONE", data='{"conversation_id":42}'),
        ]
        for event in events:
            _process_event(event, result)

        self.assertEqual(result.conversation_id, 42)
        self.assertEqual(result.conversation, {"summary": "已完成"})
        self.assertEqual(result.spl, "appname:x count()")
        self.assertEqual(len(result.steps), 1)
        self.assertEqual(result.steps[0].status, "DONE")
        self.assertEqual(result.steps[0].tool_name, "send_spl")


class ChatSplGatewayTestCase(HttpGatewayTestCase):
    def test_chatspl_registered(self) -> None:
        response = self.client.get("/healthz")
        self.assertIn("chatspl", response.json()["registered_servers"])


if __name__ == "__main__":
    unittest.main()
