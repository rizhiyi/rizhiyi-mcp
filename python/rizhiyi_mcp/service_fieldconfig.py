from __future__ import annotations

import json
from typing import Any

from .config import RuntimeConfig
from .servers import ServiceRuntimeState, create_tool_server
from .service_tooling import BaseServiceModule, ServiceToolRuntime, with_output_controls
from .types import ToolDefinition

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
1. 这是动态字段专用入口，只处理 fieldconfigs，也就是 schema on read / 动态字段能力，不处理 parserrules 的字段提取能力。
2. 当前提供动态字段列表、fieldconfigs/verify、props 参考、transform 参考 4 类工具。
3. verify_fieldconfig 需要 rule 和 contents；contents 支持对象数组、字符串数组、单个对象、字符串，也兼容合法 JSON 字符串。
4. get_fieldconfig_props_reference 和 get_fieldconfig_transform_reference 会把原始配置整理成更适合 LLM 阅读的模板摘要。
5. 推荐流程：先 list_fieldconfigs 看现状，再按需 verify_fieldconfig 校验表达式，最后结合 props/transform 参考继续拼装动态字段配置。
6. 输出默认使用 output_format=auto，以减少上下文消耗。
7. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。"""

VERIFY_SAMPLE_TEXT_KEYS = ("raw_message", "rawMessage", "message", "log", "content")

FIELD_CONFIG_TOOLS = with_output_controls(
    [
        ToolDefinition(
            name="list_fieldconfigs",
            description="列出动态字段配置列表，也就是 schema on read 能力的当前配置概览。会按应用整理 props/transform，并补充作用域、模板数量、transform 名称等摘要信息。",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="verify_fieldconfig",
            description="校验动态字段规则。底层调用 `fieldconfigs/verify`；需要传 rule 和 contents。contents 支持对象数组、字符串数组、单个对象、字符串，也兼容合法 JSON 字符串。返回结果会整理成更适合 LLM 阅读的字段提取摘要。",
            input_schema={
                "type": "object",
                "properties": {
                    "rule": {"type": "string", "description": "动态字段校验规则字符串，例如正则表达式。"},
                    "contents": {
                        "oneOf": [
                            {"type": "array", "items": {"oneOf": [{"type": "object"}, {"type": "string"}]}},
                            {"type": "object", "additionalProperties": True},
                            {"type": "string"},
                        ],
                        "description": "待校验内容；支持对象数组、字符串数组、单个对象、字符串，或可解析为这些结构的 JSON 字符串。",
                    },
                },
                "required": ["rule", "contents"],
            },
        ),
        ToolDefinition(
            name="get_fieldconfig_props_reference",
            description="读取动态字段 props 参考配置，并整理成适合 LLM 阅读的“scope / config_type / template / key_fields / example”结构，供后续动态字段配置时参考 alias、lookup、dictionary 等模板。",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="get_fieldconfig_transform_reference",
            description="读取动态字段 transform 参考配置，并整理成适合 LLM 阅读的“transform_name / key_fields / example”结构，供后续动态字段配置时参考 lowercase、substring 等转换模板。",
            input_schema={"type": "object", "properties": {}},
        ),
    ]
)


class FieldConfigService(BaseServiceModule):
    async def list_fieldconfigs(self, _: dict[str, Any]) -> Any:
        response = await self.request_json("get", "/api/v3/fieldconfigs/")
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "list_fieldconfigs 上游接口返回失败。",
                "请稍后重试；如果问题持续，请检查 fieldconfigs 列表接口状态。",
                response.data,
            )
        return {"raw_data": response.data, "data": self.format_fieldconfig_list_response(response.data)}

    async def verify_fieldconfig(self, params: dict[str, Any]) -> Any:
        request = self.build_verify_request(params)
        if request.get("error"):
            return request["error"]
        response = await self.request_json("post", "/api/v3/fieldconfigs/verify/", data=request["payload"])
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "verify_fieldconfig 上游接口返回失败。",
                "请检查 rule 与 contents 是否匹配；如果参数没问题，再检查上游 fieldconfigs/verify 接口状态。",
                response.data,
            )
        return {"raw_data": response.data, "data": self.format_verify_response(response.data, request["payload"])}

    async def get_fieldconfig_props_reference(self, _: dict[str, Any]) -> Any:
        response = await self.request_json("get", "/api/v3/fieldconfigs/get_props_list/")
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "get_fieldconfig_props_reference 上游接口返回失败。",
                "请稍后重试；如果问题持续，请检查 fieldconfigs props 接口状态。",
                response.data,
            )
        return {"raw_data": response.data, "data": self.format_props_reference_response(response.data)}

    async def get_fieldconfig_transform_reference(self, _: dict[str, Any]) -> Any:
        response = await self.request_json("get", "/api/v3/fieldconfigs/get_transform_list/")
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "get_fieldconfig_transform_reference 上游接口返回失败。",
                "请稍后重试；如果问题持续，请检查 fieldconfigs transform 接口状态。",
                response.data,
            )
        return {"raw_data": response.data, "data": self.format_transform_reference_response(response.data)}

    def build_verify_request(self, params: dict[str, Any]) -> dict[str, Any]:
        rule = params.get("rule").strip() if isinstance(params.get("rule"), str) else ""
        if not rule:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "verify_fieldconfig 需要 rule。", "请提供动态字段规则字符串，例如正则表达式。")}

        contents = self.normalize_contents(params.get("contents"))
        if contents.get("error"):
            return {"error": contents["error"]}
        if not contents["value"]:
            return {"error": self.build_error("EMPTY_CONTENTS", "verify_fieldconfig 的 contents 不能为空。", "请至少提供 1 条待校验内容；支持对象数组、字符串数组、单个对象或字符串。")}

        return {"payload": {"rule": rule, "contents": contents["value"]}}

    def normalize_contents(self, raw_value: Any) -> dict[str, Any]:
        if raw_value is None:
            return {"error": self.build_error("MISSING_REQUIRED_PARAM", "verify_fieldconfig 需要 contents。", "请提供待校验内容；支持对象数组、字符串数组、单个对象或字符串。")}
        if isinstance(raw_value, str):
            trimmed = raw_value.strip()
            if not trimmed:
                return {"value": []}
            if trimmed.startswith("[") or trimmed.startswith("{"):
                parsed = self.parse_json_string_field(trimmed, "contents")
                if parsed.get("error"):
                    return {"error": parsed["error"]}
                return self.normalize_contents(parsed["value"])
            return {"value": [{"raw_message": trimmed}]}
        if isinstance(raw_value, list):
            return {"value": [self.normalize_content_entry(item) for item in raw_value]}
        if self.is_plain_object(raw_value):
            return {"value": [self.normalize_content_entry(raw_value)]}
        return {"error": self.build_error("INVALID_PARAM_TYPE", "verify_fieldconfig 的 contents 必须是数组、对象、字符串，或合法 JSON 字符串。", "请把 contents 传成字符串数组、对象数组、单个对象，或传入可解析为这些结构的 JSON 字符串。")}

    def normalize_content_entry(self, content: Any) -> Any:
        if isinstance(content, str):
            return {"raw_message": content}
        if self.is_plain_object(content):
            return content
        return {"raw_message": str(content)}

    def parse_json_string_field(self, raw_value: str, field_name: str) -> dict[str, Any]:
        try:
            return {"value": json.loads(raw_value)}
        except json.JSONDecodeError as exc:
            return {"error": self.build_error("INVALID_JSON", f"verify_fieldconfig 的 {field_name} 不是合法 JSON。", f"请检查 {field_name} 的 JSON 语法，例如引号、逗号、括号是否完整；如果本意不是传 JSON，请改用原生对象/数组。", {"field": field_name, "parse_error": str(exc), "preview": raw_value[:300]})}

    def format_fieldconfig_list_response(self, data: Any) -> dict[str, Any]:
        objects = data.get("objects") if isinstance(data, dict) and isinstance(data.get("objects"), list) else []
        items = []
        for index, item in enumerate(objects):
            props = item.get("props") if self.is_plain_object(item) and self.is_plain_object(item.get("props")) else {}
            transform = item.get("transform") if self.is_plain_object(item) and self.is_plain_object(item.get("transform")) else {}
            prop_scopes = list(props.keys())
            transform_names = list(transform.keys())
            items.append(
                {
                    "index": index,
                    "app_name": item.get("app_name") if self.is_plain_object(item) else None,
                    "app_id": item.get("app_id") if self.is_plain_object(item) else None,
                    "prop_scopes": prop_scopes,
                    "prop_scope_count": len(prop_scopes),
                    "prop_template_count": self.count_nested_entries(props),
                    "transform_names": transform_names,
                    "transform_count": len(transform_names),
                    "props": props,
                    "transform": transform,
                }
            )
        return {
            "traceid": data.get("traceid") if isinstance(data, dict) else None,
            "upstream_result": data.get("result") if isinstance(data, dict) else None,
            "summary": {"total_configs": len(items), "app_names": [item["app_name"] for item in items if item["app_name"]]},
            "items": items,
        }

    def format_verify_response(self, data: Any, request_payload: dict[str, Any]) -> dict[str, Any]:
        contents = data.get("contents") if isinstance(data, dict) and isinstance(data.get("contents"), list) else []
        samples = []
        for index, content in enumerate(contents):
            fields = content.get("fields") if self.is_plain_object(content) and self.is_plain_object(content.get("fields")) else {}
            samples.append(
                {
                    "index": index,
                    "raw_message": self.extract_sample_text(content),
                    "extracted_field_names": list(fields.keys()),
                    "extracted_fields": fields,
                    "time_cost_us": content.get("timeCostUs") if self.is_plain_object(content) and isinstance(content.get("timeCostUs"), (int, float)) else self.try_to_number(content.get("timeCostUs") if self.is_plain_object(content) else None),
                    "runtime": content.get("runtime") if self.is_plain_object(content) and isinstance(content.get("runtime"), (int, float)) else self.try_to_number(content.get("runtime") if self.is_plain_object(content) else None),
                    "success": bool(fields),
                }
            )
        success_count = len([item for item in samples if item["success"]])
        return {
            "traceid": data.get("traceid") if isinstance(data, dict) else None,
            "upstream_result": data.get("result") if isinstance(data, dict) else None,
            "request_overview": {"rule": request_payload.get("rule"), "content_count": len(request_payload.get("contents") or [])},
            "summary": {"total_samples": len(samples), "success_count": success_count, "failure_count": len(samples) - success_count},
            "samples": samples,
        }

    def format_props_reference_response(self, data: Any) -> dict[str, Any]:
        objects = data.get("objects") if isinstance(data, dict) and isinstance(data.get("objects"), list) else []
        scopes: set[str] = set()
        config_types: set[str] = set()
        entries: list[dict[str, Any]] = []

        for item in objects:
            dynamic_key_names = item.get("dynamicKeyNames") if self.is_plain_object(item) and self.is_plain_object(item.get("dynamicKeyNames")) else {}
            for scope_name, scope_value in dynamic_key_names.items():
                scopes.add(scope_name)
                if not self.is_plain_object(scope_value):
                    entries.append({"scope": scope_name, "config_type": "unknown", "template_name": None, "key_fields": self.extract_top_level_keys(scope_value), "example": scope_value})
                    continue
                for config_type, template_map in scope_value.items():
                    config_types.add(config_type)
                    if not self.is_plain_object(template_map):
                        entries.append({"scope": scope_name, "config_type": config_type, "template_name": None, "key_fields": self.extract_top_level_keys(template_map), "example": template_map})
                        continue
                    template_entries = list(template_map.items())
                    if not template_entries:
                        entries.append({"scope": scope_name, "config_type": config_type, "template_name": None, "key_fields": [], "example": template_map})
                        continue
                    for template_name, template_value in template_entries:
                        entries.append({"scope": scope_name, "config_type": config_type, "template_name": template_name, "key_fields": self.extract_top_level_keys(template_value), "example": template_value})

        return {
            "traceid": data.get("traceid") if isinstance(data, dict) else None,
            "upstream_result": data.get("result") if isinstance(data, dict) else None,
            "summary": {
                "total_reference_groups": len(objects),
                "total_entries": len(entries),
                "scopes": sorted(scopes),
                "config_types": sorted(config_types),
            },
            "entries": entries,
        }

    def format_transform_reference_response(self, data: Any) -> dict[str, Any]:
        objects = data.get("objects") if isinstance(data, dict) and isinstance(data.get("objects"), list) else []
        entries: list[dict[str, Any]] = []
        for item in objects:
            dynamic_key_names = item.get("dynamicKeyNames") if self.is_plain_object(item) and self.is_plain_object(item.get("dynamicKeyNames")) else {}
            for transform_name, transform_value in dynamic_key_names.items():
                entries.append({"transform_name": transform_name, "key_fields": self.extract_top_level_keys(transform_value), "example": transform_value})

        return {
            "traceid": data.get("traceid") if isinstance(data, dict) else None,
            "upstream_result": data.get("result") if isinstance(data, dict) else None,
            "summary": {
                "total_reference_groups": len(objects),
                "total_transforms": len(entries),
                "transform_names": sorted(entry["transform_name"] for entry in entries),
            },
            "entries": entries,
        }

    def count_nested_entries(self, value: dict[str, Any]) -> int:
        count = 0
        for item in value.values():
            if not self.is_plain_object(item):
                count += 1
            else:
                count += max(len(item.keys()), 1)
        return count

    def extract_sample_text(self, sample: Any) -> str | None:
        if isinstance(sample, str):
            return sample
        if not self.is_plain_object(sample):
            return None
        for key in VERIFY_SAMPLE_TEXT_KEYS:
            value = sample.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return None

    def extract_top_level_keys(self, value: Any) -> list[str]:
        return list(value.keys()) if self.is_plain_object(value) else []

    def api_response_to_error(self, response: Any) -> dict[str, Any]:
        return self.build_error(
            response.error_code or "UPSTREAM_REQUEST_FAILED",
            response.message or response.error or "上游请求失败。",
            response.suggestion or "请检查上游地址、认证信息和请求参数。",
            response.details,
        )


def create_fieldconfig_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    service = FieldConfigService()
    runtime = ServiceToolRuntime(
        route_name="fieldconfig",
        title="动态字段服务",
        default_error_code="FIELDCONFIG_EXECUTION_ERROR",
        default_error_suggestion="请检查动态字段参数结构后重试。",
    )
    return create_tool_server(
        route_name="fieldconfig",
        server_name="rizhiyi_dynamic_field",
        title="动态字段服务",
        description="动态字段服务完整能力。",
        instructions=SERVER_LEVEL_INSTRUCTIONS,
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=FIELD_CONFIG_TOOLS,
        tool_handlers={
            "list_fieldconfigs": lambda arguments: runtime.execute(tool_name="list_fieldconfigs", arguments=arguments, executor=service.list_fieldconfigs),
            "verify_fieldconfig": lambda arguments: runtime.execute(tool_name="verify_fieldconfig", arguments=arguments, executor=service.verify_fieldconfig),
            "get_fieldconfig_props_reference": lambda arguments: runtime.execute(tool_name="get_fieldconfig_props_reference", arguments=arguments, executor=service.get_fieldconfig_props_reference),
            "get_fieldconfig_transform_reference": lambda arguments: runtime.execute(tool_name="get_fieldconfig_transform_reference", arguments=arguments, executor=service.get_fieldconfig_transform_reference),
        },
    )
