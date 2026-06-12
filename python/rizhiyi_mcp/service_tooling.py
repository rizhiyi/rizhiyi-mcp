from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import yaml

from .http_client import LogEaseHttpClient
from .servers import get_current_server_context
from .shared_result_store import SharedResultStoreError, save_shared_result
from .types import ApiResponse, SharedResultSummary, ToolCallResult, ToolDefinition

OUTPUT_CONTROL_PROPERTIES: dict[str, Any] = {
    "output_format": {
        "type": "string",
        "description": "输出格式，auto 会自动选择（扁平数组优先 CSV，其他默认 YAML）。",
        "default": "auto",
        "enum": ["auto", "yaml", "csv", "json"],
    },
    "include_raw_json": {
        "type": "boolean",
        "description": "是否在 structuredContent 里附带原始 JSON 数据。",
        "default": False,
    },
    "result_delivery": {
        "type": "string",
        "description": "结果交付方式。auto 小结果内联，大结果转 resource；inline 强制内联；resource 强制转 resource。",
        "default": "auto",
        "enum": ["auto", "inline", "resource"],
    },
    "result_ttl_seconds": {
        "type": "integer",
        "description": "转为 resource 时的保活秒数；未传时使用服务默认 TTL。",
        "minimum": 1,
    },
}


def with_output_controls(tools: list[ToolDefinition]) -> list[ToolDefinition]:
    enriched: list[ToolDefinition] = []
    for tool in tools:
        schema = dict(tool.input_schema)
        properties = dict(schema.get("properties") or {})
        properties.update(OUTPUT_CONTROL_PROPERTIES)
        schema["properties"] = properties
        enriched.append(
            ToolDefinition(
                name=tool.name,
                description=tool.description,
                input_schema=schema,
            )
        )
    return enriched


def _json_dump(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)


def _yaml_dump(payload: Any) -> str:
    return yaml.safe_dump(
        payload,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=120,
    )


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _is_flat_object(value: Any) -> bool:
    return isinstance(value, dict) and all(_is_scalar(item) for item in value.values())


def _can_render_as_csv(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(_is_flat_object(item) for item in value)


def _to_csv(rows: list[dict[str, Any]]) -> str:
    all_keys: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in all_keys:
                all_keys.append(key)

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=all_keys, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key) for key in all_keys})
    return buffer.getvalue().strip()


def _normalize_output_format(value: Any) -> str:
    candidate = str(value or "auto").strip().lower()
    if candidate in {"auto", "yaml", "csv", "json"}:
        return candidate
    return "auto"


def format_success_payload(
    data: Any,
    *,
    output_format: Any = None,
    include_raw_json: bool = False,
    raw_json_data: Any = None,
) -> str:
    resolved_raw_json = data if raw_json_data is None else raw_json_data
    actual_data = {"data": data, "raw_json": resolved_raw_json} if include_raw_json else data
    normalized_output_format = _normalize_output_format(output_format)

    if normalized_output_format == "json":
        return _json_dump(actual_data)

    if normalized_output_format == "csv":
        if _can_render_as_csv(data):
            return _to_csv(data)
        return _yaml_dump(actual_data)

    if normalized_output_format == "yaml":
        return _yaml_dump(actual_data)

    if _can_render_as_csv(data):
        return _to_csv(data)
    return _yaml_dump(actual_data)


def format_error_payload(
    *,
    error_code: str,
    message: str,
    suggestion: str,
    retryable: bool = True,
    details: Any = None,
) -> str:
    return _yaml_dump(
        {
            "error_code": error_code,
            "message": message,
            "suggestion": suggestion,
            "retryable": retryable,
            "details": details,
        }
    )


def build_error_result(
    *,
    error_code: str,
    message: str,
    suggestion: str,
    retryable: bool = True,
    details: Any = None,
) -> ToolCallResult:
    payload = {
        "error_code": error_code,
        "message": message,
        "suggestion": suggestion,
        "retryable": retryable,
        "details": details,
    }
    return ToolCallResult(
        structured_content=payload,
        content=[
            {
                "type": "text",
                "text": format_error_payload(
                    error_code=error_code,
                    message=message,
                    suggestion=suggestion,
                    retryable=retryable,
                    details=details,
                ),
            }
        ],
        is_error=True,
    )


@dataclass(slots=True)
class ServiceToolRuntime:
    route_name: str
    title: str
    default_error_code: str
    default_error_suggestion: str

    async def execute(
        self,
        *,
        tool_name: str,
        arguments: dict[str, Any],
        executor: Callable[[dict[str, Any]], Awaitable[Any]],
    ) -> ToolCallResult:
        try:
            result = await executor(arguments)
        except Exception as exc:  # pragma: no cover - 防守式兜底
            return build_error_result(
                error_code="TOOL_EXECUTION_EXCEPTION",
                message=f"执行工具出错: {exc}",
                suggestion=self.default_error_suggestion,
            )

        if isinstance(result, ApiResponse):
            if result.error:
                return build_error_result(
                    error_code=result.error_code or self.default_error_code,
                    message=result.message or result.error or "上游请求失败。",
                    suggestion=result.suggestion or self.default_error_suggestion,
                    retryable=bool(result.retryable) if result.retryable is not None else True,
                    details=result.details,
                )
            payload = result.data
            raw_json_data = result.data
        else:
            payload = None
            raw_json_data = None

        if isinstance(result, dict) and result.get("error"):
            return build_error_result(
                error_code=str(result.get("error_code") or self.default_error_code),
                message=str(result.get("message") or result.get("error")),
                suggestion=str(result.get("suggestion") or self.default_error_suggestion),
                retryable=bool(result.get("retryable", True)),
                details=result.get("details"),
            )

        if isinstance(result, dict):
            payload = result.get("data", result)
            raw_json_data = result.get("raw_data", payload)
        elif payload is None:
            payload = result
            raw_json_data = result
        include_raw_json = bool(arguments.get("include_raw_json"))
        output_format = arguments.get("output_format")

        structured_payload = payload
        if include_raw_json:
            if isinstance(payload, dict):
                structured_payload = dict(payload)
                structured_payload["raw_json"] = raw_json_data
            else:
                structured_payload = {
                    "value": payload,
                    "raw_json": raw_json_data,
                }

        inline_text = format_success_payload(
            payload,
            output_format=output_format,
            include_raw_json=include_raw_json,
            raw_json_data=raw_json_data,
        )
        return self._deliver_payload(
            tool_name=tool_name,
            payload=structured_payload,
            inline_text=inline_text,
            arguments=arguments,
        )

    def _deliver_payload(
        self,
        *,
        tool_name: str,
        payload: Any,
        inline_text: str,
        arguments: dict[str, Any],
    ) -> ToolCallResult:
        context = get_current_server_context()
        delivery = str(arguments.get("result_delivery", "auto")).strip().lower() or "auto"
        encoded = _json_dump(payload)
        force_resource = delivery == "resource"
        auto_to_resource = (
            delivery == "auto"
            and len(encoded.encode("utf-8")) > context.runtime_config.log_tools_result_inline_max_bytes
        )

        if force_resource or auto_to_resource:
            try:
                envelope = save_shared_result(
                    context.runtime_config,
                    route_name=self.route_name,
                    tool_name=tool_name,
                    result_kind="generic",
                    payload=payload,
                    summary=SharedResultSummary(
                        title=f"{self.title} 工具结果",
                        text=f"{tool_name} 的共享结果，可通过 resource_uri 读取。",
                    ),
                    ttl_seconds=self._parse_ttl_seconds(arguments),
                )
            except SharedResultStoreError as exc:
                return build_error_result(
                    error_code=exc.code,
                    message=str(exc),
                    suggestion="请缩小返回结果，或稍后重试。",
                )

            resource_payload = {
                "delivery": "resource",
                "resource_uri": envelope.resource_uri,
                "resource_title": envelope.resource_title,
                "resource_mime_type": envelope.resource_mime_type,
                "expires_at": envelope.expires_at,
                "payload_bytes": envelope.payload_bytes,
            }
            return ToolCallResult(
                structured_content=resource_payload,
                content=[{"type": "text", "text": _json_dump(resource_payload)}],
                is_error=False,
            )

        inline_payload = {
            "delivery": "inline",
            "data": payload,
        }
        return ToolCallResult(
            structured_content=inline_payload,
            content=[{"type": "text", "text": inline_text}],
            is_error=False,
        )

    def _parse_ttl_seconds(self, arguments: dict[str, Any]) -> int | None:
        raw_value = arguments.get("result_ttl_seconds")
        if raw_value is None:
            return None
        if isinstance(raw_value, bool) or not isinstance(raw_value, int) or raw_value <= 0:
            raise SharedResultStoreError("INVALID_TTL", "result_ttl_seconds 必须是大于 0 的整数。")
        return raw_value


class BaseServiceModule:
    async def request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: Any = None,
        headers: dict[str, str] | None = None,
    ) -> ApiResponse[Any]:
        context = get_current_server_context()
        client = LogEaseHttpClient(context.runtime_config.create_http_client_config(context.auth_context))
        try:
            request = getattr(client, method.lower())
            if method.lower() in {"post", "put"}:
                return await request(path, data=data, params=params, headers=headers)
            return await request(path, params=params, headers=headers)
        finally:
            await client.close()

    @staticmethod
    def build_error(error_code: str, message: str, suggestion: str, details: Any = None) -> dict[str, Any]:
        return {
            "error": message,
            "error_code": error_code,
            "suggestion": suggestion,
            "retryable": True,
            "details": details,
        }

    @staticmethod
    def is_plain_object(value: Any) -> bool:
        return isinstance(value, dict)

    @staticmethod
    def pick_defined(values: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in values.items()
            if value is not None
        }

    @staticmethod
    def ensure_array(value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return list(value.values())
        return []

    @staticmethod
    def try_to_number(value: Any) -> int | float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, str) and value.strip():
            try:
                parsed = float(value)
            except ValueError:
                return None
            return int(parsed) if parsed.is_integer() else parsed
        return None

    def is_upstream_business_error(self, data: Any) -> bool:
        return bool(isinstance(data, dict) and data.get("result") is False)

    def is_missing_required_value(self, value: Any) -> bool:
        if isinstance(value, bool):
            return False
        if isinstance(value, str):
            return not value.strip()
        if isinstance(value, list):
            return len(value) == 0
        return value is None

    def require_id(self, raw_id: Any, message: str, *, suggestion: str = "请提供目标资源 id。") -> dict[str, Any]:
        if raw_id in (None, ""):
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", message, suggestion)}
        return {"value": str(raw_id)}

    def require_non_empty_string(self, raw_value: Any, message: str, suggestion: str) -> dict[str, Any]:
        if not isinstance(raw_value, str) or not raw_value.strip():
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", message, suggestion)}
        return {"value": raw_value.strip()}

    def parse_object_input(self, raw_value: Any, field_name: str, tool_name: str) -> dict[str, Any]:
        if self.is_plain_object(raw_value):
            return {"value": raw_value}

        if not isinstance(raw_value, str):
            return {
                "error": self.build_error(
                    "INVALID_PARAM_TYPE",
                    f"{tool_name} 的 {field_name} 必须是对象。",
                    f"请把 {field_name} 传成对象，或传入可解析为对象的合法 JSON 字符串。",
                )
            }

        trimmed = raw_value.strip()
        if not trimmed:
            return {
                "error": self.build_error(
                    "EMPTY_MUTATION_BODY",
                    f"{tool_name} 的 {field_name} 不能为空字符串。",
                    f"请把 {field_name} 传成对象，或传入合法 JSON 对象字符串。",
                )
            }

        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError as exc:
            return {
                "error": self.build_error(
                    "INVALID_JSON_STRING",
                    f"{tool_name} 的 {field_name} 不是合法 JSON 字符串。",
                    f"请检查 {field_name} 的 JSON 语法，例如引号、逗号、括号是否完整。",
                    {
                        "field": field_name,
                        "parse_error": str(exc),
                        "preview": trimmed[:300],
                    },
                )
            }

        if not self.is_plain_object(parsed):
            return {
                "error": self.build_error(
                    "INVALID_PARAM_TYPE",
                    f"{tool_name} 的 {field_name} 必须是对象。",
                    f"请把 {field_name} 传成对象，或传入可解析为对象的合法 JSON 对象字符串。",
                )
            }
        return {"value": parsed}

    def parse_array_like(self, raw_value: Any) -> dict[str, Any]:
        if isinstance(raw_value, list):
            return {"value": raw_value}

        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"value": []}

            if trimmed.startswith("["):
                try:
                    parsed = json.loads(trimmed)
                except json.JSONDecodeError as exc:
                    return {
                        "error": self.build_error(
                            "INVALID_JSON_STRING",
                            "参数不是合法 JSON 数组字符串。",
                            "请检查 JSON 语法，例如引号、逗号、括号是否完整。",
                            {
                                "parse_error": str(exc),
                                "preview": trimmed[:300],
                            },
                        )
                    }
                if not isinstance(parsed, list):
                    return {
                        "error": self.build_error(
                            "INVALID_PARAM_TYPE",
                            "参数必须是数组。",
                            "请传入数组，或传入可解析为数组的 JSON 字符串。",
                        )
                    }
                return {"value": parsed}

            return {"value": [item.strip() for item in trimmed.split(",") if item.strip()]}

        return {
            "error": self.build_error(
                "INVALID_PARAM_TYPE",
                "参数必须是数组、逗号分隔字符串，或合法 JSON 数组字符串。",
                "请传入数组，或传入逗号分隔字符串。",
            )
        }
