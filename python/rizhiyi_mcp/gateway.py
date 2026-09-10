"""Streamable HTTP 网关（AuthenticatedMountedServerApp）：

- 挂接每个 route_name 的 FastMCP 服务实例（log-tools / manage / ...）；
- 强制 Authorization header（apikey / Basic / Bearer），
  其中 Bearer 会触发 OAuth 全链路：introspect → token exchange → 日志易 login → 回填 JWT headers；
- Session 粒度通过 mcp-session-id header 绑定，用可变 AuthContext 缓存 + 原地修改，
  解决 MCP SDK StreamableHTTP restore initialize contextvars 快照导致的新 ctx 被覆盖问题。

单向依赖：
- types（ParsedAuthorization / BearerAuthorization / AuthContext）
- auth（parse_authorization_header / build_auth_context_from_authorization / describe_authorization）
- oauth_client（OAuthClient / OAuthClientError）
- jwt_session（LogEaseJWTSession）
- servers（ServiceRuntimeState / push_request_runtime_context / get_current_server_context）
- config（RuntimeConfig / create_http_client_config / create_server_context）
- 以及 httpx / fastapi / starlette（SDK + HTTP 基础设施）。
"""
from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
import json
from typing import Any

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import Message, Receive, Scope, Send

from .auth import build_auth_context_from_authorization
from .config import RuntimeConfig, create_server_context
from .jwt_session import LogEaseJWTSession, LogEaseLoginError
from .oauth_client import OAuthClient, OAuthClientError
from .server_registry import server_registry
from .servers import (
    RizhiyiFastMCPServer,
    ServiceRuntimeState,
    pop_request_runtime_context,
    push_request_runtime_context,
)
from .types import BearerAuthorization


@dataclass(slots=True)
class MountedServer:
    route_name: str
    server: RizhiyiFastMCPServer
    state: ServiceRuntimeState


class AuthenticatedMountedServerApp:
    def __init__(
        self,
        *,
        route_name: str,
        runtime_config: RuntimeConfig,
        server: RizhiyiFastMCPServer,
        service_state: ServiceRuntimeState,
    ) -> None:
        self.route_name = route_name
        self.runtime_config = runtime_config
        self.server = server
        self.service_state = service_state
        server.streamable_http_app()
        # 共享 OAuth 客户端实例（仅当启用且配置可构造时）
        self._oauth_client: OAuthClient | None = None
        if runtime_config.oauth_enable:
            try:
                self._oauth_client = OAuthClient(runtime_config)
            except OAuthClientError:
                # 配置不完整也不影响进程启动；真正请求 Bearer 时再抛错
                self._oauth_client = None

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
            raw_body = await _consume_request_body(receive)
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

            # ---- session 级 auth_context 可变缓存注入（修复 ContextVar restore 覆盖） ----
            # MCP SDK StreamableHTTP 在 session 内部会 restore initialize 时刻的 contextvars 快照，
            # 导致后续请求通过 ContextVar.set 注入的新 ServerContext 被旧快照覆盖。
            # 解决：同 session 共享同一个 AuthContext 对象，后续请求就地修改其 headers/username，
            # 旧快照指向的是同一个可变对象，所以 tool 侧能看到最新值。
            if session_id:
                cached_auth = self.service_state.session_auth_contexts.get(session_id)
                if cached_auth is not None:
                    auth_context = cached_auth
            # --------------------------------------------------------------------------

            # Bearer 分支：检查 OAuth 开关、获取/创建 JWT session、回填日志易 JWT 到 headers
            parsed_auth = auth_context.authorization
            oauth_error: OAuthClientError | LogEaseLoginError | None = None
            if isinstance(parsed_auth, BearerAuthorization):
                if not self.runtime_config.oauth_enable:
                    await _http_error(
                        status.HTTP_400_BAD_REQUEST,
                        "INVALID_AUTHORIZATION",
                        "当前实例未启用 OAuth（OAUTH_ENABLE=false）；请改用 apikey 或 Basic。",
                    )(scope, receive, send)
                    return
                if self._oauth_client is None:
                    await _http_error(
                        status.HTTP_500_INTERNAL_SERVER_ERROR,
                        "OAUTH_CONFIG_ERROR",
                        "OAuth 已启用但配置无效（缺少 issuer 或 introspect/token 端点），请检查 OAUTH_ISSUER 等配置。",
                    )(scope, receive, send)
                    return
                scheme, _, token = parsed_auth.raw_authorization.partition(" ")
                raw_bearer = token.strip()
                if session_id:
                    jwt_session = self.service_state.session_jwt_sessions.get(session_id)
                    if jwt_session is None:
                        jwt_session = LogEaseJWTSession(
                            raw_bearer_token=raw_bearer,
                            runtime_config=self.runtime_config,
                            oauth_client=self._oauth_client,
                        )
                        self.service_state.session_jwt_sessions[session_id] = jwt_session
                    try:
                        logease_headers = await jwt_session.get_logease_auth_headers()
                    except OAuthClientError as exc:
                        oauth_error = exc
                    except LogEaseLoginError as exc:
                        oauth_error = exc
                    else:
                        # 就地修改 auth_context，而不是 dataclass_replace 创建新对象
                        new_username = auth_context.username or jwt_session.username
                        auth_context.headers.clear()
                        auth_context.headers.update(logease_headers)
                        auth_context.username = new_username
                # else: 没有 session_id（通常是 initialize 请求），保持 headers 空，后续请求再处理

            if oauth_error is not None:
                http_status, suggestion = _map_oauth_error(oauth_error)
                error_details = _safe_error_details(getattr(oauth_error, "details", None))
                await _http_error(
                    http_status,
                    oauth_error.code,
                    str(oauth_error),
                    suggestion=suggestion,
                    details=error_details,
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
            # 同 session 级可变缓存（修复 ContextVar restore）
            if session_id:
                cached_auth = self.service_state.session_auth_contexts.get(session_id)
                if cached_auth is not None:
                    auth_context = cached_auth

        if (
            method == "POST"
            and session_id
            and parsed_body
            and parsed_body.get("method") not in {"initialize", "notifications/initialized"}
            and session_id in self.service_state.session_auth
            and session_id not in self.service_state.initialized_sessions
        ):
            await self._ensure_session_initialized(normalized_scope, session_id)

        client = scope.get("client")
        client_address = client[0] if isinstance(client, tuple) and client else None
        server_context = create_server_context(
            self.runtime_config,
            auth_context,
            source="http",
            path=normalized_scope.get("path"),
            client_address=client_address,
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
                    self.service_state.session_auth[response_session_id] = authorization
                    # 【关键】把当前 auth_context 对象引用缓存到 session 级缓存。
                    # 这样后续请求带相同 session_id 时，可以从缓存中取出同一引用，
                    # 后续"就地修改"这个 auth_context，MCP SDK restore 回来的旧快照指向
                    # 同一个对象，tool 侧就能看到最新的 headers/username。
                    if response_session_id not in self.service_state.session_auth_contexts:
                        self.service_state.session_auth_contexts[response_session_id] = auth_context
                    # Bearer：提前为该 session 创建 lazy JWTSession，后续请求可直接复用
                    if (
                        isinstance(auth_context.authorization, BearerAuthorization)
                        and response_session_id not in self.service_state.session_jwt_sessions
                        and self._oauth_client is not None
                    ):
                        _, _, tok = auth_context.authorization.raw_authorization.partition(" ")
                        raw_token = tok.strip()
                        if raw_token:
                            self.service_state.session_jwt_sessions[response_session_id] = LogEaseJWTSession(
                                raw_bearer_token=raw_token,
                                runtime_config=self.runtime_config,
                                oauth_client=self._oauth_client,
                            )
                    if parsed_body and parsed_body.get("method") == "initialize":
                        params = parsed_body.get("params")
                        self.service_state.initialize_params[response_session_id] = params if isinstance(params, dict) else {}
                    elif parsed_body and parsed_body.get("method") == "notifications/initialized":
                        self.service_state.initialized_sessions.add(response_session_id)

                if status_code < 400 and method == "DELETE" and session_id:
                    self.service_state.session_auth.pop(session_id, None)
                    self.service_state.initialize_params.pop(session_id, None)
                    self.service_state.initialized_sessions.discard(session_id)
                    self.service_state.session_jwt_sessions.pop(session_id, None)
                    self.service_state.session_auth_contexts.pop(session_id, None)

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

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with AsyncExitStack() as stack:
            for item in mounted_servers.values():
                await stack.enter_async_context(item.server.session_manager.run())
            yield

    app = FastAPI(title="rizhiyi-mcp-python", version="0.2.0", lifespan=lifespan)
    app.router.redirect_slashes = False

    for route_name, factory in server_registry.items():
        service_state = ServiceRuntimeState(route_name=route_name)
        server = factory(settings, service_state)
        mounted_servers[route_name] = MountedServer(route_name=route_name, server=server, state=service_state)
        app.mount(
            f"{settings.mcp_http_base_path}/{route_name}",
            AuthenticatedMountedServerApp(
                route_name=route_name,
                runtime_config=settings,
                server=server,
                service_state=service_state,
            ),
        )

    app.add_middleware(
        NormalizeMountedServerRootPathMiddleware,
        base_path=settings.mcp_http_base_path,
        mounted_servers=mounted_servers,
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        oauth_issuer = getattr(settings, "oauth_issuer", None)
        issuer_preview: str | None = None
        if isinstance(oauth_issuer, str) and oauth_issuer:
            if len(oauth_issuer) <= 20:
                issuer_preview = f"{oauth_issuer[:20]}***" if len(oauth_issuer) > 16 else oauth_issuer
            else:
                issuer_preview = f"{oauth_issuer[:20]}***"
        return {
            "ok": True,
            "http_base_path": settings.mcp_http_base_path,
            "registered_servers": sorted(mounted_servers),
            "session_count": sum(len(item.state.session_auth) for item in mounted_servers.values()),
            "transport_mode": "official_python_mcp_sdk",
            "oauth_enabled": bool(getattr(settings, "oauth_enable", False)),
            "oauth_issuer_preview": issuer_preview,
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


async def _consume_request_body(receive: Receive) -> bytes:
    chunks: list[bytes] = []
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunks.append(message.get("body", b""))
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


def _http_error(
    status_code: int,
    error: str,
    message: str,
    *,
    suggestion: str | None = None,
    details: Any = None,
) -> JSONResponse:
    content: dict[str, Any] = {
        "ok": False,
        "error": error,
        "message": message,
    }
    if suggestion is not None:
        content["suggestion"] = suggestion
    if details is not None:
        content["details"] = details
    return JSONResponse(status_code=status_code, content=content)


def _map_oauth_error(error: OAuthClientError | LogEaseLoginError) -> tuple[int, str]:
    """根据错误类型返回 (HTTP status, 中文建议)。"""
    code = getattr(error, "code", "")
    retryable = bool(getattr(error, "retryable", False))
    err_status = getattr(error, "status", None)
    if isinstance(error, LogEaseLoginError):
        if err_status and err_status >= 500:
            return status.HTTP_502_BAD_GATEWAY, "日志易 JWT 登录服务临时不可用，请稍后重试，或检查 LOGEASE_BASE_URL 与登录端点。"
        if code == "LOGEASE_LOGIN_FAILED":
            return status.HTTP_502_BAD_GATEWAY, "日志易 JWT 登录失败，请确认日志易登录端点与 exchange token 是否被日志易实例接受。"
        return status.HTTP_502_BAD_GATEWAY, "日志易登录链路异常。"
    # OAuthClientError
    if code == "OAUTH_CONFIG_ERROR":
        return status.HTTP_500_INTERNAL_SERVER_ERROR, "请检查 OAUTH_ISSUER / OAUTH_INTROSPECT_ENDPOINT 等配置。"
    if code == "OAUTH_DISCOVER_FAILED":
        s = status.HTTP_502_BAD_GATEWAY if retryable else status.HTTP_500_INTERNAL_SERVER_ERROR
        return s, "OAuth 认证中心 metadata 拉取失败，请核对 OAUTH_ISSUER 与网络连通性。"
    if code == "OAUTH_INTROSPECT_FAILED":
        if err_status == 401 or not retryable:
            return status.HTTP_401_UNAUTHORIZED, "OAuth access_token 无效或已过期，请让客户端重新登录后重试。"
        return status.HTTP_502_BAD_GATEWAY, "OAuth introspect 端点不可用，请联系认证中心管理员。"
    if code == "OAUTH_TOKEN_EXCHANGE_FAILED":
        s = status.HTTP_502_BAD_GATEWAY if retryable else status.HTTP_400_BAD_REQUEST
        return s, "OAuth token exchange 失败，请检查 audience（OAUTH_TOKEN_EXCHANGE_AUDIENCE）与认证中心是否支持 RFC 8693；若不支持可设置 OAUTH_SKIP_EXCHANGE=true 降级。"
    fallback = status.HTTP_502_BAD_GATEWAY if retryable else status.HTTP_400_BAD_REQUEST
    return fallback, "OAuth 链路失败，请查看 details 字段并检查配置。"


def _safe_error_details(details: Any) -> Any | None:
    """把 details 转成 JSON 可序列化（并对敏感的 token 字段脱敏），避免泄露到客户端响应。"""
    if details is None:
        return None
    if isinstance(details, (str, int, float, bool)):
        return details
    if isinstance(details, (list, tuple)):
        return [_safe_error_details(x) for x in details][:50]
    if isinstance(details, dict):
        scrubbed: dict[str, Any] = {}
        for k, v in details.items():
            key = str(k).lower()
            if any(sensitive in key for sensitive in ("token", "secret", "password", "authorization", "credential")):
                if isinstance(v, str) and len(v) > 6:
                    scrubbed[k] = f"{v[:4]}***{v[-2:]}"
                else:
                    scrubbed[k] = "***"
            else:
                scrubbed[k] = _safe_error_details(v)
        return scrubbed
    # 其它类型：字符串化截断
    text = str(details)
    if len(text) > 1000:
        return text[:1000] + "...(truncated)"
    return text


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
