from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from .config import RuntimeConfig
from .servers import ServiceRuntimeState, create_tool_server, get_current_server_context
from .service_tooling import BaseServiceModule, ServiceToolRuntime
from .sse_client import SseEvent, request_sse
from .types import ToolDefinition

ProgressCallback = Callable[[int, int, str | None], Awaitable[None]]

_TOTAL_STEPS = 7
_STEP_NAMES = [
    "重写问题",
    "问题分类",
    "关键信息提取",
    "选择数据源",
    "收集相关数据",
    "生成SPL",
    "发送SPL",
]

SERVER_LEVEL_INSTRUCTIONS = """使用说明:
1. 这是 ChatSPL 专用入口，处理自然语言生成 SPL 和知识库规则管理。
2. chat_spl 工具将自然语言转换为 SPL 查询语句，支持深度思考模式。
3. 知识库规则管理：list/create/update/delete chatspl rules。
4. 规则格式: {"input":"自然语言描述","output":"SPL语句"}。
5. 遇到错误时，优先根据 suggestion 字段修正参数后重试一次。"""


def _chat_spl_tools() -> list[ToolDefinition]:
    return [
        ToolDefinition(
            name="chat_spl",
            description="自然语言生成 SPL：将自然语言描述转换为 SPL 查询语句。通过 ChatSPL 智能分析，自动理解查询意图并生成对应的 SPL。支持深度思考模式，可处理复杂查询场景。",
            input_schema={
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "自然语言描述，例如：\"检索今天的错误日志\"、\"统计最近1小时各appname的日志量\"",
                    },
                    "deep_think": {
                        "type": "boolean",
                        "description": "是否启用深度思考模式，适用于复杂查询场景，默认 false",
                        "default": False,
                    },
                    "lang": {
                        "type": "string",
                        "description": "语言偏好，zh_CN=中文，en_US=英文，默认 zh_CN",
                        "default": "zh_CN",
                        "enum": ["zh_CN", "en_US"],
                    },
                },
                "required": ["content"],
            },
        ),
        ToolDefinition(
            name="list_chatspl_rules",
            description="列出所有 ChatSPL 知识库规则，展示自然语言与 SPL 的映射关系。",
            input_schema={
                "type": "object",
                "properties": {
                    "page": {"type": "integer", "description": "页码，从 1 开始，默认 1", "default": 1},
                    "size": {"type": "integer", "description": "每页条数，默认 100", "default": 100},
                },
            },
        ),
        ToolDefinition(
            name="create_chatspl_rule",
            description="创建 ChatSPL 知识库规则，添加自然语言到 SPL 的映射。规则会被 ChatSPL 引擎用于生成更准确的 SPL。",
            input_schema={
                "type": "object",
                "properties": {
                    "knowledge_text": {
                        "type": "string",
                        "description": "规则内容，JSON 字符串格式: {\"input\":\"自然语言描述\",\"output\":\"SPL语句\"}。例如: {\"input\":\"华为交换机\",\"output\":\"appname:huawei_switch\"}",
                    }
                },
                "required": ["knowledge_text"],
            },
        ),
        ToolDefinition(
            name="update_chatspl_rule",
            description="更新指定的 ChatSPL 知识库规则。",
            input_schema={
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "规则 ID"},
                    "knowledge_text": {
                        "type": "string",
                        "description": "规则内容，JSON 字符串格式: {\"input\":\"自然语言描述\",\"output\":\"SPL语句\"}",
                    },
                },
                "required": ["id", "knowledge_text"],
            },
        ),
        ToolDefinition(
            name="delete_chatspl_rule",
            description="删除单条 ChatSPL 知识库规则。",
            input_schema={
                "type": "object",
                "properties": {"id": {"type": "integer", "description": "规则 ID"}},
                "required": ["id"],
            },
        ),
        ToolDefinition(
            name="delete_chatspl_rules_batch",
            description="批量删除 ChatSPL 知识库规则。",
            input_schema={
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "规则 ID 列表，例如 [1, 2, 3]",
                    }
                },
                "required": ["ids"],
            },
        ),
    ]


class ChatSplService(BaseServiceModule):
    async def list_rules(self, params: dict[str, Any]) -> Any:
        page = int(params.get("page") or 1)
        size = int(params.get("size") or 100)
        response = await self.request_json("get", "/api/v3/chatsplrules/", params={"page": page, "size": size})
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                "list_chatspl_rules 上游接口返回失败。",
                "请稍后重试。",
                response.data,
            )
        data = response.data if isinstance(response.data, dict) else {}
        objects = self.ensure_array(data.get("objects"))
        items = [
            {
                "id": item.get("id"),
                "input": self._try_parse_knowledge_input(item.get("knowledge_text")),
                "output": self._try_parse_knowledge_output(item.get("knowledge_text")),
                "knowledge_text": item.get("knowledge_text"),
                "creator_id": item.get("creator_id"),
                "domain_id": item.get("domain_id"),
                "create_time": item.get("create_time"),
                "update_time": item.get("update_time"),
            }
            for item in objects
            if self.is_plain_object(item)
        ]
        meta = self._extract_meta(data)
        return {"data": {"total": meta.get("total", len(items)), "items": items}}

    async def create_rule(self, params: dict[str, Any]) -> Any:
        knowledge_text = params.get("knowledge_text")
        if not isinstance(knowledge_text, str) or not knowledge_text.strip():
            return self.build_error(
                "MISSING_REQUIRED_PARAM",
                "create_chatspl_rule 需要 knowledge_text。",
                "请提供 knowledge_text，格式为 JSON 字符串: {\"input\":\"自然语言描述\",\"output\":\"SPL语句\"}",
            )
        validation = self._validate_knowledge_text(knowledge_text)
        if validation.get("error"):
            return validation["error"]
        response = await self.request_json("post", "/api/v3/chatsplrules/", data={"knowledge_text": knowledge_text})
        return self._format_mutation_response(response, "create_chatspl_rule")

    async def update_rule(self, params: dict[str, Any]) -> Any:
        rule_id = self._require_rule_id(params.get("id"))
        if rule_id.get("error"):
            return rule_id["error"]
        knowledge_text = params.get("knowledge_text")
        if not isinstance(knowledge_text, str) or not knowledge_text.strip():
            return self.build_error(
                "MISSING_REQUIRED_PARAM",
                "update_chatspl_rule 需要 knowledge_text。",
                "请提供 knowledge_text，格式为 JSON 字符串: {\"input\":\"自然语言描述\",\"output\":\"SPL语句\"}",
            )
        validation = self._validate_knowledge_text(knowledge_text)
        if validation.get("error"):
            return validation["error"]
        response = await self.request_json(
            "put",
            f"/api/v3/chatsplrules/{rule_id['value']}/",
            data={"knowledge_text": knowledge_text},
        )
        return self._format_mutation_response(response, "update_chatspl_rule")

    async def delete_rule(self, params: dict[str, Any]) -> Any:
        rule_id = self._require_rule_id(params.get("id"))
        if rule_id.get("error"):
            return rule_id["error"]
        response = await self.request_json("delete", f"/api/v3/chatsplrules/{rule_id['value']}/")
        return self._format_mutation_response(response, "delete_chatspl_rule")

    async def delete_rules_batch(self, params: dict[str, Any]) -> Any:
        raw_ids = params.get("ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            return self.build_error(
                "MISSING_REQUIRED_PARAM",
                "delete_chatspl_rules_batch 需要 id_list。",
                "请提供要删除的规则 ID 列表。",
            )
        id_list = ",".join(str(item) for item in raw_ids)
        response = await self.request_json("delete", "/api/v3/chatsplrules/set/", params={"id_list": id_list})
        return self._format_mutation_response(response, "delete_chatspl_rules_batch")

    async def chat_spl(self, params: dict[str, Any], on_progress: ProgressCallback | None = None) -> Any:
        content = params.get("content")
        if not isinstance(content, str) or not content.strip():
            return self.build_error(
                "MISSING_REQUIRED_PARAM",
                "chat_spl 需要 content。",
                "请提供自然语言描述，例如：\"检索今天的错误日志\"。",
            )
        deep_think = bool(params.get("deep_think"))
        lang = str(params.get("lang") or "zh_CN")

        context = get_current_server_context()
        config = context.runtime_config.create_http_client_config(context.auth_context)
        base_url = config.base_url.rstrip("/")
        username = config.username

        url = f"{base_url}/api/v3/copilot/chat/?lang={_urlencode(lang)}&agent=chatspl"
        if username:
            url += f"&username={_urlencode(username)}"

        headers = {"Content-Type": "application/json"}
        auth_header = config.headers.get("Authorization")
        if auth_header:
            headers["Authorization"] = auth_header

        body = json.dumps({"content": content, "deep_think": deep_think}, ensure_ascii=False)

        step_index = 0

        async def on_event(event: SseEvent) -> None:
            nonlocal step_index
            if event.event != "CREATE_STEP":
                return
            step_name = _STEP_NAMES[step_index] if step_index < len(_STEP_NAMES) else "执行步骤"
            if on_progress is not None:
                try:
                    await on_progress(step_index + 1, _TOTAL_STEPS, step_name)
                except Exception:
                    pass
            step_index += 1

        try:
            result = await request_sse(
                url=url,
                headers=headers,
                body=body,
                config=config,
                timeout_ms=120000,
                on_event=on_event,
            )
        except Exception as exc:
            return self.build_error(
                "SSE_REQUEST_FAILED",
                f"chat_spl SSE 请求失败: {exc}",
                "请检查网络连接和日志易服务状态。",
            )

        if not result.spl:
            return self.build_error(
                "NO_SPL_GENERATED",
                "chat_spl 未能生成 SPL。",
                "请尝试更具体的描述，或检查 ChatSPL 服务是否正常。",
            )

        completed_steps = [step for step in result.steps if step.status == "DONE"]
        return {
            "data": {
                "spl": result.spl,
                "conversation_id": result.conversation_id,
                "conversation_summary": (
                    result.conversation.get("summary") if isinstance(result.conversation, dict) else None
                ),
                "steps": [{"title": step.title, "tool_name": step.tool_name} for step in completed_steps],
            }
        }

    def api_response_to_error(self, response: Any) -> dict[str, Any]:
        return self.build_error(
            response.error_code or "UPSTREAM_REQUEST_FAILED",
            response.message or response.error or "上游请求失败。",
            response.suggestion or "请检查上游地址、认证信息和请求参数。",
            response.details,
        )

    def _format_mutation_response(self, response: Any, tool_name: str) -> dict[str, Any]:
        if response.error:
            return self.api_response_to_error(response)
        if self.is_upstream_business_error(response.data):
            return self.build_error(
                "UPSTREAM_BUSINESS_ERROR",
                f"{tool_name} 上游接口返回失败。",
                "请检查参数格式是否正确。",
                response.data,
            )
        return {"data": {"success": True}}

    def _require_rule_id(self, raw_id: Any) -> dict[str, Any]:
        try:
            value = int(raw_id)
        except (TypeError, ValueError):
            value = 0
        if value <= 0:
            return {
                "error": self.build_error(
                    "MISSING_REQUIRED_PARAM",
                    "需要有效的规则 id。",
                    "请提供要操作的规则 ID。",
                )
            }
        return {"value": value}

    def _validate_knowledge_text(self, text: str) -> dict[str, Any]:
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            return {
                "error": self.build_error(
                    "INVALID_JSON",
                    "knowledge_text 不是合法 JSON。",
                    "格式: {\"input\":\"自然语言描述\",\"output\":\"SPL语句\"}，注意外层是 JSON 字符串。",
                    {"parse_error": str(exc)},
                )
            }
        if not isinstance(parsed, dict) or not parsed.get("input") or not parsed.get("output"):
            return {
                "error": self.build_error(
                    "INVALID_KNOWLEDGE_TEXT",
                    "knowledge_text 必须包含 input 和 output 字段。",
                    "格式: {\"input\":\"自然语言描述\",\"output\":\"SPL语句\"}，例如: {\"input\":\"华为交换机\",\"output\":\"appname:huawei_switch\"}",
                )
            }
        return {"valid": True}

    def _try_parse_knowledge_input(self, text: Any) -> str | None:
        try:
            parsed = json.loads(text) if isinstance(text, str) else None
            return parsed.get("input") if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None

    def _try_parse_knowledge_output(self, text: Any) -> str | None:
        try:
            parsed = json.loads(text) if isinstance(text, str) else None
            return parsed.get("output") if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None

    def _extract_meta(self, data: dict[str, Any]) -> dict[str, Any]:
        meta = data.get("meta")
        return meta if isinstance(meta, dict) else {}


def _urlencode(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def create_chatspl_server(runtime_config: RuntimeConfig, service_state: ServiceRuntimeState):
    service = ChatSplService()
    runtime = ServiceToolRuntime(
        route_name="chatspl",
        title="ChatSPL 服务",
        default_error_code="UPSTREAM_ERROR",
        default_error_suggestion="请检查参数后重试。",
    )

    async def chat_spl_handler(arguments: dict[str, Any], context=None) -> Any:
        on_progress = None
        if context is not None:
            async def on_progress(progress: int, total: int, message: str | None) -> None:
                try:
                    await context.report_progress(progress, total, message)
                except Exception:
                    pass

        return await runtime.execute(
            tool_name="chat_spl",
            arguments=arguments,
            executor=lambda arguments: service.chat_spl(arguments, on_progress=on_progress),
        )

    return create_tool_server(
        route_name="chatspl",
        server_name="rizhiyi_chatspl_server",
        title="ChatSPL 服务",
        description="ChatSPL 知识库管理和 Copilot/Chat 生成工具。",
        instructions=SERVER_LEVEL_INSTRUCTIONS,
        runtime_config=runtime_config,
        service_state=service_state,
        tool_definitions=_chat_spl_tools(),
        tool_handlers={
            "chat_spl": chat_spl_handler,
            "list_chatspl_rules": lambda arguments: runtime.execute(tool_name="list_chatspl_rules", arguments=arguments, executor=service.list_rules),
            "create_chatspl_rule": lambda arguments: runtime.execute(tool_name="create_chatspl_rule", arguments=arguments, executor=service.create_rule),
            "update_chatspl_rule": lambda arguments: runtime.execute(tool_name="update_chatspl_rule", arguments=arguments, executor=service.update_rule),
            "delete_chatspl_rule": lambda arguments: runtime.execute(tool_name="delete_chatspl_rule", arguments=arguments, executor=service.delete_rule),
            "delete_chatspl_rules_batch": lambda arguments: runtime.execute(tool_name="delete_chatspl_rules_batch", arguments=arguments, executor=service.delete_rules_batch),
        },
    )
