from __future__ import annotations

import copy
import inspect
import json
import re
import tempfile
import unittest
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import yaml

from rizhiyi_mcp.config import RuntimeConfig
from rizhiyi_mcp.dashboard_utils import normalize_panel_spec, panel_to_widget
from rizhiyi_mcp.gateway import create_http_app
from rizhiyi_mcp.shared_result_store import save_shared_result
from rizhiyi_mcp.types import ApiResponse

AUTH_HEADER = {"Authorization": "apikey demo-user:demo-secret"}
STREAMABLE_JSON_ACCEPT = "application/json, text/event-stream"
STREAMABLE_SSE_ACCEPT = "text/event-stream, application/json"

REPO_ROOT = Path(__file__).resolve().parents[2]
API_RESPONSES_DIR = REPO_ROOT / "api-responses"
CONFIG_DIR = REPO_ROOT / "config"
_CURL_DATA_RAW_RE = re.compile(r"--data-raw '([\s\S]*?)'\s*(?:\\)?\s*\n\s*--insecure\b")


def fixture_path(*relative_parts: str) -> Path:
    path = API_RESPONSES_DIR.joinpath(*relative_parts)
    if not path.exists():
        raise FileNotFoundError(f"fixture not found: {path}")
    return path


def config_fixture_path(*relative_parts: str) -> Path:
    path = CONFIG_DIR.joinpath(*relative_parts)
    if not path.exists():
        raise FileNotFoundError(f"fixture not found: {path}")
    return path


def load_text_fixture(*relative_parts: str) -> str:
    return fixture_path(*relative_parts).read_text(encoding="utf-8")


def load_json_fixture(*relative_parts: str) -> Any:
    return json.loads(load_text_fixture(*relative_parts))


def load_config_text_fixture(*relative_parts: str) -> str:
    return config_fixture_path(*relative_parts).read_text(encoding="utf-8")


def load_yaml_fixture(*relative_parts: str) -> Any:
    return yaml.safe_load(load_config_text_fixture(*relative_parts))


def load_api_response_fixture(
    *relative_parts: str,
    status: int = 200,
    error: str | None = None,
    error_code: str | None = None,
    message: str | None = None,
    suggestion: str | None = None,
    retryable: bool | None = None,
    details: Any = None,
) -> ApiResponse[Any]:
    return make_api_response(
        status=status,
        data=load_json_fixture(*relative_parts),
        error=error,
        error_code=error_code,
        message=message,
        suggestion=suggestion,
        retryable=retryable,
        details=details,
    )


def clone_fixture_data(value: Any) -> Any:
    return copy.deepcopy(value)


def load_curl_json_fixture(*relative_parts: str) -> dict[str, Any]:
    text = load_text_fixture(*relative_parts)
    match = _CURL_DATA_RAW_RE.search(text)
    if match is None:
        raise ValueError(f"fixture does not contain --data-raw JSON payload: {fixture_path(*relative_parts)}")
    payload = json.loads(match.group(1))
    if not isinstance(payload, dict):
        raise ValueError(f"fixture payload must decode to object: {fixture_path(*relative_parts)}")
    return payload


def make_api_response(
    *,
    status: int = 200,
    data: Any = None,
    error: str | None = None,
    error_code: str | None = None,
    message: str | None = None,
    suggestion: str | None = None,
    retryable: bool | None = None,
    details: Any = None,
) -> ApiResponse[Any]:
    return ApiResponse(
        status=status,
        data=data,
        error=error,
        error_code=error_code,
        message=message,
        suggestion=suggestion,
        retryable=retryable,
        details=details,
    )


def api_response(**kwargs) -> ApiResponse[Any]:
    return make_api_response(**kwargs)


def search_sheets_response(rows: list[dict[str, Any]], *, total_hits: int | None = None) -> ApiResponse[Any]:
    results: dict[str, Any] = {"sheets": {"rows": rows}}
    if total_hits is not None:
        results["total_hits"] = total_hits
    return make_api_response(data={"results": results})


def search_sheets_response_from_fixture(*relative_parts: str, status: int = 200) -> ApiResponse[Any]:
    return make_api_response(status=status, data=load_json_fixture(*relative_parts))


def search_rows_from_fixture(*relative_parts: str) -> list[dict[str, Any]]:
    payload = load_json_fixture(*relative_parts)
    rows = payload.get("results", {}).get("sheets", {}).get("rows", [])
    return [clone_fixture_data(row) for row in rows if isinstance(row, dict)]


def time_series_rows_from_fixture(*relative_parts: str) -> list[dict[str, Any]]:
    payload = load_json_fixture(*relative_parts)
    rows = payload.get("results", {}).get("sheets", {}).get("rows", [])
    return [clone_fixture_data(row) for row in rows if isinstance(row, dict)]


def dashboard_panel_specs_fixture() -> list[dict[str, Any]]:
    return [
        {
            "title": "请求趋势",
            "type": "trend",
            "query": "appname:gateway | timechart span=5m count() as cnt",
            "time_range": "-1h,now",
            "chartType": "line",
            "xField": "_time",
            "yField": "cnt",
            "color": "#F6903D",
        },
        {
            "title": "状态分布",
            "type": "trend",
            "query": "appname:gateway | stats count() by logtype",
            "time_range": "-1h,now",
            "chartType": "table",
            "xField": "logtype",
            "yField": "count",
            "color": "#59D8A6",
        },
        {
            "title": "异常告警",
            "type": "single",
            "query": "appname:gateway | stats count() as cnt",
            "time_range": "-15m,now",
            "chartType": "single",
            "yField": "cnt",
            "description": "最近 15 分钟异常汇总",
            "color": "#7162FD",
        },
    ]


def dashboard_spec_fixture(
    *,
    name: str = "服务观测仪表盘",
    scheme: str = "schemecat3",
    tab_name: str = "总览",
) -> dict[str, Any]:
    return {
        "name": name,
        "scheme": scheme,
        "tabs": [
            {
                "name": tab_name,
                "scheme": scheme,
                "panels": clone_fixture_data(dashboard_panel_specs_fixture()),
            }
        ],
    }


def dashboard_tab_content_fixture(*, scheme: str = "schemecat3") -> dict[str, Any]:
    widgets = [
        panel_to_widget(normalize_panel_spec(panel, index), index)
        for index, panel in enumerate(dashboard_panel_specs_fixture())
    ]
    return {
        "refresh": {"time": 3, "unit": "m", "on": False, "showRefreshProcess": True},
        "showFilters": True,
        "showTitle": True,
        "editable": True,
        "scheme": scheme,
        "theme": "day",
        "activeDrilldown": False,
        "autoUpdate": True,
        "filters": [],
        "widgets": widgets,
    }


def dashboard_fixture(
    *,
    dashboard_id: str = "7001",
    tab_id: str = "7101",
    name: str = "服务观测仪表盘",
    app_id: int = 1,
    scheme: str = "schemecat3",
) -> dict[str, Any]:
    return {
        "id": str(dashboard_id),
        "name": name,
        "app_id": app_id,
        "data_user": "viewer",
        "export": "local",
        "tabs": [
            {
                "id": str(tab_id),
                "name": "总览",
                "content": json.dumps(dashboard_tab_content_fixture(scheme=scheme), ensure_ascii=False),
            }
        ],
    }


class RecordedUpstream:
    def __init__(self, handlers: dict[tuple[str, str], Any] | None = None) -> None:
        self.handlers = {(method.upper(), path): handler for (method, path), handler in (handlers or {}).items()}
        self.calls: list[dict[str, Any]] = []
        
        async def request(_client: Any, method: str, path: str, **kwargs) -> ApiResponse[Any]:
            return await self._handle_request(method, path, **kwargs)

        self.request = request

    def add(self, method: str, path: str, handler: Any) -> None:
        self.handlers[(method.upper(), path)] = handler

    async def _handle_request(self, method: str, path: str, **kwargs) -> ApiResponse[Any]:
        call = {
            "method": method.upper(),
            "path": path,
            "params": kwargs.get("params"),
            "json": kwargs.get("json"),
            "headers": kwargs.get("headers"),
        }
        self.calls.append(call)
        handler = self.handlers.get((call["method"], path))
        if handler is None:
            raise AssertionError(f"unexpected upstream call: {call}")
        result = handler(call) if callable(handler) else handler
        if inspect.isawaitable(result):
            result = await result
        return result


class HttpGatewayTestCase(unittest.TestCase):
    def build_runtime_config(self) -> RuntimeConfig:
        return RuntimeConfig(
            logease_base_url="http://logease.example",
            log_tools_result_store_dir=Path(self.temp_dir.name),
            log_tools_result_ttl_seconds=60,
            log_tools_result_inline_max_bytes=1024 * 1024,
            log_tools_result_max_file_bytes=5 * 1024 * 1024,
        )

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.runtime_config = self.build_runtime_config()
        self._client_cm = TestClient(create_http_app(self.runtime_config))
        self.client = self._client_cm.__enter__()

    def tearDown(self) -> None:
        self._client_cm.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def save_shared_result_fixture(self, **kwargs):
        return save_shared_result(self.runtime_config, **kwargs)

    def _json_headers(self, *, session_id: str | None = None) -> dict[str, str]:
        headers = {**AUTH_HEADER, "Accept": STREAMABLE_JSON_ACCEPT}
        if session_id:
            headers["mcp-session-id"] = session_id
        return headers

    def _sse_headers(self, *, session_id: str | None = None) -> dict[str, str]:
        headers = {**AUTH_HEADER, "Accept": STREAMABLE_SSE_ACCEPT}
        if session_id:
            headers["mcp-session-id"] = session_id
        return headers

    def _initialize_session(self, route_name: str = "log-tools") -> str:
        response = self.client.post(
            f"/mcp/{route_name}",
            headers=self._json_headers(),
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "1.0.0"},
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        return response.headers["mcp-session-id"]

    def _tools_list(self, route_name: str, session_id: str) -> list[dict[str, Any]]:
        response = self.client.post(
            f"/mcp/{route_name}",
            headers=self._json_headers(session_id=session_id),
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["result"]["tools"]

    def _call_tool(
        self,
        route_name: str,
        session_id: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        *,
        request_id: int = 3,
    ) -> dict[str, Any]:
        response = self.client.post(
            f"/mcp/{route_name}",
            headers=self._json_headers(session_id=session_id),
            json={
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments or {}},
            },
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["result"]


class BaseMcpHttpTestCase(HttpGatewayTestCase):
    pass


class LogToolsHttpTestCase(HttpGatewayTestCase):
    def _initialize_session(self) -> str:
        return super()._initialize_session("log-tools")

    def _tools_list(self, session_id: str) -> list[dict[str, Any]]:
        return super()._tools_list("log-tools", session_id)

    def _call_tool(
        self,
        session_id: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        *,
        request_id: int = 3,
    ) -> dict[str, Any]:
        return super()._call_tool("log-tools", session_id, tool_name, arguments, request_id=request_id)["structuredContent"]


class FakeDashboardUpstream:
    def __init__(self, *, reject_first_app_id_create: bool = False) -> None:
        self.next_dashboard_id = 1000
        self.next_tab_id = 2000
        self.dashboards: dict[str, dict[str, Any]] = {}
        self.reject_first_app_id_create = reject_first_app_id_create
        self._rejected_app_id_create = False
        self.dashboard_create_payloads: list[dict[str, Any]] = []

        async def request(_client: Any, method: str, path: str, **kwargs) -> ApiResponse[Any]:
            return await self._handle_request(method, path, **kwargs)

        self.request = request

    def seed_dashboard(self, dashboard: dict[str, Any]) -> str:
        seeded = clone_fixture_data(dashboard)
        dashboard_id = str(seeded.get("id") or self.next_dashboard_id)
        seeded["id"] = dashboard_id
        tabs = seeded.get("tabs") if isinstance(seeded.get("tabs"), list) else []
        normalized_tabs = []
        max_tab_id = 0
        for index, tab in enumerate(tabs):
            if not isinstance(tab, dict):
                continue
            tab_id = str(tab.get("id") or (self.next_tab_id + index))
            try:
                max_tab_id = max(max_tab_id, int(tab_id))
            except ValueError:
                pass
            content = tab.get("content")
            if isinstance(content, dict):
                content = json.dumps(content, ensure_ascii=False)
            normalized_tabs.append(
                {
                    "id": tab_id,
                    "name": tab.get("name") or f"Tab {index + 1}",
                    "content": content,
                }
            )
        seeded["tabs"] = normalized_tabs
        self.dashboards[dashboard_id] = seeded
        try:
            self.next_dashboard_id = max(self.next_dashboard_id, int(dashboard_id) + 1)
        except ValueError:
            pass
        if max_tab_id:
            self.next_tab_id = max(self.next_tab_id, max_tab_id + 1)
        return dashboard_id

    async def _handle_request(self, method: str, path: str, **kwargs) -> ApiResponse[Any]:
        params = kwargs.get("params") or {}
        body = kwargs.get("json") or {}
        normalized_method = method.upper()

        if normalized_method == "GET" and path == "/api/v3/dashboards/":
            objects = list(self.dashboards.values())
            if "name" in params:
                objects = [item for item in objects if params["name"] in str(item.get("name", ""))]
            return make_api_response(data={"objects": objects, "count": len(objects)})

        if normalized_method == "POST" and path == "/api/v3/dashboards/":
            create_payload = {
                "name": body["name"],
                "data_user": body.get("data_user"),
                "export": body.get("export"),
                "active_tab": body.get("active_tab"),
                "default_display": body.get("default_display"),
            }
            if "app_id" in body:
                create_payload["app_id"] = body["app_id"]
            self.dashboard_create_payloads.append(create_payload)
            if self.reject_first_app_id_create and body.get("app_id") and not self._rejected_app_id_create:
                self._rejected_app_id_create = True
                return make_api_response(
                    status=200,
                    data={"error": {"code": "8703", "message": "app not found"}},
                )
            dashboard_id = str(self.next_dashboard_id)
            self.next_dashboard_id += 1
            dashboard = {
                "id": dashboard_id,
                "name": body["name"],
                "app_id": body.get("app_id"),
                "data_user": body.get("data_user"),
                "export": body.get("export"),
                "tabs": [],
            }
            self.dashboards[dashboard_id] = dashboard
            return make_api_response(data={"object": {"id": dashboard_id}})

        if normalized_method == "GET" and path.startswith("/api/v3/dashboards/") and path.endswith("/"):
            dashboard_id = path.split("/")[4]
            dashboard = self.dashboards.get(dashboard_id)
            if dashboard is None:
                return make_api_response(
                    status=404,
                    error="not found",
                    error_code="UPSTREAM_HTTP_ERROR",
                    message="请求失败: HTTP 404",
                )
            return make_api_response(data={"object": dashboard})

        if normalized_method == "POST" and "/tabs/" in path:
            dashboard_id = path.split("/")[4]
            dashboard = self.dashboards[dashboard_id]
            tab_id = str(self.next_tab_id)
            self.next_tab_id += 1
            tab = {"id": tab_id, "name": body["name"], "content": body["content"]}
            dashboard["tabs"].append(tab)
            return make_api_response(data={"object": tab})

        if normalized_method == "PUT" and "/tabs/" in path:
            dashboard_id = path.split("/")[4]
            tab_id = path.split("/")[6]
            dashboard = self.dashboards[dashboard_id]
            for tab in dashboard["tabs"]:
                if str(tab["id"]) == str(tab_id):
                    tab["name"] = body["name"]
                    tab["content"] = body["content"]
                    return make_api_response(data={"object": tab})
            return make_api_response(
                status=404,
                error="tab not found",
                error_code="UPSTREAM_HTTP_ERROR",
                message="请求失败: HTTP 404",
            )

        raise AssertionError(f"unexpected upstream call: {normalized_method} {path} {kwargs}")
