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
from .server_registry import server_registry
from .servers import (
    RizhiyiFastMCPServer,
    ServiceRuntimeState,
    pop_request_runtime_context,
    push_request_runtime_context,
)


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
                    if parsed_body and parsed_body.get("method") == "initialize":
                        params = parsed_body.get("params")
                        self.service_state.initialize_params[response_session_id] = params if isinstance(params, dict) else {}
                    elif parsed_body and parsed_body.get("method") == "notifications/initialized":
                        self.service_state.initialized_sessions.add(response_session_id)

                if status_code < 400 and method == "DELETE" and session_id:
                    self.service_state.session_auth.pop(session_id, None)
                    self.service_state.initialize_params.pop(session_id, None)
                    self.service_state.initialized_sessions.discard(session_id)

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
        return {
            "ok": True,
            "http_base_path": settings.mcp_http_base_path,
            "registered_servers": sorted(mounted_servers),
            "session_count": sum(len(item.state.session_auth) for item in mounted_servers.values()),
            "transport_mode": "official_python_mcp_sdk",
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
