from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from rizhiyi_mcp.http_client import LogEaseHttpClient
from rizhiyi_mcp.openapi_schema import build_operation_catalog
from rizhiyi_mcp.shared_result_store import save_shared_result
from rizhiyi_mcp.types import ApiResponse
from rizhiyi_mcp.types import SharedResultSummary
from tests.support import AUTH_HEADER
from tests.support import HttpGatewayTestCase
from tests.support import RecordedUpstream
from tests.support import STREAMABLE_JSON_ACCEPT
from tests.support import load_curl_json_fixture
from tests.support import make_api_response


class GatewayTestCase(HttpGatewayTestCase):

    def test_healthz(self) -> None:
        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertIn("log-tools", body["registered_servers"])

    def test_initialize_requires_auth(self) -> None:
        response = self.client.post(
            "/mcp/log-tools",
            headers={"Accept": STREAMABLE_JSON_ACCEPT},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "MISSING_AUTHORIZATION")

    def test_initialize_rejects_invalid_authorization_format(self) -> None:
        response = self.client.post(
            "/mcp/log-tools",
            headers={
                "Authorization": "Bearer demo-token",
                "Accept": STREAMABLE_JSON_ACCEPT,
            },
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "INVALID_AUTHORIZATION")

    def test_initialize_requires_streamable_accept(self) -> None:
        response = self.client.post(
            "/mcp/log-tools",
            headers=AUTH_HEADER,
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )

        self.assertEqual(response.status_code, 406)
        self.assertEqual(response.json()["error"], "INVALID_ACCEPT")

    def test_initialize_requires_application_json_content_type(self) -> None:
        response = self.client.post(
            "/mcp/log-tools",
            headers={
                **self._json_headers(),
                "Content-Type": "text/plain",
            },
            content='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        )

        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()["error"], "UNSUPPORTED_CONTENT_TYPE")

    def test_unknown_server_path_returns_server_not_found(self) -> None:
        response = self.client.post(
            "/mcp/unknown-server",
            headers=self._json_headers(),
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "SERVER_NOT_FOUND")

    def test_full_session_flow(self) -> None:
        session_id = self._initialize_session()
        init_body = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={"jsonrpc": "2.0", "id": 99, "method": "initialize", "params": {}},
        ).json()
        self.assertEqual(init_body["result"]["serverInfo"]["name"], "rizhiyi_search")

        initialized_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        self.assertEqual(initialized_response.status_code, 202)
        self.assertEqual(initialized_response.headers["mcp-session-id"], session_id)

        tools_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )
        self.assertEqual(tools_response.status_code, 200)
        tool_names = {tool["name"] for tool in tools_response.json()["result"]["tools"]}
        self.assertTrue(
            {
                "log_search_sheet",
                "list_fields",
                "list_field_values",
                "query_precheck",
            }
            <= tool_names
        )
        self.assertNotIn("describe_server", tool_names)
        self.assertNotIn("echo_payload", tool_names)

        shared_result = save_shared_result(
            self.runtime_config,
            route_name="log-tools",
            tool_name="test_fixture",
            result_kind="generic",
            payload={"hello": "world"},
            summary=SharedResultSummary(title="fixture", text="fixture payload"),
            ttl_seconds=120,
        )
        resource_uri = shared_result.resource_uri

        resources_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={"jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {}},
        )
        self.assertEqual(resources_response.status_code, 200)
        listed_uris = {resource["uri"] for resource in resources_response.json()["result"]["resources"]}
        self.assertIn(resource_uri, listed_uris)

        read_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={
                "jsonrpc": "2.0",
                "id": 4,
                "method": "resources/read",
                "params": {"uri": resource_uri},
            },
        )
        self.assertEqual(read_response.status_code, 200)
        read_body = read_response.json()["result"]["contents"][0]
        self.assertEqual(read_body["uri"], resource_uri)
        self.assertIn('"hello": "world"', read_body["text"])

        delete_response = self.client.delete(
            "/mcp/log-tools",
            headers={"mcp-session-id": session_id},
        )
        self.assertEqual(delete_response.status_code, 204)

        next_session_id = self._initialize_session()
        persisted_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=next_session_id),
            json={"jsonrpc": "2.0", "id": 5, "method": "resources/list", "params": {}},
        )
        persisted_uris = {resource["uri"] for resource in persisted_response.json()["result"]["resources"]}
        self.assertIn(resource_uri, persisted_uris)

        persisted_read_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=next_session_id),
            json={
                "jsonrpc": "2.0",
                "id": 6,
                "method": "resources/read",
                "params": {"uri": resource_uri},
            },
        )
        self.assertEqual(persisted_read_response.status_code, 200)
        persisted_read_body = persisted_read_response.json()["result"]["contents"][0]
        self.assertEqual(persisted_read_body["uri"], resource_uri)
        self.assertIn('"hello": "world"', persisted_read_body["text"])

    def test_post_returns_json_response_under_sdk_transport(self) -> None:
        response = self.client.post(
            "/mcp/log-tools",
            headers=self._sse_headers(),
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("application/json"))
        body = response.json()
        self.assertEqual(body["jsonrpc"], "2.0")
        self.assertEqual(body["id"], 1)
        self.assertIn("mcp-session-id", response.headers)

    def test_get_returns_sse_for_existing_session(self) -> None:
        self.skipTest("官方 streamable-http GET 是持续 SSE 长连接，TestClient 单测容易阻塞，改由集成测试覆盖。")

    def test_non_initialize_requires_session(self) -> None:
        response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(),
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "MISSING_SESSION")

    def test_session_auth_mismatch_rejected(self) -> None:
        session_id = self._initialize_session()

        response = self.client.post(
            "/mcp/log-tools",
            headers={
                "Authorization": "apikey another-user:another-secret",
                "Accept": STREAMABLE_JSON_ACCEPT,
                "mcp-session-id": session_id,
            },
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "SESSION_AUTH_MISMATCH")

    def test_get_requires_valid_session(self) -> None:
        response = self.client.get(
            "/mcp/log-tools",
            headers=self._sse_headers(),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "MISSING_SESSION")

    def test_shared_result_ttl_expiration(self) -> None:
        session_id = self._initialize_session()
        resource_uri = save_shared_result(
            self.runtime_config,
            route_name="log-tools",
            tool_name="ttl_fixture",
            result_kind="generic",
            payload={"ttl": "short"},
            summary=SharedResultSummary(title="ttl", text="short ttl"),
            ttl_seconds=1,
        ).resource_uri

        time.sleep(1.2)

        resources_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={"jsonrpc": "2.0", "id": 7, "method": "resources/list", "params": {}},
        )
        listed_uris = {resource["uri"] for resource in resources_response.json()["result"]["resources"]}
        self.assertNotIn(resource_uri, listed_uris)

        read_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={
                "jsonrpc": "2.0",
                "id": 8,
                "method": "resources/read",
                "params": {"uri": resource_uri},
            },
        )
        error = read_response.json()["error"]
        self.assertEqual(error["code"], -32004)
        self.assertEqual(error["data"]["error_code"], "HANDLE_EXPIRED")

    def test_invalid_resource_uri_rejected(self) -> None:
        session_id = self._initialize_session()
        response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={
                "jsonrpc": "2.0",
                "id": 10,
                "method": "resources/read",
                "params": {"uri": "invalid-uri"},
            },
        )

        error = response.json()["error"]
        self.assertEqual(error["code"], -32004)
        self.assertEqual(error["data"]["error_code"], "INVALID_RESOURCE_URI")

    def _load_parserrule_verify_fixture(self, fixture_name: str) -> dict:
        fixture = load_curl_json_fixture(fixture_name)
        if "rule" not in fixture and "conf" in fixture:
            fixture["rule"] = fixture["conf"]
        return fixture

    def test_log_search_sheet_inline_result_matches_ts_shape(self) -> None:
        session_id = self._initialize_session()

        async def fake_get(_self, path, *, params=None, headers=None):
            self.assertEqual(path, "/api/v3/search/sheets/")
            self.assertEqual(
                params,
                {
                    "query": "status:error",
                    "time_range": "now-15m,now",
                    "index_name": "yotta",
                    "page": 0,
                    "size": 1,
                },
            )
            return ApiResponse(
                status=200,
                data={
                    "results": {
                        "total_hits": 3,
                        "sheets": {
                            "rows": [
                                {
                                    "_time": "2026-06-10T10:00:00Z",
                                    "status": "error",
                                    "trace_id": "trace-1",
                                    "message": "boom",
                                }
                            ]
                        },
                    }
                },
            )

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            response = self.client.post(
                "/mcp/log-tools",
                headers=self._json_headers(session_id=session_id),
                json={
                    "jsonrpc": "2.0",
                    "id": 10,
                    "method": "tools/call",
                    "params": {
                        "name": "log_search_sheet",
                        "arguments": {
                            "query": "status:error",
                            "time_range": "now-15m,now",
                            "size": 1,
                            "fields": ["_time", "trace_id", "_links"],
                        },
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["result"]["structuredContent"]
        self.assertEqual(payload["delivery"], "inline")
        data = payload["data"]
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["page"], 0)
        self.assertEqual(data["size"], 1)
        self.assertEqual(data["returned"], 1)
        self.assertTrue(data["has_more"])
        self.assertEqual(set(data["hits"][0]), {"_time", "trace_id", "_links"})
        self.assertIn("trace_id", data["hits"][0]["_links"])
        self.assertIn("search/?", data["hits"][0]["_links"]["trace_id"])

    def test_log_search_sheet_large_page_auto_promotes_to_resource(self) -> None:
        session_id = self._initialize_session()

        async def fake_get(_self, path, *, params=None, headers=None):
            self.assertEqual(path, "/api/v3/search/sheets/")
            self.assertEqual(params["size"], 30)
            rows = [{"message": f"log-{index}", "status": "info"} for index in range(30)]
            return ApiResponse(
                status=200,
                data={"results": {"total_hits": 60, "sheets": {"rows": rows}}},
            )

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            response = self.client.post(
                "/mcp/log-tools",
                headers=self._json_headers(session_id=session_id),
                json={
                    "jsonrpc": "2.0",
                    "id": 11,
                    "method": "tools/call",
                    "params": {
                        "name": "log_search_sheet",
                        "arguments": {
                            "query": "*",
                            "time_range": "now-15m,now",
                            "size": 30,
                        },
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["result"]["structuredContent"]
        self.assertEqual(payload["delivery"], "resource")
        resource_uri = payload["resource_uri"]
        self.assertEqual(payload["resource_mime_type"], "application/json")

        read_response = self.client.post(
            "/mcp/log-tools",
            headers=self._json_headers(session_id=session_id),
            json={
                "jsonrpc": "2.0",
                "id": 12,
                "method": "resources/read",
                "params": {"uri": resource_uri},
            },
        )
        self.assertEqual(read_response.status_code, 200)
        text = read_response.json()["result"]["contents"][0]["text"]
        self.assertIn('"returned": 30', text)
        self.assertIn('"has_more": true', text)

    def test_list_fields_parses_search_sheets_metadata(self) -> None:
        session_id = self._initialize_session()

        async def fake_get(_self, path, *, params=None, headers=None):
            self.assertEqual(path, "/api/v3/search/sheets/")
            self.assertEqual(params["size"], 0)
            self.assertEqual(params["fields"], True)
            return ApiResponse(
                status=200,
                data={
                    "results": {
                        "fields": [
                            {"name": "status", "type": "string", "dc": 2, "total": 10, "topk": ["error", "info"]},
                            {"name": "hostname", "type": "string", "dc": 3, "total": 10, "topk": ["a", "b"]},
                        ]
                    }
                },
            )

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            response = self.client.post(
                "/mcp/log-tools",
                headers=self._json_headers(session_id=session_id),
                json={
                    "jsonrpc": "2.0",
                    "id": 13,
                    "method": "tools/call",
                    "params": {
                        "name": "list_fields",
                        "arguments": {"query": "*", "time_range": "now-15m,now"},
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["result"]["structuredContent"]
        self.assertEqual(payload["delivery"], "inline")
        self.assertEqual(payload["data"]["total"], 2)
        self.assertEqual(payload["data"]["fields"][0]["name"], "status")
        self.assertEqual(payload["data"]["fields"][0]["distinct_count"], 2)
        self.assertEqual(payload["data"]["fields"][0]["top_values"], ["error", "info"])

    def test_query_precheck_combines_syntax_data_and_field_mapping(self) -> None:
        session_id = self._initialize_session()

        async def fake_get(_self, path, *, params=None, headers=None):
            if path == "/api/v3/search/precheck/":
                self.assertEqual(params["query"], "status:error | stats count by host")
                return ApiResponse(status=200, data={"result": True, "suggestions": ["语法正常"]})
            self.assertEqual(path, "/api/v3/search/sheets/")
            self.assertEqual(params["size"], 2)
            self.assertEqual(params["terminated_after_size"], 50)
            return ApiResponse(
                status=200,
                data={
                    "results": {
                        "total_hits": 4,
                        "fields": [
                            {"name": "host", "type": "string"},
                            {"name": "count", "type": "long"},
                        ],
                        "sheets": {
                            "rows": [
                                {"host": "web-01", "count": 3},
                                {"host": "web-02", "count": 1},
                            ]
                        },
                    }
                },
            )

        with patch("rizhiyi_mcp.log_tools_server.LogEaseHttpClient.get", new=fake_get):
            response = self.client.post(
                "/mcp/log-tools",
                headers=self._json_headers(session_id=session_id),
                json={
                    "jsonrpc": "2.0",
                    "id": 14,
                    "method": "tools/call",
                    "params": {
                        "name": "query_precheck",
                        "arguments": {
                            "query": "status:error | stats count by host",
                            "mode": "full",
                            "time_range": "now-15m,now",
                            "result_delivery": "inline",
                            "expected_fields": ["hostname"],
                            "field_mapping": {"xField": "host", "yField": "count"},
                            "sample_fields": ["host"],
                            "sample_size": 2,
                            "terminated_after_size": 50,
                        },
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["result"]["structuredContent"]
        self.assertEqual(payload["delivery"], "inline")
        data = payload["data"]
        self.assertEqual(data["mode"], "full")
        self.assertTrue(data["syntax_check"]["checked"])
        self.assertTrue(data["syntax_check"]["passed"])
        self.assertTrue(data["data_check"]["checked"])
        self.assertTrue(data["data_check"]["has_data"])
        self.assertEqual(data["available_fields"], ["host", "count"])
        self.assertEqual(data["missing_fields"], ["hostname"])
        self.assertEqual(data["field_suggestions"]["hostname"], ["host"])
        self.assertEqual(data["recommended_next_action"], "fix_field_mapping")
        self.assertEqual(
            data["data_check"]["sample_rows"],
            [
                {"host": "web-01", "count": 3},
                {"host": "web-02", "count": 1},
            ],
        )

    def test_manage_tools_list_and_call(self) -> None:
        session_id = self._initialize_session("manage")

        tools = self._tools_list("manage", session_id)
        self.assertEqual(
            {tool["name"] for tool in tools},
            {"select_module", "select_api_from_module", "gencode_callapi"},
        )

        select_module_result = self._call_tool("manage", session_id, "select_module")
        self.assertFalse(select_module_result["isError"])
        modules = select_module_result["structuredContent"]["modules"]
        self.assertGreater(len(modules), 0)
        module_names = {item["name"] for item in modules}
        self.assertNotIn("dashboard", module_names)
        self.assertNotIn("dashboards", module_names)
        self.assertNotIn("fieldconfigs", module_names)
        self.assertNotIn("parserrules", module_names)

        target_module = modules[0]["name"]
        select_api_result = self._call_tool(
            "manage",
            session_id,
            "select_api_from_module",
            {"module_name": target_module},
            request_id=41,
        )
        self.assertFalse(select_api_result["isError"])
        api_payload = select_api_result["structuredContent"]
        self.assertEqual(api_payload["module_name"], target_module)
        self.assertGreater(len(api_payload["apis"]), 0)

    def test_manage_gencode_callapi_executes_schema_operation(self) -> None:
        calls: list[dict] = []

        async def fake_request(_self, method: str, path: str, **kwargs):
            calls.append(
                {
                    "method": method,
                    "path": path,
                    "params": kwargs.get("params"),
                    "json": kwargs.get("json"),
                    "headers": kwargs.get("headers"),
                }
            )
            return ApiResponse(
                status=200,
                data={
                    "echo_method": method,
                    "echo_path": path,
                    "echo_params": kwargs.get("params") or {},
                    "echo_json": kwargs.get("json"),
                },
            )

        session_id = self._initialize_session("manage")
        with patch.object(LogEaseHttpClient, "_request", new=fake_request):
            path_result = self._call_tool(
                "manage",
                session_id,
                "gencode_callapi",
                {
                    "api_path": "/api/v3/indexes/{id}/",
                    "api_method": "GET",
                    "parameters": {"id": 9},
                },
                request_id=42,
            )
            self.assertFalse(path_result["isError"])
            path_payload = path_result["structuredContent"]
            self.assertEqual(path_payload["api_path"], "/api/v3/indexes/9/")
            self.assertEqual(path_payload["api_method"], "GET")
            self.assertIsNone(path_payload["body"])

            body_result = self._call_tool(
                "manage",
                session_id,
                "gencode_callapi",
                {
                    "api_path": "/api/v3/indexes/",
                    "api_method": "POST",
                    "parameters": {
                        "body": {
                            "name": "core_idx",
                            "pattern": "kNormal",
                            "rotation_period": "7d",
                        }
                    },
                },
                request_id=43,
            )
            self.assertFalse(body_result["isError"])
            body_payload = body_result["structuredContent"]
            self.assertEqual(body_payload["api_path"], "/api/v3/indexes/")
            self.assertEqual(body_payload["api_method"], "POST")
            self.assertEqual(body_payload["body"]["name"], "core_idx")

        self.assertEqual(
            calls,
            [
                {
                    "method": "GET",
                    "path": "/api/v3/indexes/9/",
                    "params": None,
                    "json": None,
                    "headers": None,
                },
                {
                    "method": "POST",
                    "path": "/api/v3/indexes/",
                    "params": None,
                    "json": {
                        "name": "core_idx",
                        "pattern": "kNormal",
                        "rotation_period": "7d",
                    },
                    "headers": None,
                },
            ],
        )

    def test_openapi_server_exposes_full_schema_and_executes_dynamic_tools(self) -> None:
        session_id = self._initialize_session("openapi")
        tools = self._tools_list("openapi", session_id)
        tool_names = {tool["name"] for tool in tools}

        self.assertEqual(len(tools), len(build_operation_catalog("Api_5.3_schema.yaml")))
        self.assertTrue({"get_dashboards_list", "close_acceleration", "create_indexes"} <= tool_names)

        close_acceleration_tool = next(tool for tool in tools if tool["name"] == "close_acceleration")
        self.assertIn("resource_id", close_acceleration_tool["inputSchema"]["properties"])
        self.assertIn("resource_id", close_acceleration_tool["inputSchema"]["required"])

        calls: list[dict] = []

        async def fake_request(_self, method: str, path: str, **kwargs):
            calls.append(
                {
                    "method": method,
                    "path": path,
                    "params": kwargs.get("params"),
                    "json": kwargs.get("json"),
                    "headers": kwargs.get("headers"),
                }
            )
            return ApiResponse(
                status=200,
                data={
                    "echo_method": method,
                    "echo_path": path,
                    "echo_params": kwargs.get("params") or {},
                    "echo_json": kwargs.get("json"),
                },
            )

        with patch.object(LogEaseHttpClient, "_request", new=fake_request):
            path_result = self._call_tool(
                "openapi",
                session_id,
                "close_acceleration",
                {"resource_id": 7, "body": {"resource_type": "index"}},
                request_id=51,
            )
            self.assertFalse(path_result["isError"])
            self.assertEqual(path_result["structuredContent"]["path"], "/api/v3/accelerations/close/7/")
            self.assertEqual(path_result["structuredContent"]["body"], {"resource_type": "index"})

            body_result = self._call_tool(
                "openapi",
                session_id,
                "create_indexes",
                {
                    "body": {
                        "name": "openapi_idx",
                        "pattern": "kNormal",
                        "rotation_period": "7d",
                    }
                },
                request_id=52,
            )
            self.assertFalse(body_result["isError"])
            self.assertEqual(body_result["structuredContent"]["body"]["name"], "openapi_idx")

        self.assertEqual(
            calls,
            [
                {
                    "method": "POST",
                    "path": "/api/v3/accelerations/close/7/",
                    "params": None,
                    "json": {"resource_type": "index"},
                    "headers": None,
                },
                {
                    "method": "POST",
                    "path": "/api/v3/indexes/",
                    "params": None,
                    "json": {
                        "name": "openapi_idx",
                        "pattern": "kNormal",
                        "rotation_period": "7d",
                    },
                    "headers": None,
                },
            ],
        )

    def test_parserrule_service_alignment(self) -> None:
        session_id = self._initialize_session("parserrule")
        tools = self._tools_list("parserrule", session_id)
        tool_names = {tool["name"] for tool in tools}
        self.assertEqual(
            tool_names,
            {
                "list_parserrules",
                "get_parserrule_detail",
                "generate_parserrule_draft",
                "create_parserrule",
                "update_parserrule",
                "delete_parserrule",
                "verify_parserrule",
                "list_parserrule_references",
            },
        )
        create_tool = next(tool for tool in tools if tool["name"] == "create_parserrule")
        self.assertIn("result_delivery", create_tool["inputSchema"]["properties"])
        self.assertIn("output_format", create_tool["inputSchema"]["properties"])

        verify_single_fixture = self._load_parserrule_verify_fixture("verify_single.txt")
        verify_batch_fixture = self._load_parserrule_verify_fixture("verifies.txt")

        def verify_handler(call: dict) -> ApiResponse:
            request_json = call["json"] or {}
            sample_logs = request_json["sample_logs"]
            if sample_logs and isinstance(sample_logs[0], str):
                return make_api_response(
                    data={
                        "result": True,
                        "contents": [
                            {
                                "raw_message": request_json["rawMessage"],
                                "fields": {"time": "13:49:19,975"},
                                "types": {"time": "string"},
                                "parse_result": "success",
                                "timeCostUs": 12,
                            }
                        ],
                    }
                )
            return make_api_response(
                data={
                    "result": True,
                    "contents": [
                        {
                            "raw_message": item.get("raw_message"),
                            "fields": {"raw_message": item.get("raw_message", "")},
                            "types": {"raw_message": "string"},
                            "parse_result": "success",
                            "timeCostUs": 10 + index,
                        }
                        for index, item in enumerate(sample_logs[:2])
                        if isinstance(item, dict)
                    ],
                }
            )

        upstream = RecordedUpstream(
            {
                ("GET", "/api/v3/parserrules/"): make_api_response(data={"result": True, "objects": []}),
                ("POST", "/api/v3/parserrules/"): make_api_response(data={"result": True, "objects": []}),
                ("POST", "/api/v3/parserrules/generate/"): make_api_response(
                    data={"result": True, "summary": "ok", "rules": [{"source": "raw_message"}], "contents": []}
                ),
                ("POST", "/api/v3/parserrules/verify/logtype/"): verify_handler,
            }
        )

        with patch.object(LogEaseHttpClient, "_request", new=upstream.request):
            list_result = self._call_tool(
                "parserrule",
                session_id,
                "list_parserrules",
                {"page": 2, "name": "nginx", "enable": True},
                request_id=101,
            )
            self.assertFalse(list_result["isError"])
            self.assertEqual(list_result["structuredContent"]["delivery"], "inline")

            create_result = self._call_tool(
                "parserrule",
                session_id,
                "create_parserrule",
                {
                    "rule": {
                        "name": "nginx",
                        "conf": [{"source": "raw_message"}],
                        "logtype": "nginx_access",
                        "desc": "demo",
                        "category_id": 1,
                        "enable": True,
                    }
                },
                request_id=102,
            )
            self.assertFalse(create_result["isError"])

            draft_result = self._call_tool(
                "parserrule",
                session_id,
                "generate_parserrule_draft",
                {"sample_logs": ["a=1", "a=2"]},
                request_id=103,
            )
            self.assertFalse(draft_result["isError"])
            self.assertEqual(draft_result["structuredContent"]["data"]["generated_rule_count"], 1)

            verify_result = self._call_tool(
                "parserrule",
                session_id,
                "verify_parserrule",
                {"payload": verify_single_fixture, "domain": "ops", "query_logtype": "verify-single"},
                request_id=104,
            )
            self.assertFalse(verify_result["isError"])
            verify_payload = verify_result["structuredContent"]["data"]
            self.assertEqual(verify_payload["summary"]["success_count"], 1)
            self.assertEqual(verify_payload["samples"][0]["raw_message"], verify_single_fixture["rawMessage"])
            self.assertEqual(verify_payload["samples"][0]["extracted_fields"]["time"], "13:49:19,975")

            batch_verify_result = self._call_tool(
                "parserrule",
                session_id,
                "verify_parserrule",
                verify_batch_fixture,
                request_id=105,
            )
            self.assertFalse(batch_verify_result["isError"])
        list_call, create_call, draft_call, single_verify_call, batch_verify_call = upstream.calls
        self.assertEqual(
            list_call,
            {
                "method": "GET",
                "path": "/api/v3/parserrules/",
                "params": {
                    "fields": "id,name,logtype,desc,enable,from_app,last_modified_time",
                    "page": 2,
                    "name": "nginx",
                    "enable": True,
                },
                "json": None,
                "headers": None,
            },
        )
        self.assertEqual(
            create_call,
            {
                "method": "POST",
                "path": "/api/v3/parserrules/",
                "params": None,
                "json": {
                    "name": "nginx",
                    "conf": '[{"source": "raw_message"}]',
                    "logtype": "nginx_access",
                    "desc": "demo",
                    "category_id": 1,
                    "enable": True,
                },
                "headers": None,
            },
        )
        self.assertEqual(
            draft_call,
            {
                "method": "POST",
                "path": "/api/v3/parserrules/generate/",
                "params": None,
                "json": {"sample_logs": ["a=1", "a=2"]},
                "headers": None,
            },
        )
        self.assertEqual(single_verify_call["method"], "POST")
        self.assertEqual(single_verify_call["path"], "/api/v3/parserrules/verify/logtype/")
        self.assertEqual(single_verify_call["params"], {"domain": "ops", "logtype": "verify-single"})
        self.assertEqual(single_verify_call["json"]["logtype"], verify_single_fixture["logtype"])
        self.assertEqual(single_verify_call["json"]["rawMessage"], verify_single_fixture["rawMessage"])
        self.assertEqual(single_verify_call["json"]["sample_logs"], verify_single_fixture["sample_logs"])
        self.assertTrue(all(isinstance(item, str) for item in single_verify_call["json"]["sample_logs"]))

        self.assertEqual(batch_verify_call["method"], "POST")
        self.assertEqual(batch_verify_call["path"], "/api/v3/parserrules/verify/logtype/")
        self.assertEqual(batch_verify_call["params"], {})
        self.assertEqual(batch_verify_call["json"]["logtype"], verify_batch_fixture["logtype"])
        self.assertEqual(batch_verify_call["json"]["rawMessage"], verify_batch_fixture["sample_logs"][0]["raw_message"])
        self.assertEqual(len(batch_verify_call["json"]["sample_logs"]), len(verify_batch_fixture["sample_logs"]))
        self.assertTrue(all(isinstance(item, dict) for item in batch_verify_call["json"]["sample_logs"]))

        refs_result = self._call_tool(
            "parserrule",
            session_id,
            "list_parserrule_references",
            {"rule_type": "regex"},
            request_id=106,
        )
        self.assertFalse(refs_result["isError"])
        refs_payload = refs_result["structuredContent"]["data"]
        self.assertEqual(refs_payload["type"], "regex")
        self.assertEqual(refs_payload["doc_source"], "docs/parserule.adoc")

    def test_parserrule_verify_invalid_logtype_is_rejected_before_upstream(self) -> None:
        session_id = self._initialize_session("parserrule")
        verify_fixture = self._load_parserrule_verify_fixture("verify_single.txt")
        upstream = RecordedUpstream(
            {
                ("POST", "/api/v3/parserrules/verify/logtype/"): make_api_response(
                    data={"result": True, "contents": []}
                )
            }
        )

        with patch.object(LogEaseHttpClient, "_request", new=upstream.request):
            verify_result = self._call_tool(
                "parserrule",
                session_id,
                "verify_parserrule",
                {
                    "payload": {
                        "rule": verify_fixture["rule"],
                        "conf": verify_fixture["conf"],
                        "sample_logs": verify_fixture["sample_logs"],
                        "enable": verify_fixture["enable"],
                        "logtype": {"unexpected": "shape"},
                    }
                },
                request_id=107,
            )

        self.assertTrue(verify_result["isError"])
        error_payload = verify_result["structuredContent"]
        self.assertEqual(error_payload["error_code"], "INVALID_PARAM_TYPE")
        self.assertIn("logtype", error_payload["message"])
        self.assertEqual(upstream.calls, [])

    def test_fieldconfig_service_alignment(self) -> None:
        session_id = self._initialize_session("fieldconfig")
        tools = self._tools_list("fieldconfig", session_id)
        self.assertEqual(
            {tool["name"] for tool in tools},
            {
                "list_fieldconfigs",
                "verify_fieldconfig",
                "get_fieldconfig_props_reference",
                "get_fieldconfig_transform_reference",
            },
        )

        calls: list[dict] = []

        async def fake_request(_self, method: str, path: str, **kwargs):
            calls.append({"method": method, "path": path, "json": kwargs.get("json")})
            if path == "/api/v3/fieldconfigs/":
                return ApiResponse(
                    status=200,
                    data={
                        "result": True,
                        "objects": [
                            {
                                "app_name": "core",
                                "app_id": 1,
                                "props": {"global": {"alias": {"demo": {"source": "a"}}}},
                                "transform": {"lowercase": {"source": "a"}},
                            }
                        ],
                    },
                )
            if path == "/api/v3/fieldconfigs/verify/":
                return ApiResponse(
                    status=200,
                    data={"result": True, "contents": [{"raw_message": "a=1", "fields": {"a": "1"}, "timeCostUs": 8}]},
                )
            if path == "/api/v3/fieldconfigs/get_props_list/":
                return ApiResponse(
                    status=200,
                    data={
                        "result": True,
                        "objects": [
                            {
                                "dynamicKeyNames": {
                                    "global": {
                                        "alias": {
                                            "demo": {"source": "a", "target": "b"}
                                        }
                                    }
                                }
                            }
                        ],
                    },
                )
            return ApiResponse(
                status=200,
                data={"result": True, "objects": [{"dynamicKeyNames": {"lowercase": {"source": "a"}}}]},
            )

        with patch.object(LogEaseHttpClient, "_request", new=fake_request):
            list_result = self._call_tool("fieldconfig", session_id, "list_fieldconfigs", {}, request_id=111)
            self.assertFalse(list_result["isError"])
            self.assertEqual(list_result["structuredContent"]["data"]["summary"]["total_configs"], 1)

            verify_result = self._call_tool(
                "fieldconfig",
                session_id,
                "verify_fieldconfig",
                {"rule": "(?P<a>\\d+)", "contents": ["a=1"]},
                request_id=112,
            )
            self.assertFalse(verify_result["isError"])
            self.assertEqual(verify_result["structuredContent"]["data"]["summary"]["success_count"], 1)

            props_result = self._call_tool("fieldconfig", session_id, "get_fieldconfig_props_reference", {}, request_id=113)
            self.assertFalse(props_result["isError"])
            self.assertEqual(props_result["structuredContent"]["data"]["entries"][0]["scope"], "global")

            transform_result = self._call_tool("fieldconfig", session_id, "get_fieldconfig_transform_reference", {}, request_id=114)
            self.assertFalse(transform_result["isError"])
            self.assertEqual(transform_result["structuredContent"]["data"]["entries"][0]["transform_name"], "lowercase")

        self.assertEqual(
            calls,
            [
                {"method": "GET", "path": "/api/v3/fieldconfigs/", "json": None},
                {
                    "method": "POST",
                    "path": "/api/v3/fieldconfigs/verify/",
                    "json": {"rule": "(?P<a>\\d+)", "contents": [{"raw_message": "a=1"}]},
                },
                {"method": "GET", "path": "/api/v3/fieldconfigs/get_props_list/", "json": None},
                {"method": "GET", "path": "/api/v3/fieldconfigs/get_transform_list/", "json": None},
            ],
        )

    def test_ingest_service_alignment(self) -> None:
        session_id = self._initialize_session("ingest")
        tools = self._tools_list("ingest", session_id)
        tool_names = {tool["name"] for tool in tools}
        self.assertEqual(len(tools), 21)
        self.assertTrue(
            {
                "list_agents",
                "create_agent_group",
                "list_pipeline_schemas",
                "create_pipeline",
                "replace_pipeline_groups",
                "get_pipeline_agent_status",
                "list_available_pipeline_agents",
            }
            <= tool_names
        )

        calls: list[dict] = []

        async def fake_request(_self, method: str, path: str, **kwargs):
            calls.append(
                {
                    "method": method,
                    "path": path,
                    "params": kwargs.get("params"),
                    "json": kwargs.get("json"),
                }
            )
            if path == "/api/v3/agent/":
                return ApiResponse(status=200, data={"result": True, "objects": [{"id": 1, "ip": "1.1.1.1"}], "meta": {"total": 1, "count": 1}})
            if path == "/api/v3/agentgroup/":
                return ApiResponse(status=200, data={"result": True, "object": {"id": 10, "name": "prod"}})
            if path == "/api/v3/agentgroup/10/add_member/":
                return ApiResponse(status=200, data={"result": True, "objects": [{"id": 1}]})
            if path == "/api/v3/pipelineconfig/schemas/":
                return ApiResponse(status=200, data={"result": True, "data": {"types": [{"name": "filelog"}]}})
            if path == "/api/v3/pipelineconfig/pipelines/":
                return ApiResponse(status=200, data={"result": True, "data": {"id": "pipe-1", "uuid": "uuid-1"}})
            if path == "/api/v3/pipelineconfig/pipelines/pipe-1/groups/":
                return ApiResponse(status=200, data={"result": True, "data": {"groups": [1, 2], "total": 2}})
            if path == "/api/v3/pipelineconfig/pipelines/pipe-1/status/":
                return ApiResponse(status=200, data={"result": True, "data": {"sync_status": [{"id": 1}], "total": 1}})
            return ApiResponse(status=200, data={"result": True, "data": {"agents": [{"id": 1}], "total": 1}})

        with patch.object(LogEaseHttpClient, "_request", new=fake_request):
            list_agents_result = self._call_tool("ingest", session_id, "list_agents", {}, request_id=121)
            self.assertFalse(list_agents_result["isError"])
            self.assertEqual(list_agents_result["structuredContent"]["data"]["summary"]["total"], 1)

            create_group_result = self._call_tool(
                "ingest",
                session_id,
                "create_agent_group",
                {"group": {"name": "prod", "roles": [1]}},
                request_id=122,
            )
            self.assertFalse(create_group_result["isError"])
            self.assertEqual(create_group_result["structuredContent"]["data"]["target_name"], "prod")

            add_agents_result = self._call_tool(
                "ingest",
                session_id,
                "add_agents_to_group",
                {"id": 10, "target_agents": [1, "2"]},
                request_id=123,
            )
            self.assertFalse(add_agents_result["isError"])
            self.assertEqual(add_agents_result["structuredContent"]["data"]["requested_agent_count"], 2)

            schema_result = self._call_tool(
                "ingest",
                session_id,
                "list_pipeline_schemas",
                {"kind": "PluginType", "platform": "linux-x64"},
                request_id=124,
            )
            self.assertFalse(schema_result["isError"])
            self.assertEqual(schema_result["structuredContent"]["data"]["summary"]["schema_count"], 1)

            create_pipeline_result = self._call_tool(
                "ingest",
                session_id,
                "create_pipeline",
                {"pipeline": {"name": "pipe", "platform": "linux-x64", "detail": [{"name": "filelog"}]}},
                request_id=125,
            )
            self.assertFalse(create_pipeline_result["isError"])
            self.assertEqual(create_pipeline_result["structuredContent"]["data"]["target_name"], "pipe")

            replace_groups_result = self._call_tool(
                "ingest",
                session_id,
                "replace_pipeline_groups",
                {"id": "pipe-1", "group_ids": "1,2"},
                request_id=126,
            )
            self.assertFalse(replace_groups_result["isError"])
            self.assertEqual(replace_groups_result["structuredContent"]["data"]["group_ids"], ["1", "2"])

            status_result = self._call_tool(
                "ingest",
                session_id,
                "get_pipeline_agent_status",
                {"id": "pipe-1"},
                request_id=127,
            )
            self.assertFalse(status_result["isError"])
            self.assertEqual(status_result["structuredContent"]["data"]["summary"]["pipeline_id"], "pipe-1")

            available_agents_result = self._call_tool(
                "ingest",
                session_id,
                "list_available_pipeline_agents",
                {"platform": "linux-x64"},
                request_id=128,
            )
            self.assertFalse(available_agents_result["isError"])
            self.assertEqual(available_agents_result["structuredContent"]["data"]["summary"]["platform"], "linux-x64")

        self.assertEqual(
            calls,
            [
                {
                    "method": "GET",
                    "path": "/api/v3/agent/",
                    "params": {
                        "fields": "id,ip,port,hostname,platform,os,status,cur_version,expected_version,last_update_timestamp",
                        "group_ids": "all",
                    },
                    "json": None,
                },
                {
                    "method": "POST",
                    "path": "/api/v3/agentgroup/",
                    "params": None,
                    "json": {"name": "prod", "roles": [1]},
                },
                {
                    "method": "POST",
                    "path": "/api/v3/agentgroup/10/add_member/",
                    "params": None,
                    "json": {
                        "target_agents": [
                            {"id": 1, "group_ids": "10"},
                            {"id": 2, "group_ids": "10"},
                        ]
                    },
                },
                {
                    "method": "GET",
                    "path": "/api/v3/pipelineconfig/schemas/",
                    "params": {"kind": "PluginType", "platform": "linux-x64"},
                    "json": None,
                },
                {
                    "method": "POST",
                    "path": "/api/v3/pipelineconfig/pipelines/",
                    "params": None,
                    "json": {
                        "name": "pipe",
                        "platform": "linux-x64",
                        "detail": '[{"name": "filelog"}]',
                    },
                },
                {
                    "method": "PUT",
                    "path": "/api/v3/pipelineconfig/pipelines/pipe-1/groups/",
                    "params": None,
                    "json": {"group_ids": ["1", "2"]},
                },
                {
                    "method": "GET",
                    "path": "/api/v3/pipelineconfig/pipelines/pipe-1/status/",
                    "params": {"group_ids": "all"},
                    "json": None,
                },
                {
                    "method": "GET",
                    "path": "/api/v3/pipelineconfig/agents/",
                    "params": {"group_ids": "all", "platform": "linux-x64"},
                    "json": None,
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
