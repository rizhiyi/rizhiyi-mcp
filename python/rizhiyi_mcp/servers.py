from __future__ import annotations

import asyncio
import base64
from collections.abc import Awaitable, Callable, Iterable
from contextvars import ContextVar, Token
import inspect
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from mcp import types as mcp_types
from mcp.server.fastmcp import FastMCP
from mcp.server.lowlevel.helper_types import ReadResourceContents
from mcp.server.transport_security import TransportSecuritySettings
from mcp.shared.exceptions import McpError
from mcp.types import Resource as MCPResource
from mcp.types import ResourceTemplate as MCPResourceTemplate
from mcp.types import TextContent, Tool as MCPTool

from .auth import describe_authorization
from .config import RuntimeConfig
from .rate_limiting import FixedWindowRateLimiter
from .shared_result_store import (
    SharedResultStoreError,
    list_shared_results,
    read_shared_result,
    save_shared_result,
)
from .spl_guardrails import (
    GuardrailAssessment,
    GuardrailConfig,
    apply_output_guardrails,
    assess_generated_spl,
    assess_tool_arguments,
    guardrail_config_from_runtime,
    merge_assessments,
)
from .types import ResourceDefinition, ServerContext, SharedResultSummary, ToolCallResult, ToolDefinition
from .usage_log import UsageLogger, UsageLogStatus, create_usage_log_entry

_CURRENT_SERVER_CONTEXT: ContextVar[ServerContext | None] = ContextVar("rizhiyi_mcp_server_context", default=None)
_CURRENT_SERVICE_STATE: ContextVar["ServiceRuntimeState | None"] = ContextVar("rizhiyi_mcp_service_state", default=None)
_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ServiceRuntimeState:
    route_name: str
    rate_limiter: FixedWindowRateLimiter | None = None
    usage_logger: UsageLogger | None = None
    session_auth: dict[str, str] = field(default_factory=dict)
    initialize_params: dict[str, dict[str, Any]] = field(default_factory=dict)
    initialized_sessions: set[str] = field(default_factory=set)
    # session_id -> 最近一次命中该 session 的单调时钟时间（秒），用于空闲 TTL 与数量淘汰。
    session_last_seen: dict[str, float] = field(default_factory=dict)

    def touch_session(self, session_id: str, *, now: float | None = None) -> None:
        """刷新 session 的最近活跃时间。"""
        self.session_last_seen[session_id] = time.monotonic() if now is None else now

    def forget_session(self, session_id: str) -> None:
        """从全部 session 记账结构中移除指定 session。"""
        self.session_auth.pop(session_id, None)
        self.initialize_params.pop(session_id, None)
        self.initialized_sessions.discard(session_id)
        self.session_last_seen.pop(session_id, None)


class McpServerError(Exception):
    def __init__(self, message: str, *, code: int = -32602, data: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data or {}


ToolHandler = Callable[[dict[str, Any]], Awaitable[ToolCallResult]]


def push_request_runtime_context(
    server_context: ServerContext,
    service_state: ServiceRuntimeState,
) -> tuple[Token[ServerContext | None], Token[ServiceRuntimeState | None]]:
    return (
        _CURRENT_SERVER_CONTEXT.set(server_context),
        _CURRENT_SERVICE_STATE.set(service_state),
    )


def pop_request_runtime_context(
    tokens: tuple[Token[ServerContext | None], Token[ServiceRuntimeState | None]],
) -> None:
    server_token, service_token = tokens
    _CURRENT_SERVER_CONTEXT.reset(server_token)
    _CURRENT_SERVICE_STATE.reset(service_token)


def get_current_server_context() -> ServerContext:
    context = _CURRENT_SERVER_CONTEXT.get()
    if context is None:
        raise RuntimeError("当前没有可用的 ServerContext。")
    return context


def get_current_service_state() -> ServiceRuntimeState:
    state = _CURRENT_SERVICE_STATE.get()
    if state is None:
        raise RuntimeError("当前没有可用的 ServiceRuntimeState。")
    return state


class RizhiyiFastMCPServer(FastMCP[None]):
    def __init__(
        self,
        *,
        route_name: str,
        server_name: str,
        title: str,
        description: str,
        runtime_config: RuntimeConfig,
        service_state: ServiceRuntimeState,
        version: str = "0.1.0",
        instructions: str | None = None,
        tool_definitions: list[ToolDefinition] | None = None,
        tool_handlers: dict[str, ToolHandler] | None = None,
    ) -> None:
        self.route_name = route_name
        self.server_name = server_name
        self.title = title
        self.description = description
        self.runtime_config = runtime_config
        self.version = version
        self.service_state = service_state
        self._tool_definitions = tool_definitions
        self._tool_handlers = tool_handlers or {}
        super().__init__(
            name=server_name,
            instructions=instructions or f"{title} Python MCP 服务已就绪。",
            streamable_http_path="/",
            json_response=True,
            host=runtime_config.mcp_http_host,
            transport_security=TransportSecuritySettings(
                enable_dns_rebinding_protection=runtime_config.mcp_enable_dns_rebinding_protection,
                allowed_hosts=runtime_config.mcp_allowed_hosts,
                allowed_origins=runtime_config.mcp_allowed_origins,
            ),
        )

    def _setup_handlers(self) -> None:
        async def handle_list_tools(_: mcp_types.ListToolsRequest) -> mcp_types.ServerResult:
            return mcp_types.ServerResult(mcp_types.ListToolsResult(tools=await self.list_tools()))

        async def handle_list_resources(_: mcp_types.ListResourcesRequest) -> mcp_types.ServerResult:
            return mcp_types.ServerResult(mcp_types.ListResourcesResult(resources=await self.list_resources()))

        async def handle_read_resource(req: mcp_types.ReadResourceRequest) -> mcp_types.ServerResult:
            try:
                contents = await self.read_resource(str(req.params.uri))
            except McpServerError as exc:
                raise self._to_protocol_error(exc) from exc
            return mcp_types.ServerResult(
                mcp_types.ReadResourceResult(
                    contents=[self._to_resource_content(str(req.params.uri), item) for item in contents]
                )
            )

        async def handle_list_resource_templates(_: mcp_types.ListResourceTemplatesRequest) -> mcp_types.ServerResult:
            templates = await self.list_resource_templates()
            return mcp_types.ServerResult(mcp_types.ListResourceTemplatesResult(resourceTemplates=templates))

        async def handle_list_prompts(_: mcp_types.ListPromptsRequest) -> mcp_types.ServerResult:
            return mcp_types.ServerResult(mcp_types.ListPromptsResult(prompts=await self.list_prompts()))

        async def handle_get_prompt(req: mcp_types.GetPromptRequest) -> mcp_types.ServerResult:
            prompt = await self.get_prompt(req.params.name, req.params.arguments)
            return mcp_types.ServerResult(prompt)

        async def handle_tool_call(req: mcp_types.CallToolRequest) -> mcp_types.ServerResult:
            started_at = time.perf_counter()
            usage_status: UsageLogStatus = "error"
            usage_error_code: str | None = None
            try:
                decision = (
                    self.service_state.rate_limiter.consume(
                        route_name=self.route_name,
                        tool_name=req.params.name,
                    )
                    if self.service_state.rate_limiter is not None
                    else None
                )
                if decision is not None and not decision.allowed:
                    usage_status = "ok-limited"
                    usage_error_code = "RATE_LIMIT_EXCEEDED"
                    payload = {
                        "error_code": "RATE_LIMIT_EXCEEDED",
                        "message": "工具调用频率已超过当前固定窗口上限。",
                        "suggestion": f"请在 {decision.retry_after_seconds} 秒后重试。",
                        "retryable": True,
                        "details": decision.to_details(),
                    }
                    result = ToolCallResult(
                        structured_content=payload,
                        content=[{"type": "text", "text": self._json_dump(payload)}],
                        is_error=True,
                    )
                else:
                    result = await self._execute_tool_with_guardrails(
                        req.params.name,
                        req.params.arguments or {},
                    )
                    usage_status = "error" if result.is_error else "ok"
                    usage_error_code = self._extract_result_error_code(result)
            except McpServerError as exc:
                usage_error_code = str(exc.data.get("error_code") or "TOOL_CALL_FAILED")
                payload = {
                    "error_code": usage_error_code,
                    "message": str(exc),
                    "details": exc.data or None,
                }
                result = ToolCallResult(
                    structured_content=payload,
                    content=[{"type": "text", "text": self._json_dump(payload)}],
                    is_error=True,
                )
            except Exception as exc:
                usage_error_code = "UNEXPECTED_TOOL_ERROR"
                payload = {
                    "error_code": usage_error_code,
                    "message": str(exc),
                }
                result = ToolCallResult(
                    structured_content=payload,
                    content=[{"type": "text", "text": self._json_dump(payload)}],
                    is_error=True,
                )

            await self._write_usage_log(
                tool_name=req.params.name,
                status=usage_status,
                duration_ms=round((time.perf_counter() - started_at) * 1000),
                error_code=usage_error_code,
                guardrail=(
                    result.structured_content.get("guardrail")
                    if isinstance(result.structured_content.get("guardrail"), dict)
                    else None
                ),
            )
            return mcp_types.ServerResult(
                mcp_types.CallToolResult(
                    content=[self._to_content_block(item) for item in result.content],
                    structuredContent=result.structured_content,
                    isError=result.is_error,
                )
            )

        self._mcp_server.request_handlers[mcp_types.ListToolsRequest] = handle_list_tools
        self._mcp_server.request_handlers[mcp_types.ListResourcesRequest] = handle_list_resources
        self._mcp_server.request_handlers[mcp_types.ReadResourceRequest] = handle_read_resource
        self._mcp_server.request_handlers[mcp_types.ListResourceTemplatesRequest] = handle_list_resource_templates
        self._mcp_server.request_handlers[mcp_types.ListPromptsRequest] = handle_list_prompts
        self._mcp_server.request_handlers[mcp_types.GetPromptRequest] = handle_get_prompt
        self._mcp_server.request_handlers[mcp_types.CallToolRequest] = handle_tool_call

    async def _write_usage_log(
        self,
        *,
        tool_name: str,
        status: UsageLogStatus,
        duration_ms: int,
        error_code: str | None,
        guardrail: dict[str, Any] | None,
    ) -> None:
        usage_logger = self.service_state.usage_logger
        if usage_logger is None:
            return
        try:
            context = get_current_server_context()
            request_meta = context.request_meta
            await usage_logger.write(
                create_usage_log_entry(
                    session_id=request_meta.session_id,
                    server_name=request_meta.server_name or self.route_name,
                    tool=tool_name,
                    route_name=request_meta.route_name or self.route_name,
                    status=status,
                    duration_ms=duration_ms,
                    # Basic 认证不注入 username 参数（见 auth.py），身份这里从凭据里取。
                    user=context.auth_context.username
                    or (context.auth_context.authorization.username if context.auth_context.authorization else None),
                    error_code=error_code,
                    guardrail=guardrail,
                )
            )
        except Exception:
            _LOGGER.exception("写入 MCP 使用日志失败")

    @staticmethod
    def _extract_result_error_code(result: ToolCallResult) -> str | None:
        value = result.structured_content.get("error_code")
        return value if isinstance(value, str) and value else None

    async def list_tools(self) -> list[MCPTool]:
        return [
            MCPTool(
                name=tool.name,
                description=tool.description,
                inputSchema=tool.input_schema,
            )
            for tool in self._custom_tool_definitions()
        ]

    async def list_resources(self) -> list[MCPResource]:
        resources = [self._build_manifest_definition()]
        resources.extend(
            self._build_shared_resource_definition(envelope)
            for envelope in list_shared_results(self.runtime_config, route_name=self.route_name)
        )
        return [
            MCPResource(
                uri=resource.uri,
                name=resource.name,
                description=resource.description,
                mimeType=resource.mime_type,
            )
            for resource in resources
        ]

    async def list_resource_templates(self) -> list[MCPResourceTemplate]:
        return []

    async def read_resource(self, uri: str) -> Iterable[ReadResourceContents]:
        if uri == self._manifest_uri:
            return [
                ReadResourceContents(
                    content=self._json_dump(self._build_manifest_payload()),
                    mime_type="application/json",
                )
            ]

        try:
            envelope = read_shared_result(self.runtime_config, uri)
        except SharedResultStoreError as exc:
            raise self._to_shared_result_error(exc, uri) from exc

        if envelope.route_name != self.route_name:
            raise McpServerError(
                "资源不存在。请确认 resource_uri 是否来自当前 server。",
                code=-32004,
                data={"uri": uri},
            )

        return [
            ReadResourceContents(
                content=self._json_dump(asdict(envelope)),
                mime_type=envelope.resource_mime_type,
            )
        ]

    async def _execute_tool_with_guardrails(
        self,
        name: str,
        arguments: dict | None,
    ) -> ToolCallResult:
        safe_arguments = arguments or {}
        guardrail_config = guardrail_config_from_runtime(self.runtime_config)
        assessment = assess_tool_arguments(
            guardrail_config,
            route_name=self.route_name,
            tool_name=name,
            arguments=safe_arguments,
        )
        if assessment.should_block:
            return self._build_guardrail_block_result(assessment)

        # 工具执行超时无条件生效：护栏 enforce 只决定阈值，不再决定“是否超时”。
        # 未命中护栏执行路径时回退到与护栏解耦的 upstream_timeout_seconds。
        if (
            guardrail_config.enabled
            and guardrail_config.mode == "enforce"
            and (assessment.queries or self.route_name == "log-tools")
        ):
            timeout_seconds = guardrail_config.exec_timeout_seconds
        else:
            timeout_seconds = self.runtime_config.upstream_timeout_seconds

        try:
            invocation = self.call_tool(name, safe_arguments)
            result = await asyncio.wait_for(invocation, timeout=timeout_seconds)
        except asyncio.TimeoutError:
            timeout_text = f"{timeout_seconds:g}"
            payload = {
                "error_code": "SPL_EXECUTION_TIMEOUT",
                "message": f"工具执行超过时长上限 {timeout_text} 秒。",
                "suggestion": "请缩小 time_range、收紧查询条件或拆分查询后重试。",
                "retryable": True,
                "details": {
                    "timeout_seconds": timeout_seconds,
                    "guardrail": assessment.to_details(),
                },
                "guardrail": assessment.to_details(),
            }
            return ToolCallResult(
                structured_content=payload,
                content=[{"type": "text", "text": self._json_dump(payload)}],
                is_error=True,
            )

        generated_assessment = assess_generated_spl(
            guardrail_config,
            route_name=self.route_name,
            tool_name=name,
            payload=result.structured_content,
        )
        assessment = merge_assessments(assessment, generated_assessment)
        if generated_assessment.should_block:
            return self._build_guardrail_block_result(assessment)
        return self._apply_guardrails_to_result(result, assessment, guardrail_config)

    async def call_tool(self, name: str, arguments: dict | None) -> ToolCallResult:
        safe_arguments = arguments or {}
        handler = self._tool_handlers.get(name)
        if handler is not None:
            return await self._invoke_tool_handler(handler, safe_arguments)

        raise McpServerError(f"未知工具: {name}", code=-32601, data={"name": name})

    async def close_session(self, session_id: str) -> bool:
        """关闭并移除指定 session 的 SDK transport（用于空闲回收 / 数量淘汰）。

        SDK 的 StreamableHTTPSessionManager 没有公开的按 session 关闭接口，
        这里从其内部登记表取出 transport 并 terminate()，确保不是只删引用。
        """
        manager = self.session_manager
        instances = getattr(manager, "_server_instances", None)
        if not isinstance(instances, dict):
            return False
        transport = instances.pop(session_id, None)
        owners = getattr(manager, "_session_owners", None)
        if isinstance(owners, dict):
            owners.pop(session_id, None)
        if transport is None:
            return False
        try:
            await transport.terminate()
        except Exception:
            _LOGGER.exception("关闭 MCP session transport 失败: %s", session_id)
            return False
        return True

    def _build_guardrail_block_result(
        self,
        assessment: GuardrailAssessment,
    ) -> ToolCallResult:
        payload = {
            "error_code": "SPL_GUARDRAIL_BLOCKED",
            "message": assessment.message,
            "suggestion": (
                "请移除写入、删除、导出或外部访问命令，缩小时间范围，"
                "并为子搜索增加显式限额后重试。"
            ),
            "retryable": False,
            "details": assessment.to_details(),
            "guardrail": assessment.to_details(),
        }
        return ToolCallResult(
            structured_content=payload,
            content=[{"type": "text", "text": self._json_dump(payload)}],
            is_error=True,
        )

    def _apply_guardrails_to_result(
        self,
        result: ToolCallResult,
        assessment: GuardrailAssessment,
        guardrail_config: GuardrailConfig,
    ) -> ToolCallResult:
        if not guardrail_config.enabled:
            return result

        guarded_structured, sanitized_values, truncated_events, truncated_paths = (
            apply_output_guardrails(result.structured_content, guardrail_config)
        )
        assessment.sanitized_values += sanitized_values
        assessment.truncated_events += truncated_events
        assessment.truncated_paths.extend(truncated_paths)

        if not isinstance(guarded_structured, dict):
            guarded_structured = {"value": guarded_structured}
        if assessment.queries or assessment.sanitized_values or assessment.truncated_events:
            guarded_structured["guardrail"] = assessment.to_details()

        if truncated_events:
            guarded_content = [{"type": "text", "text": self._json_dump(guarded_structured)}]
        else:
            guarded_content, _, _, _ = apply_output_guardrails(
                result.content,
                guardrail_config,
            )
            if assessment.queries or assessment.sanitized_values:
                warning = self._json_dump({"guardrail": assessment.to_details()})
                if isinstance(guarded_content, list):
                    guarded_content = list(guarded_content)
                    guarded_content.append({"type": "text", "text": warning})
            if not isinstance(guarded_content, list):
                guarded_content = [{"type": "text", "text": self._json_dump(guarded_content)}]

        if assessment.queries or assessment.sanitized_values or assessment.truncated_events:
            guarded_structured["guardrail"] = assessment.to_details()
        return ToolCallResult(
            structured_content=guarded_structured,
            content=guarded_content,
            is_error=result.is_error,
        )

    async def _invoke_tool_handler(self, handler: Any, arguments: dict[str, Any]) -> ToolCallResult:
        """调用工具 handler；若 handler 声明了第二参数，则注入 FastMCP Context 以支持进度通知。"""
        try:
            signature = inspect.signature(handler)
            wants_context = len(signature.parameters) >= 2
        except (TypeError, ValueError):
            wants_context = False

        if not wants_context:
            return await handler(arguments)

        try:
            context = self.get_context()
        except Exception:
            context = None
        return await handler(arguments, context)

    def _custom_tool_definitions(self) -> list[ToolDefinition]:
        if self._tool_definitions is not None:
            return self._tool_definitions
        return []

    @property
    def _manifest_uri(self) -> str:
        return f"rizhiyi://server/{self.route_name}/manifest"

    def _build_manifest_definition(self) -> ResourceDefinition:
        return ResourceDefinition(
            uri=self._manifest_uri,
            name=f"{self.route_name}-manifest",
            description=f"{self.title} 的轻量说明资源。",
        )

    def _build_manifest_payload(self) -> dict[str, Any]:
        server_context = get_current_server_context()
        auth = server_context.auth_context.authorization
        auth_identity = describe_authorization(auth) if auth else "anonymous"
        shared_results = list_shared_results(self.runtime_config, route_name=self.route_name)
        return {
            "route_name": self.route_name,
            "server_name": self.server_name,
            "title": self.title,
            "description": self.description,
            "client_initialized": self._current_session_initialized(),
            "auth_identity": auth_identity,
            "request_meta": asdict(server_context.request_meta),
            "tool_count": len(self._custom_tool_definitions()),
            "resource_count": 1 + len(shared_results),
            "dynamic_resource_count": len(shared_results),
            "initialize_params": self._current_initialize_params(),
        }

    def _deliver_payload(self, tool_name: str, payload: dict[str, Any], arguments: dict[str, Any]) -> ToolCallResult:
        delivery = str(arguments.get("result_delivery", "auto")).strip().lower() or "auto"
        encoded = self._json_dump(payload)
        force_resource = delivery == "resource"
        auto_to_resource = delivery == "auto" and len(encoded.encode("utf-8")) > self.runtime_config.log_tools_result_inline_max_bytes

        if force_resource or auto_to_resource:
            try:
                envelope = save_shared_result(
                    self.runtime_config,
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
                raise self._to_shared_result_error(exc) from exc

            return self._build_tool_result(
                {
                    "delivery": "resource",
                    "resource_uri": envelope.resource_uri,
                    "resource_title": envelope.resource_title,
                    "resource_mime_type": envelope.resource_mime_type,
                    "expires_at": envelope.expires_at,
                    "payload_bytes": envelope.payload_bytes,
                }
            )

        return self._build_tool_result(
            {
                "delivery": "inline",
                "data": payload,
            }
        )

    def _build_tool_result(self, payload: dict[str, Any], *, is_error: bool = False) -> ToolCallResult:
        return ToolCallResult(
            structured_content=payload,
            content=[{"type": "text", "text": self._json_dump(payload)}],
            is_error=is_error,
        )

    def _build_shared_resource_definition(self, envelope: Any) -> ResourceDefinition:
        return ResourceDefinition(
            uri=envelope.resource_uri,
            name=envelope.resource_title,
            description=f"{self.title} 工具结果资源，过期时间 {envelope.expires_at}。",
            mime_type=envelope.resource_mime_type,
        )

    def _parse_ttl_seconds(self, arguments: dict[str, Any]) -> int | None:
        raw_value = arguments.get("result_ttl_seconds")
        if raw_value is None:
            return None
        if isinstance(raw_value, bool) or not isinstance(raw_value, int) or raw_value <= 0:
            raise ValueError("result_ttl_seconds 必须是大于 0 的整数。")
        return raw_value

    def _to_shared_result_error(self, error: SharedResultStoreError, uri: str | None = None) -> McpServerError:
        message = str(error)
        if error.code == "INVALID_RESOURCE_URI":
            message = "请传入合法的 resource_uri，格式应为 `logease://shared-result/<handle>`。"
        elif error.code == "HANDLE_NOT_FOUND":
            message = "资源不存在。请确认它没有被删除，并且该 resource_uri 来自当前环境。"
        elif error.code == "HANDLE_EXPIRED":
            message = "资源已过期。请重新执行源工具，使用新生成的 resource_uri。"

        data = {"error_code": error.code}
        if uri is not None:
            data["uri"] = uri
        return McpServerError(message, code=-32004, data=data)

    @staticmethod
    def _to_protocol_error(error: McpServerError) -> McpError:
        return McpError(
            mcp_types.ErrorData(
                code=error.code,
                message=str(error),
                data=error.data or None,
            )
        )

    def _current_request(self) -> Any | None:
        try:
            return self.get_context().request_context.request
        except Exception:
            return None

    def _current_session_id(self) -> str | None:
        request = self._current_request()
        if request is None:
            return None
        return request.headers.get("mcp-session-id")

    def _current_session_initialized(self) -> bool:
        session_id = self._current_session_id()
        return bool(session_id and session_id in self.service_state.initialized_sessions)

    def _current_initialize_params(self) -> dict[str, Any]:
        session_id = self._current_session_id()
        if not session_id:
            return {}
        return self.service_state.initialize_params.get(session_id, {})

    @staticmethod
    def _to_content_block(item: dict[str, Any]) -> mcp_types.ContentBlock:
        if item.get("type") == "text":
            return TextContent(type="text", text=str(item.get("text", "")))
        return TextContent(type="text", text=json.dumps(item, ensure_ascii=False, indent=2, sort_keys=True))

    @staticmethod
    def _to_resource_content(uri: str, item: ReadResourceContents) -> mcp_types.TextResourceContents | mcp_types.BlobResourceContents:
        if isinstance(item.content, bytes):
            return mcp_types.BlobResourceContents(
                uri=uri,
                mimeType=item.mime_type,
                blob=base64.b64encode(item.content).decode("ascii"),
            )
        return mcp_types.TextResourceContents(
            uri=uri,
            mimeType=item.mime_type,
            text=item.content,
        )

    @staticmethod
    def _json_dump(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)


def create_builtin_server(
    *,
    route_name: str,
    server_name: str,
    title: str,
    description: str,
    runtime_config: RuntimeConfig,
    service_state: ServiceRuntimeState,
) -> RizhiyiFastMCPServer:
    return RizhiyiFastMCPServer(
        route_name=route_name,
        server_name=server_name,
        title=title,
        description=description,
        runtime_config=runtime_config,
        service_state=service_state,
    )


def create_tool_server(
    *,
    route_name: str,
    server_name: str,
    title: str,
    description: str,
    instructions: str | None = None,
    runtime_config: RuntimeConfig,
    service_state: ServiceRuntimeState,
    tool_definitions: list[ToolDefinition],
    tool_handlers: dict[str, ToolHandler],
) -> RizhiyiFastMCPServer:
    return RizhiyiFastMCPServer(
        route_name=route_name,
        server_name=server_name,
        title=title,
        description=description,
        runtime_config=runtime_config,
        service_state=service_state,
        instructions=instructions,
        tool_definitions=tool_definitions,
        tool_handlers=tool_handlers,
    )
