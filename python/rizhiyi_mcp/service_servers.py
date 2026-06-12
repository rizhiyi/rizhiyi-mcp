from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from .config import RuntimeConfig
from .dashboard_server import create_dashboard_server as create_dashboard_business_server
from .http_client import LogEaseHttpClient
from .openapi_schema import (
    SchemaOperation,
    build_operation_catalog,
    build_operation_index,
    load_yaml_spec,
)
from .service_fieldconfig import create_fieldconfig_server as create_full_fieldconfig_server
from .service_ingest import create_ingest_server as create_full_ingest_server
from .service_parserrule import create_parserrule_server as create_full_parserrule_server
from .servers import ServiceRuntimeState, create_tool_server, get_current_server_context
from .types import ApiResponse, ToolCallResult, ToolDefinition

_MANAGE_SCHEMA_FILE = "Api_5.3_schema_mini.yaml"
_OPENAPI_SCHEMA_FILE = "Api_5.3_schema.yaml"

_MANAGE_EXCLUDED_MODULE_SERVER_MAP: dict[str, str] = {
    "agent": "ingest",
    "alerts": "manage",
    "parserrules": "parserrule",
    "fieldconfigs": "fieldconfig",
    "dashboard": "dashboard",
    "dashboards": "dashboard",
}


def create_manage_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    tool_definitions = [
        ToolDefinition(
            name="select_module",
            description="列出 manage 入口仍然保留的模块，复杂配置类模块已自动排除。",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "按模块名或摘要做简单过滤。"},
                },
            },
        ),
        ToolDefinition(
            name="select_api_from_module",
            description="从指定模块里列出可用 API；如果该模块已迁到专用服务，会返回迁移建议。",
            input_schema={
                "type": "object",
                "properties": {
                    "module_name": {"type": "string", "description": "模块名称。"},
                    "query": {"type": "string", "description": "按 path 或 summary 做简单过滤。"},
                },
                "required": ["module_name"],
            },
        ),
        ToolDefinition(
            name="gencode_callapi",
            description="执行 manage 入口允许的 API；复杂配置类模块会返回专用服务建议。",
            input_schema={
                "type": "object",
                "properties": {
                    "api_path": {"type": "string", "description": "OpenAPI path。"},
                    "api_method": {"type": "string", "description": "HTTP 方法，如 GET、POST、PUT、DELETE。"},
                    "parameters": {
                        "type": "object",
                        "description": "path/query 参数直接平铺；请求体请放在 body 字段。",
                        "additionalProperties": True,
                    },
                },
                "required": ["api_path", "api_method"],
            },
        ),
    ]

    async def select_module(arguments: dict[str, Any]) -> ToolCallResult:
        modules = _extract_modules(load_yaml_spec(_MANAGE_SCHEMA_FILE), exclude_manage_modules=True)
        query = _normalize_text(arguments.get("query"))
        if query:
            modules = [
                item
                for item in modules
                if query in item["name"].lower() or query in item["description"].lower()
            ]
        payload = {
            "modules": [
                {
                    "name": item["name"],
                    "description": item["description"],
                    "api_count": len(item["apis"]),
                }
                for item in modules
            ]
        }
        return _success_result("select_module", payload)

    async def select_api_from_module(arguments: dict[str, Any]) -> ToolCallResult:
        module_name = _require_str(arguments, "module_name")
        if module_name in _MANAGE_EXCLUDED_MODULE_SERVER_MAP:
            dedicated_server = _MANAGE_EXCLUDED_MODULE_SERVER_MAP[module_name]
            return _error_result(
                "select_api_from_module",
                "USE_DEDICATED_SERVER",
                f"模块 {module_name} 已从 manage 入口排除。",
                f"请改用专用 MCP 服务 `{dedicated_server}`。",
            )

        modules = _extract_modules(load_yaml_spec(_MANAGE_SCHEMA_FILE), exclude_manage_modules=True)
        matched = next((item for item in modules if item["name"] == module_name), None)
        if matched is None:
            return _error_result(
                "select_api_from_module",
                "MODULE_NOT_FOUND",
                f"未找到模块 {module_name}。",
                "请先调用 select_module 查看当前可用模块。",
            )

        query = _normalize_text(arguments.get("query"))
        apis = matched["apis"]
        if query:
            apis = [
                item
                for item in apis
                if query in item["path"].lower() or query in item["summary"].lower()
            ]

        return _success_result(
            "select_api_from_module",
            {
                "module_name": module_name,
                "apis": apis,
            },
        )

    async def gencode_callapi(arguments: dict[str, Any]) -> ToolCallResult:
        api_path = _require_str(arguments, "api_path")
        api_method = _require_str(arguments, "api_method").upper()
        raw_parameters = arguments.get("parameters")
        api_parameters = raw_parameters if isinstance(raw_parameters, dict) else {}
        operation = build_operation_index(_MANAGE_SCHEMA_FILE).get((api_path, api_method))

        if operation is None:
            return _error_result(
                "gencode_callapi",
                "API_NOT_FOUND",
                f"API path {api_path} 或方法 {api_method} 不存在。",
                "请先调用 select_api_from_module 确认 API 路径和 HTTP 方法。",
            )

        if operation.tag in _MANAGE_EXCLUDED_MODULE_SERVER_MAP:
            dedicated_server = _MANAGE_EXCLUDED_MODULE_SERVER_MAP[operation.tag]
            return _error_result(
                "gencode_callapi",
                "USE_DEDICATED_SERVER",
                f"模块 {operation.tag} 已从 manage 入口排除。",
                f"请改用专用 MCP 服务 `{dedicated_server}`。",
            )

        execution = await _execute_schema_operation(operation, api_parameters)
        if execution.error:
            return _error_result(
                "gencode_callapi",
                execution.error_code or "UPSTREAM_REQUEST_FAILED",
                execution.message or execution.error or "上游请求失败。",
                execution.suggestion or "请检查上游地址、认证信息和请求参数。",
                details=execution.details,
            )

        return _success_result(
            "gencode_callapi",
            {
                "api_path": execution.data["path"],
                "api_method": execution.data["method"],
                "params": execution.data["params"],
                "body": execution.data["body"],
                "status": execution.status,
                "data": execution.data["data"],
            },
        )

    return create_tool_server(
        route_name="manage",
        server_name="rizhiyi_manage",
        title="管理服务",
        description="管理类 OpenAPI 的 Python MCP 最小真实入口。",
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=tool_definitions,
        tool_handlers={
            "select_module": select_module,
            "select_api_from_module": select_api_from_module,
            "gencode_callapi": gencode_callapi,
        },
    )


def create_openapi_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    operations = build_operation_catalog(_OPENAPI_SCHEMA_FILE)
    return create_tool_server(
        runtime_config=runtime_config,
        service_state=service_state,
        route_name="openapi",
        server_name="openapi_server",
        title="OpenAPI 服务",
        description="基于完整 OpenAPI schema 动态暴露的全量工具集合。",
        tool_definitions=[
            ToolDefinition(
                name=operation.tool_name,
                description=operation.description,
                input_schema=operation.input_schema,
            )
            for operation in operations
        ],
        tool_handlers={
            operation.tool_name: _build_schema_operation_handler(operation)
            for operation in operations
        },
    )


def create_fieldconfig_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    return create_full_fieldconfig_server(runtime_config, service_state)


def create_parserrule_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    return create_full_parserrule_server(runtime_config, service_state)


def create_ingest_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    return create_full_ingest_server(runtime_config, service_state)


def create_dashboard_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    return create_dashboard_business_server(runtime_config, service_state)


class _SimpleGetTool:
    def __init__(
        self,
        *,
        name: str,
        description: str,
        path: str,
        input_schema: dict[str, Any],
        allowed_query_keys: Iterable[str],
    ) -> None:
        self.name = name
        self.description = description
        self.path = path
        self.input_schema = input_schema
        self.allowed_query_keys = tuple(allowed_query_keys)


def _create_simple_get_server(
    *,
    runtime_config: RuntimeConfig,
    service_state: ServiceRuntimeState,
    route_name: str,
    server_name: str,
    title: str,
    description: str,
    tools: list[_SimpleGetTool],
):
    tool_definitions = [
        ToolDefinition(name=item.name, description=item.description, input_schema=item.input_schema)
        for item in tools
    ]

    handlers = {
        item.name: _build_simple_get_handler(
            tool_name=item.name,
            path=item.path,
            allowed_query_keys=item.allowed_query_keys,
        )
        for item in tools
    }

    return create_tool_server(
        route_name=route_name,
        server_name=server_name,
        title=title,
        description=description,
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=tool_definitions,
        tool_handlers=handlers,
    )


def _build_simple_get_handler(
    *,
    tool_name: str,
    path: str,
    allowed_query_keys: Iterable[str],
):
    allowed = tuple(allowed_query_keys)

    async def handler(arguments: dict[str, Any]) -> ToolCallResult:
        params = {
            key: value
            for key, value in arguments.items()
            if key in allowed and value is not None
        }
        response = await _request_json("get", path, params=params or None)
        if response.error:
            return _upstream_error_result(tool_name, response)
        return _success_result(
            tool_name,
            {
                "path": path,
                "params": params,
                "status": response.status,
                "data": response.data,
            },
        )

    return handler


def _build_schema_operation_handler(operation: SchemaOperation):
    async def handler(arguments: dict[str, Any]) -> ToolCallResult:
        response = await _execute_schema_operation(operation, arguments)
        if response.error:
            return _upstream_error_result(operation.tool_name, response)
        return _success_result(operation.tool_name, response.data or {})

    return handler


async def _execute_schema_operation(operation: SchemaOperation, arguments: dict[str, Any]) -> ApiResponse[Any]:
    try:
        request_parts = _build_request_parts(operation, arguments)
    except ValueError as exc:
        return ApiResponse(
            status=400,
            error=str(exc),
            error_code="INVALID_ARGUMENTS",
            suggestion="请根据该工具的 inputSchema 补齐必填 path 参数和 body 字段。",
            retryable=False,
            message=str(exc),
        )

    response = await _request_json(
        operation.method,
        request_parts["path"],
        params=request_parts["params"],
        headers=request_parts["headers"],
        cookies=request_parts["cookies"],
        data=request_parts["body"],
        content_type=operation.request_body_content_type,
    )
    if response.error:
        return response

    return ApiResponse(
        status=response.status,
        data={
            "method": operation.method,
            "path": request_parts["path"],
            "params": request_parts["params"],
            "headers": request_parts["headers"],
            "body": request_parts["body"],
            "data": response.data,
        },
        message=response.message,
    )


def _build_request_parts(operation: SchemaOperation, arguments: dict[str, Any]) -> dict[str, Any]:
    path = operation.path
    query_params: dict[str, Any] = {}
    headers: dict[str, str] = {}
    cookies: dict[str, Any] = {}

    for parameter in operation.parameters:
        value = arguments.get(parameter.name)
        if parameter.required and value is None:
            raise ValueError(f"缺少必填参数 {parameter.name}。")
        if value is None:
            continue

        if parameter.location == "path":
            path = path.replace(f"{{{parameter.name}}}", str(value))
        elif parameter.location == "query":
            query_params[parameter.name] = value
        elif parameter.location == "header":
            headers[parameter.name] = str(value)
        elif parameter.location == "cookie":
            cookies[parameter.name] = value

    if "{" in path or "}" in path:
        raise ValueError(f"path 参数未完整替换: {path}")

    body = arguments.get("body") if operation.request_body_schema is not None else None
    if operation.request_body_required and body is None:
        raise ValueError("缺少必填参数 body。")

    return {
        "path": path,
        "params": query_params or None,
        "headers": headers or None,
        "cookies": cookies or None,
        "body": body,
    }


async def _request_json(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    cookies: dict[str, Any] | None = None,
    data: Any = None,
    content_type: str | None = None,
) -> ApiResponse[Any]:
    context = get_current_server_context()
    client = LogEaseHttpClient(context.runtime_config.create_http_client_config(context.auth_context))
    try:
        request_headers = dict(headers or {})
        request_kwargs: dict[str, Any] = {"params": params, "cookies": cookies}
        if data is not None:
            if _should_send_json(content_type):
                request_kwargs["json"] = data
            else:
                request_kwargs["data"] = data
                if content_type:
                    request_headers.setdefault("content-type", content_type)
        request_kwargs["headers"] = request_headers or None

        return await client._request(method.upper(), path, **request_kwargs)
    finally:
        await client.close()


def _success_result(tool_name: str, payload: dict[str, Any]) -> ToolCallResult:
    body = {"tool": tool_name, **payload}
    return ToolCallResult(
        structured_content=body,
        content=[{"type": "text", "text": _json_dump(body)}],
        is_error=False,
    )


def _error_result(
    tool_name: str,
    error_code: str,
    message: str,
    suggestion: str,
    *,
    details: Any | None = None,
) -> ToolCallResult:
    body = {
        "tool": tool_name,
        "error_code": error_code,
        "message": message,
        "suggestion": suggestion,
    }
    if details is not None:
        body["details"] = details
    return ToolCallResult(
        structured_content=body,
        content=[{"type": "text", "text": _json_dump(body)}],
        is_error=True,
    )


def _upstream_error_result(tool_name: str, response: ApiResponse[Any]) -> ToolCallResult:
    return _error_result(
        tool_name,
        response.error_code or "UPSTREAM_REQUEST_FAILED",
        response.message or response.error or "上游请求失败。",
        response.suggestion or "请检查上游地址、认证信息和请求参数。",
        details=response.details,
    )


def _extract_modules(specs: dict[str, Any], *, exclude_manage_modules: bool) -> list[dict[str, Any]]:
    modules: dict[str, dict[str, Any]] = {}

    for api_path, path_item in specs.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue

        for method, operation in path_item.items():
            if not isinstance(operation, dict):
                continue

            tag = _get_primary_tag(operation)
            if not tag:
                continue
            if exclude_manage_modules and tag in _MANAGE_EXCLUDED_MODULE_SERVER_MAP:
                continue

            module = modules.setdefault(
                tag,
                {
                    "name": tag,
                    "description": str(operation.get("summary") or tag),
                    "apis": [],
                },
            )
            module["apis"].append(
                {
                    "path": api_path,
                    "method": str(method).upper(),
                    "summary": str(operation.get("summary") or ""),
                    "description": str(operation.get("description") or ""),
                }
            )

    return [
        {
            "name": module["name"],
            "description": module["description"],
            "apis": sorted(module["apis"], key=lambda item: (item["path"], item["method"])),
        }
        for module in sorted(modules.values(), key=lambda item: item["name"])
    ]


def _get_primary_tag(operation: dict[str, Any]) -> str | None:
    tags = operation.get("tags")
    if not isinstance(tags, list) or not tags:
        return None
    first = tags[0]
    return first if isinstance(first, str) else None


def _require_str(arguments: dict[str, Any], key: str) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"缺少必填参数 {key}。")
    return value.strip()


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _json_dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)


def _should_send_json(content_type: str | None) -> bool:
    if not content_type:
        return True
    normalized = content_type.lower()
    return normalized == "application/json" or normalized.endswith("+json")
