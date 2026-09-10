"""开发环境 Mock OAuth2 授权中心 + 模拟日志易登录与 API。

端点一览：
- /.well-known/oauth-authorization-server  &  /.well-known/openid-configuration（OIDC Discovery）
- /authorize（最小实现）
- /token：password / client_credentials / refresh_token / token-exchange（RFC 8693）grant
- /introspect（RFC 7662，Basic(client_id:secret) 保护）
- /userinfo / /revoke
- /mock/logease-login：模拟日志易 token-login 端点，要求 exchange_token 必须带有 for_audience=logease claim
- /api/v3/{rest_of_path:path}：catchall，回显请求里的 Authorization header + JWT payload，方便断言上游 JWT

仅用于本地开发和端到端自测。
单向依赖：tokens.py + settings.py + httpx/PyJWT/FastAPI。
"""
from __future__ import annotations

from typing import Any

import jwt as pyjwt
from fastapi import FastAPI, Form, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from .settings import DevOAuthSettings
from .tokens import TOKEN_TYPE_ACCESS, TokenIssuer, TokenStore


def create_app(settings: DevOAuthSettings | None = None) -> FastAPI:
    settings = settings or DevOAuthSettings()
    store = TokenStore()
    issuer = TokenIssuer(settings, store)

    app = FastAPI(
        title="rizhiyi-mcp-mock-oauth",
        version="0.1.0",
        description="开发环境专用 Mock OAuth 2.0 认证中心",
    )
    # 把依赖挂到 app.state 上，方便测试和外部访问
    app.state.settings = settings
    app.state.issuer = issuer
    app.state.token_store = store

    # ------------------------------------------------------------------
    # helper
    # ------------------------------------------------------------------
    def _base_origin(request: Request) -> str:
        scheme = request.url.scheme
        host_header = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if host_header:
            return f"{scheme}://{host_header}"
        return settings.resolved_issuer()

    def _well_known_body(issuer: str) -> dict[str, Any]:
        return {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "introspection_endpoint": f"{issuer}/introspect",
            "userinfo_endpoint": f"{issuer}/userinfo",
            "revocation_endpoint": f"{issuer}/revoke",
            "jwks_uri": f"{issuer}/.well-known/jwks.json",
            "grant_types_supported": [
                "password",
                "client_credentials",
                "refresh_token",
                "urn:ietf:params:oauth:grant-type:token-exchange",
            ],
            "token_endpoint_auth_methods_supported": [
                "client_secret_basic",
                "client_secret_post",
            ],
            "response_types_supported": ["token", "code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["HS256"],
            "scopes_supported": ["openid", "profile", "email", "offline_access"],
            "token_exchange_grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "code_challenge_methods_supported": ["plain", "S256"],
        }

    # ------------------------------------------------------------------
    # well-known
    # ------------------------------------------------------------------
    @app.get("/.well-known/oauth-authorization-server", include_in_schema=True)
    async def well_known_oauth(request: Request) -> JSONResponse:
        issuer = settings.resolved_issuer(_base_origin(request))
        # 第一次访问 well-known 时把 issuer 写回 settings 里，保证签发时一致
        if not settings.issuer:
            settings.issuer = issuer
        return JSONResponse(_well_known_body(issuer))

    @app.get("/.well-known/openid-configuration", include_in_schema=True)
    async def well_known_oidc(request: Request) -> JSONResponse:
        return await well_known_oauth(request)

    @app.get("/.well-known/jwks.json", include_in_schema=True)
    async def jwks() -> JSONResponse:
        # 开发环境 HS256，不暴露 key；返回一个空数组或提示用对称算法
        return JSONResponse({"keys": [], "note": "dev server uses HS256 symmetric keys"})

    # ------------------------------------------------------------------
    # authorize（浏览器调试）
    # ------------------------------------------------------------------
    @app.get("/authorize")
    async def authorize_page(
        request: Request,
        response_type: str = "token",
        client_id: str = "",
        redirect_uri: str | None = None,
        scope: str = "",
        state: str = "",
    ) -> Response:
        """调试用，自动给 dev-user 发 token，不做任何登录 UI。"""
        username = settings.default_username
        issued = issuer.issue_access_token(
            subject=username, username=username, scope=scope or settings.default_scope
        )
        frag = (
            f"access_token={issued.token}&token_type=Bearer"
            f"&expires_in={max(0, issued.expires_at - issued.issued_at)}"
            f"&scope={issued.scope}"
        )
        if state:
            frag += f"&state={state}"
        if redirect_uri:
            return Response(status_code=302, headers={"Location": f"{redirect_uri}#{frag}"})
        return JSONResponse(
            {
                "note": "dev auto-approved",
                "access_token": issued.token,
                "token_type": "Bearer",
                "expires_in": max(0, issued.expires_at - issued.issued_at),
                "scope": issued.scope,
                "state": state or None,
            }
        )

    # ------------------------------------------------------------------
    # POST /token
    # ------------------------------------------------------------------
    @app.post("/token")
    async def token_endpoint(
        request: Request,
        grant_type: str = Form(...),
        # password
        username: str | None = Form(None),
        password: str | None = Form(None),
        scope: str | None = Form(None),
        # client_credentials / 都可能用
        client_id: str | None = Form(None),
        client_secret: str | None = Form(None),
        # refresh_token
        refresh_token: str | None = Form(None),
        # token exchange
        subject_token: str | None = Form(None),
        subject_token_type: str | None = Form(None),
        requested_token_type: str | None = Form(None),
        audience: str | None = Form(None),
        requested_subject: str | None = Form(None),
        actor_token: str | None = Form(None),
        actor_token_type: str | None = Form(None),
    ) -> JSONResponse:
        # basic client auth 优先
        basic_user, basic_pass = _parse_basic_auth(request)
        effective_client_id = basic_user or client_id or settings.client_id
        effective_client_secret = basic_pass or client_secret or settings.client_secret

        if effective_client_id != settings.client_id or effective_client_secret != settings.client_secret:
            raise HTTPException(status_code=401, detail={"error": "invalid_client"})

        # --- password ---
        if grant_type == "password":
            uname = (username or settings.default_username).strip() or settings.default_username
            # 密码不校验，开发用
            access = issuer.issue_access_token(
                subject=uname, username=uname, scope=scope or settings.default_scope
            )
            refresh = issuer.issue_refresh_token(subject=uname, username=uname)
            return JSONResponse(
                {
                    "access_token": access.token,
                    "token_type": "Bearer",
                    "expires_in": max(0, access.expires_at - access.issued_at),
                    "refresh_token": refresh.token,
                    "scope": access.scope,
                    "issued_token_type": access.issued_token_type,
                }
            )

        # --- client_credentials ---
        if grant_type == "client_credentials":
            sub = f"client::{effective_client_id}"
            access = issuer.issue_access_token(
                subject=sub,
                username=effective_client_id,
                scope=scope or settings.default_scope,
                client_id=effective_client_id,
            )
            return JSONResponse(
                {
                    "access_token": access.token,
                    "token_type": "Bearer",
                    "expires_in": max(0, access.expires_at - access.issued_at),
                    "scope": access.scope,
                    "issued_token_type": access.issued_token_type,
                }
            )

        # --- refresh_token ---
        if grant_type == "refresh_token":
            if not refresh_token or not store.is_active(refresh_token):
                raise HTTPException(status_code=400, detail={"error": "invalid_grant"})
            issued = store.get(refresh_token)
            assert issued is not None
            # 吊销旧 refresh token
            store.revoke(refresh_token)
            access = issuer.issue_access_token(
                subject=issued.subject, username=issued.username, scope=issued.scope
            )
            new_refresh = issuer.issue_refresh_token(subject=issued.subject, username=issued.username)
            return JSONResponse(
                {
                    "access_token": access.token,
                    "token_type": "Bearer",
                    "expires_in": max(0, access.expires_at - access.issued_at),
                    "refresh_token": new_refresh.token,
                    "scope": access.scope,
                }
            )

        # --- token exchange ---
        if grant_type == "urn:ietf:params:oauth:grant-type:token-exchange":
            if not subject_token:
                raise HTTPException(status_code=400, detail={"error": "invalid_request", "error_description": "subject_token required"})
            try:
                exchanged = issuer.exchange_token(
                    subject_token=subject_token,
                    requested_token_type=requested_token_type or TOKEN_TYPE_ACCESS,
                    audience=audience,
                    scope=scope,
                )
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "invalid_grant", "error_description": exc.args[0]},
                )
            return JSONResponse(
                {
                    "access_token": exchanged.token,
                    "issued_token_type": exchanged.issued_token_type,
                    "token_type": "Bearer",
                    "expires_in": max(0, exchanged.expires_at - exchanged.issued_at),
                    "scope": exchanged.scope,
                    "audience": exchanged.audience,
                    "for_audience": exchanged.for_audience,
                }
            )

        raise HTTPException(
            status_code=400,
            detail={"error": "unsupported_grant_type", "error_description": f"grant_type={grant_type}"},
        )

    # ------------------------------------------------------------------
    # introspect
    # ------------------------------------------------------------------
    @app.post("/introspect")
    async def introspect_endpoint(
        request: Request,
        token: str = Form(...),
        token_type_hint: str | None = Form(None),
        client_id: str | None = Form(None),
        client_secret: str | None = Form(None),
    ) -> JSONResponse:
        basic_user, basic_pass = _parse_basic_auth(request)
        effective_client_id = basic_user or client_id or settings.client_id
        effective_client_secret = basic_pass or client_secret or settings.client_secret
        if effective_client_id != settings.client_id or effective_client_secret != settings.client_secret:
            raise HTTPException(status_code=401, detail={"error": "invalid_client"})
        return JSONResponse(issuer.introspect(token))

    # ------------------------------------------------------------------
    # userinfo
    # ------------------------------------------------------------------
    @app.post("/userinfo")
    async def userinfo_endpoint(request: Request) -> JSONResponse:
        token = _extract_bearer(request)
        info = issuer.introspect(token)
        if not info.get("active"):
            raise HTTPException(status_code=401, detail={"error": "invalid_token"})
        return JSONResponse(
            {
                "sub": info.get("sub"),
                "preferred_username": info.get("username"),
                "email": f"{info.get('username')}@example.com",
                "scope": info.get("scope"),
            }
        )

    # ------------------------------------------------------------------
    # revoke
    # ------------------------------------------------------------------
    @app.post("/revoke")
    async def revoke_endpoint(
        request: Request,
        token: str = Form(...),
        token_type_hint: str | None = Form(None),
    ) -> JSONResponse:
        # 不严格校验 client，方便调试
        store.revoke(token)
        return JSONResponse({})

    # ------------------------------------------------------------------
    # mock 日志易 login：接受 exchange token 并回日志易 JWT
    # ------------------------------------------------------------------
    @app.post("/mock/logease-login")
    async def mock_logease_login(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail={"error": "invalid_json"})
        # 配置化字段名（默认 token）
        exchange_token = (
            body.get("token")
            or body.get("access_token")
            or body.get("exchange_token")
        )
        if not exchange_token:
            # 也允许 Authorization: Bearer <exchange_token>
            try:
                exchange_token = _extract_bearer(request)
            except HTTPException:
                exchange_token = ""
        if not exchange_token:
            raise HTTPException(status_code=400, detail={"error": "missing_token"})
        try:
            result = issuer.issue_logease_jwt(exchange_token=exchange_token)
        except ValueError as exc:
            raise HTTPException(status_code=401, detail={"error": "invalid_token", "error_description": exc.args[0]})
        return JSONResponse(result)

    # ------------------------------------------------------------------
    # 额外：一个被保护的示例 API（验证 JWT），方便手动确认链路
    # ------------------------------------------------------------------
    @app.get("/api/me")
    async def api_me(request: Request) -> JSONResponse:
        token = _extract_bearer(request)
        try:
            payload = pyjwt.decode(
                token,
                settings.signing_key,
                algorithms=[settings.signing_alg],
                issuer=settings.resolved_issuer(),
                options={"verify_aud": False},
            )
        except pyjwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail={"error": str(exc)})
        return JSONResponse(payload)

    # ------------------------------------------------------------------
    # 开发辅助：模拟日志易上游接口，返回它接收到的 Authorization header 和 query 参数
    # 用于端到端验证"原始 Bearer token 是否已被替换为日志易 JWT"
    # ------------------------------------------------------------------
    @app.api_route(
        "/api/v3/{rest_of_path:path}",
        methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        include_in_schema=False,
    )
    async def catchall_logease_api_mock(
        request: Request, rest_of_path: str, username: str | None = None
    ) -> JSONResponse:
        auth = request.headers.get("authorization")
        # 解析 JWT payload（不校验签名，仅回显）
        decoded: Any = None
        if auth and auth.lower().startswith("bearer "):
            jwt = auth.split(" ", 1)[1].strip()
            try:
                decoded = pyjwt.decode(jwt, options={"verify_signature": False, "verify_aud": False, "verify_exp": False})
            except pyjwt.PyJWTError:
                decoded = {"_decode_error": True}
        return JSONResponse(
            {
                "mock_logease_api": True,
                "method": request.method,
                "path": f"/api/v3/{rest_of_path}",
                "query_username": username,
                "received_authorization": auth,  # 关键：把实际收到的 Authorization 透传给调用方
                "jwt_payload": decoded,
            }
        )

    return app


# ----------------------------------------------------------------------
# utils
# ----------------------------------------------------------------------
def _parse_basic_auth(request: Request) -> tuple[str | None, str | None]:
    import base64

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return None, None
    encoded = header.split(" ", 1)[1].strip()
    try:
        decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
    except Exception:
        return None, None
    if ":" not in decoded:
        return None, None
    user, _, pwd = decoded.partition(":")
    return user or None, pwd or None


def _extract_bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"error": "missing_bearer_token"})
    return header.split(" ", 1)[1].strip()
