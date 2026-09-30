from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from contextlib import AsyncExitStack, asynccontextmanager, suppress
from dataclasses import dataclass
import json
import logging
import time
from typing import Any

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import Message, Receive, Scope, Send

from .auth import build_auth_context_from_authorization
from .config import RuntimeConfig, create_server_context
from .rate_limiting import FixedWindowRateLimiter
from .server_registry import server_registry
from .usage_log import UsageLogConfig, UsageLogger
from .servers import (
    RizhiyiFastMCPServer,
    ServiceRuntimeState,
    pop_request_runtime_context,
    push_request_runtime_context,
)

_LOGGER = logging.getLogger(__name__)

# 后台 session GC 周期（秒）。
_SESSION_GC_INTERVAL_SECONDS = 60.0


@dataclass(slots=True)
class MountedServer:
    route_name: str
    server: RizhiyiFastMCPServer
    state: ServiceRuntimeState


class RequestBodyTooLarge(Exception):
    """请求体累计字节数超过配置上限时抛出，由网关转换为 413 响应。"""

    def __init__(self, max_bytes: int) -> None:
        super().__init__(f"request body exceeds {max_bytes} bytes")
        self.max_bytes = max_bytes


SessionCloser = Callable[[str], Awaitable[bool]]


async def collect_stale_sessions(
    scopes: Sequence[tuple[ServiceRuntimeState, SessionCloser]],
    *,
    idle_ttl_seconds: float,
    max_count: int,
    now: float | None = None,
) -> list[str]:
    """回收空闲或超量的 HTTP session，返回被回收的 session_id 列表。

    优先级：**先按空闲 TTL 清理，再按全局数量上限淘汰最旧的 session**。
    淘汰时必须调用 closer 真正关闭 transport，而不是只从记账结构里删引用。
    """
    current = time.monotonic() if now is None else now
    evicted: list[str] = []

    # 1) 空闲 TTL：last_seen 缺失或超过 TTL 未刷新的一律回收。
    for state, closer in scopes:
        for session_id in list(state.session_auth):
            last_seen = state.session_last_seen.get(session_id)
            if last_seen is not None and current - last_seen < idle_ttl_seconds:
                continue
            state.forget_session(session_id)
            await closer(session_id)
            evicted.append(session_id)

    # 2) 数量上限：跨全部 server 全局淘汰最旧的 session。
    tracked = [
        (state.session_last_seen.get(session_id, float("-inf")), state, closer, session_id)
        for state, closer in scopes
        for session_id in list(state.session_auth)
    ]
    overflow = len(tracked) - max_count
    if overflow > 0:
        tracked.sort(key=lambda item: item[0])
        for _, state, closer, session_id in tracked[:overflow]:
            state.forget_session(session_id)
            await closer(session_id)
            evicted.append(session_id)

    return evicted


async def _session_gc_loop(evict: Callable[[], Awaitable[None]]) -> None:
    """按固定周期执行 session 回收，直到任务被取消。"""
    while True:
        await asyncio.sleep(_SESSION_GC_INTERVAL_SECONDS)
        try:
            await evict()
        except Exception:  # pragma: no cover - GC 失败不应终止后台任务
            _LOGGER.exception("回收空闲 MCP session 失败")


class AuthenticatedMountedServerApp:
    def __init__(
        self,
        *,
        route_name: str,
        runtime_config: RuntimeConfig,
        server: RizhiyiFastMCPServer,
        service_state: ServiceRuntimeState,
        on_session_registered: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.route_name = route_name
        self.runtime_config = runtime_config
        self.server = server
        self.service_state = service_state
        self.on_session_registered = on_session_registered
        server.streamable_http_app()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return

        normalized_scope = scope
        if scope.get("path") == "":
            normalized_scope = dict(scope)
            normalized_scope["path"] = "/"
            normalized_scope["raw_path"] = b"/"

        method = normalized_scope["method"].upper()
        headers = Headers(scope=normalized_scope)
        session_id = headers.get("mcp-session-id")
        authorization = headers.get("authorization")
        raw_body = b""
        parsed_body: dict[str, Any] | None = None

        if method == "POST":
            try:
                raw_body = await _consume_request_body(
                    receive,
                    max_bytes=self.runtime_config.mcp_http_max_body_bytes,
                )
            except RequestBodyTooLarge as exc:
                await _http_error(
                    status.HTTP_413_CONTENT_TOO_LARGE,
                    "REQUEST_BODY_TOO_LARGE",
                    f"请求体超过上限 {exc.max_bytes} 字节。",
                )(scope, receive, send)
                return
            parsed_body = _maybe_parse_json(raw_body)
            accept_values = _parse_accept_header(headers.get("accept", ""))
            if not _accepts_streamable_post(accept_values):
                await _http_error(
                    status.HTTP_406_NOT_ACCEPTABLE,
                    "INVALID_ACCEPT",
                    "POST /mcp/{server} 需要 Accept 同时包含 application/json 和 text/event-stream。",
                )(scope, receive, send)
                return

            if not _is_application_json(headers.get("content-type")):
                await _http_error(
                    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    "UNSUPPORTED_CONTENT_TYPE",
                    "POST /mcp/{server} 仅支持 application/json。",
                )(scope, receive, send)
                return

            if parsed_body and parsed_body.get("method") == "initialize":
                parsed_body["params"] = _normalize_initialize_params(parsed_body.get("params"))
                raw_body = json.dumps(parsed_body, ensure_ascii=False).encode("utf-8")

            resource_error = _validate_resource_read_request(parsed_body)
            if resource_error is not None:
                await JSONResponse(status_code=status.HTTP_200_OK, content=resource_error)(scope, receive, send)
                return
            receive = _build_replay_receive(raw_body)

        if method in {"POST", "GET"}:
            if not authorization:
                await _http_error(
                    status.HTTP_401_UNAUTHORIZED,
                    "MISSING_AUTHORIZATION",
                    "缺少 Authorization 请求头。",
                )(scope, receive, send)
                return

            try:
                auth_context = build_auth_context_from_authorization(authorization)
            except ValueError as exc:
                await _http_error(
                    status.HTTP_400_BAD_REQUEST,
                    "INVALID_AUTHORIZATION",
                    str(exc),
                )(scope, receive, send)
                return

            if method == "GET" and not session_id:
                await _http_error(
                    status.HTTP_400_BAD_REQUEST,
                    "MISSING_SESSION",
                    "GET event stream 必须提供有效的 mcp-session-id。",
                )(scope, receive, send)
                return

            if method == "GET" and not _accepts_sse(_parse_accept_header(headers.get("accept", ""))):
                await _http_error(
                    status.HTTP_406_NOT_ACCEPTABLE,
                    "INVALID_ACCEPT",
                    "GET /mcp/{server} 需要 Accept: text/event-stream。",
                )(scope, receive, send)
                return

            if method == "POST" and not session_id and parsed_body and parsed_body.get("method") != "initialize":
                await _http_error(
                    status.HTTP_400_BAD_REQUEST,
                    "MISSING_SESSION",
                    "非 initialize 请求必须提供有效的 mcp-session-id。",
                )(scope, receive, send)
                return

            bound_authorization = self.service_state.session_auth.get(session_id or "")
            if bound_authorization and bound_authorization != authorization:
                await _http_error(
                    status.HTTP_400_BAD_REQUEST,
                    "SESSION_AUTH_MISMATCH",
                    "同一个 session 不允许切换 Authorization。",
                )(scope, receive, send)
                return
        else:
            auth_context = (
                build_auth_context_from_authorization(authorization)
                if authorization
                else build_auth_context_from_authorization(None)
            )

        if (
            method == "POST"
            and session_id
            and parsed_body
            and parsed_body.get("method") not in {"initialize", "notifications/initialized"}
            and session_id in self.service_state.session_auth
            and session_id not in self.service_state.initialized_sessions
        ):
            await self._ensure_session_initialized(normalized_scope, session_id)

        # 每次命中已有 session 都刷新活跃时间，供后台 GC 判断空闲 TTL。
        if session_id and session_id in self.service_state.session_auth:
            self.service_state.touch_session(session_id)

        client = scope.get("client")
        client_address = client[0] if isinstance(client, tuple) and client else None
        server_context = create_server_context(
            self.runtime_config,
            auth_context,
            source="http",
            path=normalized_scope.get("path"),
            client_address=client_address,
            route_name=self.route_name,
            server_name=self.route_name,
            session_id=session_id,
        )
        normalized_scope.setdefault("state", {})
        normalized_scope["state"]["rizhiyi_server_context"] = server_context

        tokens = push_request_runtime_context(server_context, self.service_state)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                mutable_headers = MutableHeaders(raw=message["headers"])
                response_session_id = mutable_headers.get("mcp-session-id")
                status_code = int(message["status"])

                if status_code < 400 and method == "DELETE":
                    message["status"] = status.HTTP_204_NO_CONTENT
                    mutable_headers["content-length"] = "0"
                    if "content-type" in mutable_headers:
                        del mutable_headers["content-type"]
                    status_code = status.HTTP_204_NO_CONTENT

                if status_code < 400 and response_session_id and method in {"POST", "GET"} and authorization:
                    is_new_session = response_session_id not in self.service_state.session_auth
                    server_context.request_meta.session_id = response_session_id
                    self.service_state.session_auth[response_session_id] = authorization
                    self.service_state.touch_session(response_session_id)
                    if parsed_body and parsed_body.get("method") == "initialize":
                        params = parsed_body.get("params")
                        self.service_state.initialize_params[response_session_id] = params if isinstance(params, dict) else {}
                    elif parsed_body and parsed_body.get("method") == "notifications/initialized":
                        self.service_state.initialized_sessions.add(response_session_id)
                    # 新 session 注册后立即按数量上限淘汰最旧的 session，避免两次 GC 之间无界增长。
                    if is_new_session and self.on_session_registered is not None:
                        await self.on_session_registered()

                if status_code < 400 and method == "DELETE" and session_id:
                    self.service_state.forget_session(session_id)

            await send(message)

        try:
            await self.server.session_manager.handle_request(normalized_scope, receive, send_wrapper)
        finally:
            pop_request_runtime_context(tokens)

    async def _ensure_session_initialized(self, scope: Scope, session_id: str) -> None:
        notification_body = json.dumps(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            ensure_ascii=False,
        ).encode("utf-8")
        synthetic_scope = dict(scope)
        synthetic_scope["headers"] = _replace_header(
            scope.get("headers", []),
            b"content-length",
            str(len(notification_body)).encode("ascii"),
        )

        async def discard_send(message: Message) -> None:
            if message["type"] != "http.response.start":
                return
            if int(message["status"]) < 400:
                self.service_state.initialized_sessions.add(session_id)

        await self.server.session_manager.handle_request(
            synthetic_scope,
            _build_replay_receive(notification_body),
            discard_send,
        )


class NormalizeMountedServerRootPathMiddleware:
    def __init__(self, app, *, base_path: str, mounted_servers: dict[str, MountedServer]) -> None:
        self.app = app
        self.base_path = base_path.rstrip("/")
        self.mounted_servers = mounted_servers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        normalized_path = _normalize_server_root_path(path, self.base_path, self.mounted_servers)
        if normalized_path != path:
            scope = dict(scope)
            scope["path"] = normalized_path
            scope["raw_path"] = normalized_path.encode("utf-8")

        await self.app(scope, receive, send)


def create_http_app(runtime_config: RuntimeConfig | None = None) -> FastAPI:
    settings = runtime_config or RuntimeConfig()
    mounted_servers: dict[str, MountedServer] = {}
    session_scopes: list[tuple[ServiceRuntimeState, SessionCloser]] = []
    rate_limiter = FixedWindowRateLimiter(
        global_limit=settings.mcp_rate_limit_global_per_minute,
        per_tool_limits=settings.mcp_rate_limit_per_tool,
    )
    usage_logger = UsageLogger(
        UsageLogConfig(
            directory=settings.rizhiyi_log_dir,
            name_prefix=settings.rizhiyi_log_name_prefix,
            rotate_bytes=settings.rizhiyi_log_rotate_bytes,
            rotate_interval=settings.rizhiyi_log_rotate_interval,
            keep_files=settings.rizhiyi_log_keep_files,
        )
    )

    async def evict_stale_sessions() -> None:
        await collect_stale_sessions(
            session_scopes,
            idle_ttl_seconds=settings.mcp_http_session_idle_ttl_seconds,
            max_count=settings.mcp_http_session_max_count,
        )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with AsyncExitStack() as stack:
            for item in mounted_servers.values():
                await stack.enter_async_context(item.server.session_manager.run())
            # 后台定时 GC；随 lifespan 结束被取消，不会阻止进程退出。
            gc_task = asyncio.create_task(_session_gc_loop(evict_stale_sessions))
            try:
                yield
            finally:
                gc_task.cancel()
                with suppress(asyncio.CancelledError):
                    await gc_task

    app = FastAPI(title="rizhiyi-mcp-python", version="0.4.0", lifespan=lifespan)
    app.router.redirect_slashes = False

    for route_name, factory in server_registry.items():
        service_state = ServiceRuntimeState(
            route_name=route_name,
            rate_limiter=rate_limiter,
            usage_logger=usage_logger,
        )
        server = factory(settings, service_state)
        mounted_servers[route_name] = MountedServer(route_name=route_name, server=server, state=service_state)
        session_scopes.append((service_state, server.close_session))
        app.mount(
            f"{settings.mcp_http_base_path}/{route_name}",
            AuthenticatedMountedServerApp(
                route_name=route_name,
                runtime_config=settings,
                server=server,
                service_state=service_state,
                on_session_registered=evict_stale_sessions,
            ),
        )

    app.add_middleware(
        NormalizeMountedServerRootPathMiddleware,
        base_path=settings.mcp_http_base_path,
        mounted_servers=mounted_servers,
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {
            "ok": True,
            "http_base_path": settings.mcp_http_base_path,
            "registered_servers": sorted(mounted_servers),
            "session_count": sum(len(item.state.session_auth) for item in mounted_servers.values()),
            "transport_mode": "official_python_mcp_sdk",
            "rate_limiting": {
                "enabled": rate_limiter.enabled,
                "global_per_minute": settings.mcp_rate_limit_global_per_minute,
                "per_tool_count": len(settings.mcp_rate_limit_per_tool),
            },
            "guardrails": {
                "enabled": settings.mcp_guardrails_enabled,
                "mode": settings.mcp_guardrail_enforce_mode,
                "alert_threshold": settings.mcp_guardrail_risk_alert_threshold,
                "reject_threshold": settings.mcp_guardrail_risk_reject_threshold,
                "max_events": settings.mcp_guardrail_max_events,
            },
        }

    @app.middleware("http")
    async def handle_not_found(request, call_next):
        response = await call_next(request)
        if response.status_code != status.HTTP_404_NOT_FOUND:
            return response
        if not request.url.path.startswith(settings.mcp_http_base_path):
            return response
        server_name = request.url.path.removeprefix(settings.mcp_http_base_path).strip("/").split("/")[0]
        if not server_name:
            return _http_error(status.HTTP_404_NOT_FOUND, "SERVER_NOT_FOUND", "缺少 MCP Server 路径。")
        if server_name not in mounted_servers:
            return _http_error(status.HTTP_404_NOT_FOUND, "SERVER_NOT_FOUND", f"未知 MCP Server 路径: {server_name}")
        return response

    return app


async def _consume_request_body(receive: Receive, *, max_bytes: int) -> bytes:
    """读取请求体；累计字节数超过 max_bytes 时立即中断，不再向 receive() 索取后续数据。

    超限时抛出 RequestBodyTooLarge，由调用方转换为 413 响应，
    避免把超大请求读完才判断（也避免连接被直接断开）。
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunk = message.get("body", b"")
        total += len(chunk)
        if total > max_bytes:
            raise RequestBodyTooLarge(max_bytes)
        chunks.append(chunk)
        if not message.get("more_body", False):
            break
    return b"".join(chunks)


def _build_replay_receive(raw_body: bytes) -> Receive:
    sent = False

    async def replay_receive() -> Message:
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": raw_body, "more_body": False}

    return replay_receive


def _maybe_parse_json(raw_body: bytes) -> dict[str, Any] | None:
    if not raw_body:
        return None
    try:
        loaded = json.loads(raw_body)
    except json.JSONDecodeError:
        return None
    return loaded if isinstance(loaded, dict) else None


def _http_error(status_code: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "error": error,
            "message": message,
        },
    )


def _parse_accept_header(accept_header: str) -> set[str]:
    return {part.strip().lower() for part in accept_header.split(",") if part.strip()}


def _accepts_streamable_post(accepted: set[str]) -> bool:
    has_json = any(item.startswith("application/json") for item in accepted)
    has_sse = any(item.startswith("text/event-stream") for item in accepted)
    return has_json and has_sse


def _accepts_sse(accepted: set[str]) -> bool:
    return any(item.startswith("text/event-stream") for item in accepted)


def _is_application_json(content_type: str | None) -> bool:
    normalized = (content_type or "").split(";")[0].strip().lower()
    return normalized == "application/json"


def _normalize_initialize_params(params: Any) -> dict[str, Any]:
    normalized = params if isinstance(params, dict) else {}
    normalized.setdefault("protocolVersion", "2025-03-26")
    normalized.setdefault("capabilities", {})
    normalized.setdefault("clientInfo", {"name": "rizhiyi-test-client", "version": "0.1.0"})
    return normalized


def _normalize_server_root_path(path: str, base_path: str, mounted_servers: dict[str, MountedServer]) -> str:
    if not path.startswith(f"{base_path}/"):
        return path

    remainder = path.removeprefix(f"{base_path}/")
    if not remainder or "/" in remainder:
        return path

    if remainder not in mounted_servers:
        return path

    return f"{path}/"


def _replace_header(raw_headers: list[tuple[bytes, bytes]], name: bytes, value: bytes) -> list[tuple[bytes, bytes]]:
    normalized_name = name.lower()
    filtered = [(header_name, header_value) for header_name, header_value in raw_headers if header_name.lower() != normalized_name]
    filtered.append((name, value))
    return filtered


def _validate_resource_read_request(parsed_body: dict[str, Any] | None) -> dict[str, Any] | None:
    if not parsed_body or parsed_body.get("method") != "resources/read":
        return None

    params = parsed_body.get("params")
    resource_uri = params.get("uri") if isinstance(params, dict) else None
    if isinstance(resource_uri, str) and _is_supported_resource_uri(resource_uri):
        return None

    return {
        "jsonrpc": parsed_body.get("jsonrpc", "2.0"),
        "id": parsed_body.get("id"),
        "error": {
            "code": -32004,
            "message": "请传入合法的 resource_uri，格式应为 `logease://shared-result/<handle>`。",
            "data": {
                "error_code": "INVALID_RESOURCE_URI",
                "uri": resource_uri,
            },
        },
    }


def _is_supported_resource_uri(resource_uri: str) -> bool:
    return resource_uri.startswith("logease://shared-result/") or resource_uri.startswith("rizhiyi://server/")
