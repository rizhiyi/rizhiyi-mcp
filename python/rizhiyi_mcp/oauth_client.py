"""OAuth2 客户端：well-known 发现、introspect、token exchange（RFC 8693）。

设计目标：
- 只对 RuntimeConfig 的 oauth_* 字段负责，不依赖 MCP 其它模块（除 httpx）
- 所有远端访问失败抛 OAuthClientError（含 error_code、retryable），调用方决定 HTTP 返回
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .config import RuntimeConfig


# RFC 8693 / OAuth Token Type URIs
TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token"
TOKEN_TYPE_REFRESH = "urn:ietf:params:oauth:token-type:refresh_token"
TOKEN_TYPE_ID = "urn:ietf:params:oauth:token-type:id_token"
GRANT_TYPE_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"


class OAuthClientError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool = False,
        status: int | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status = status
        self.details = details


@dataclass(slots=True)
class OAuthIntrospectResult:
    active: bool
    sub: str | None = None
    username: str | None = None
    exp: int | None = None
    scope: str | None = None
    client_id: str | None = None
    aud: str | None = None
    raw: dict[str, Any] | None = None


@dataclass(slots=True)
class OAuthTokenResult:
    access_token: str
    token_type: str
    expires_in: int | None = None
    issued_token_type: str | None = None
    refresh_token: str | None = None
    scope: str | None = None
    audience: str | None = None
    raw: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# OAuth client
# ---------------------------------------------------------------------------
class OAuthClient:
    def __init__(self, config: RuntimeConfig) -> None:
        self._cfg = config
        self._issuer = (config.oauth_issuer or "").rstrip("/")
        if not self._issuer and not (config.oauth_introspect_endpoint and config.oauth_token_endpoint):
            raise OAuthClientError(
                "OAuth 未配置 issuer，也未显式设置 introspect/token 端点。",
                code="OAUTH_CONFIG_ERROR",
                retryable=False,
            )
        self._discovered: dict[str, Any] | None = None
        self._discover_lock_imported = False  # lazy，需要异步锁时由调用方注入
        self._timeout = float(config.upstream_timeout_seconds)

    # --------------------------------------------------------------
    # well-known discovery
    # --------------------------------------------------------------
    async def discover(self, *, force: bool = False) -> dict[str, Any]:
        if self._discovered is not None and not force:
            return self._discovered
        # 若已手动配置全部端点，跳过 discover
        if (
            self._cfg.oauth_introspect_endpoint
            and self._cfg.oauth_token_endpoint
        ):
            cached = {
                "issuer": self._issuer or "explicit-config",
                "introspection_endpoint": self._cfg.oauth_introspect_endpoint,
                "token_endpoint": self._cfg.oauth_token_endpoint,
            }
            self._discovered = cached
            return cached
        if not self._issuer:
            raise OAuthClientError(
                "缺少 OAUTH_ISSUER 且未显式配置 introspect/token 端点。",
                code="OAUTH_CONFIG_ERROR",
                retryable=False,
            )
        urls_to_try = [
            f"{self._issuer}/.well-known/oauth-authorization-server",
            f"{self._issuer}/.well-known/openid-configuration",
        ]
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as http:
            for url in urls_to_try:
                try:
                    resp = await http.get(url)
                except httpx.HTTPError as exc:
                    last_error = exc
                    continue
                if resp.status_code != 200:
                    last_error = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                    continue
                try:
                    body = resp.json()
                except ValueError as exc:
                    last_error = exc
                    continue
                if not isinstance(body, dict):
                    last_error = ValueError("well-known 响应不是 object")
                    continue
                # 允许显式配置覆盖 discover 结果
                if self._cfg.oauth_introspect_endpoint:
                    body["introspection_endpoint"] = self._cfg.oauth_introspect_endpoint
                if self._cfg.oauth_token_endpoint:
                    body["token_endpoint"] = self._cfg.oauth_token_endpoint
                self._discovered = body
                return body
        raise OAuthClientError(
            f"无法从 issuer 获取 OAuth metadata: {last_error}",
            code="OAUTH_DISCOVER_FAILED",
            retryable=True,
            details={"issuer": self._issuer, "last_error": str(last_error)},
        )

    async def introspection_endpoint(self) -> str:
        doc = await self.discover()
        key = "introspection_endpoint"
        value = doc.get(key) or doc.get("introspect_endpoint")
        if not isinstance(value, str) or not value:
            raise OAuthClientError(
                "metadata 中缺少 introspection_endpoint。",
                code="OAUTH_DISCOVER_FAILED",
                retryable=False,
            )
        return value

    async def token_endpoint(self) -> str:
        doc = await self.discover()
        value = doc.get("token_endpoint")
        if not isinstance(value, str) or not value:
            raise OAuthClientError(
                "metadata 中缺少 token_endpoint。",
                code="OAUTH_DISCOVER_FAILED",
                retryable=False,
            )
        return value

    # --------------------------------------------------------------
    # client credentials
    # --------------------------------------------------------------
    def _client_auth(self) -> tuple[str, str] | None:
        cid = self._cfg.oauth_client_id
        csec = self._cfg.oauth_client_secret
        if not cid and not csec:
            return None
        return (cid or "", csec or "")

    # --------------------------------------------------------------
    # introspect
    # --------------------------------------------------------------
    async def introspect(self, access_token: str) -> OAuthIntrospectResult:
        if not access_token:
            return OAuthIntrospectResult(active=False)

        endpoint = await self.introspection_endpoint()
        body = {"token": access_token, "token_type_hint": "access_token"}
        auth = self._client_auth()
        headers = {"Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                resp = await http.post(
                    endpoint,
                    data=body,
                    auth=auth,
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            raise OAuthClientError(
                f"访问 introspect 端点失败：{exc}",
                code="OAUTH_INTROSPECT_FAILED",
                retryable=True,
                details={"endpoint": endpoint},
            ) from exc

        if resp.status_code >= 500:
            raise OAuthClientError(
                f"introspect 端点返回 HTTP {resp.status_code}",
                code="OAUTH_INTROSPECT_FAILED",
                retryable=True,
                status=resp.status_code,
                details={"body": _truncate(resp.text)},
            )
        try:
            data = resp.json()
        except ValueError:
            # RFC 7662 要求 200 + JSON，但部分实现遇到非法 token 直接 401
            if resp.status_code >= 400:
                return OAuthIntrospectResult(active=False, raw={"_raw_text": resp.text[:200]})
            raise OAuthClientError(
                "introspect 响应不是合法 JSON。",
                code="OAUTH_INTROSPECT_FAILED",
                retryable=False,
                status=resp.status_code,
                details={"body": _truncate(resp.text)},
            )
        if resp.status_code >= 400:
            return OAuthIntrospectResult(active=False, raw=data)
        if not isinstance(data, dict):
            raise OAuthClientError(
                "introspect 响应不是 object。",
                code="OAUTH_INTROSPECT_FAILED",
                retryable=False,
                details={"body": _truncate(resp.text)},
            )
        active = bool(data.get("active", False))
        return OAuthIntrospectResult(
            active=active,
            sub=data.get("sub"),
            username=_pick_username(data),
            exp=data.get("exp"),
            scope=data.get("scope"),
            client_id=data.get("client_id"),
            aud=_pick_aud(data),
            raw=data,
        )

    # --------------------------------------------------------------
    # token exchange
    # --------------------------------------------------------------
    async def token_exchange(
        self,
        subject_token: str,
        *,
        audience: str | None = None,
        requested_token_type: str | None = None,
        scope: str | None = None,
    ) -> OAuthTokenResult:
        # 跳过 exchange（降级）：直接把 subject_token 包装成结果返回
        if self._cfg.oauth_skip_exchange:
            return OAuthTokenResult(
                access_token=subject_token,
                token_type="Bearer",
                issued_token_type=requested_token_type or TOKEN_TYPE_ACCESS,
                audience=audience,
                scope=scope,
                raw={"skipped": True},
            )

        endpoint = await self.token_endpoint()
        body: dict[str, str] = {
            "grant_type": GRANT_TYPE_TOKEN_EXCHANGE,
            "subject_token": subject_token,
            "subject_token_type": TOKEN_TYPE_ACCESS,
            "requested_token_type": requested_token_type or TOKEN_TYPE_ACCESS,
        }
        aud = audience if audience else self._cfg.oauth_token_exchange_audience
        if aud:
            body["audience"] = aud
        if scope:
            body["scope"] = scope

        auth = self._client_auth()
        headers = {"Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                resp = await http.post(endpoint, data=body, auth=auth, headers=headers)
        except httpx.HTTPError as exc:
            raise OAuthClientError(
                f"访问 token exchange 端点失败：{exc}",
                code="OAUTH_TOKEN_EXCHANGE_FAILED",
                retryable=True,
                details={"endpoint": endpoint},
            ) from exc

        try:
            data = resp.json()
        except ValueError:
            data = {"_raw_text": resp.text[:500]}
        if resp.status_code >= 400:
            msg = (
                data.get("error_description")
                or data.get("message")
                or f"HTTP {resp.status_code}"
            )
            raise OAuthClientError(
                f"token exchange 失败：{msg}",
                code="OAUTH_TOKEN_EXCHANGE_FAILED",
                retryable=resp.status_code >= 500,
                status=resp.status_code,
                details=data if isinstance(data, dict) else {"body": str(data)},
            )
        if not isinstance(data, dict):
            raise OAuthClientError(
                "token exchange 响应不是 object。",
                code="OAUTH_TOKEN_EXCHANGE_FAILED",
                retryable=False,
                details={"body": _truncate(resp.text)},
            )
        access_token = data.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise OAuthClientError(
                "token exchange 响应缺少 access_token。",
                code="OAUTH_TOKEN_EXCHANGE_FAILED",
                retryable=False,
                details=data,
            )
        return OAuthTokenResult(
            access_token=access_token,
            token_type=str(data.get("token_type") or "Bearer"),
            expires_in=_to_int_or_none(data.get("expires_in")),
            issued_token_type=data.get("issued_token_type"),
            refresh_token=data.get("refresh_token") if isinstance(data.get("refresh_token"), str) else None,
            scope=data.get("scope"),
            audience=data.get("audience") or aud,
            raw=data,
        )

    # --------------------------------------------------------------
    # misc helper
    # --------------------------------------------------------------
    async def ensure_issuer_allowed(self) -> None:
        """仅作为 sanity check：配置了 OAuth 但没有可用的配置时直接抛错。"""
        await self.discover()


def _pick_username(obj: dict[str, Any]) -> str | None:
    for key in ("username", "preferred_username", "user_name", "login", "name"):
        value = obj.get(key)
        if isinstance(value, str) and value:
            return value
    sub = obj.get("sub")
    if isinstance(sub, str) and sub and not sub.startswith("client::"):
        return sub
    return None


def _pick_aud(obj: dict[str, Any]) -> str | None:
    aud = obj.get("aud")
    if isinstance(aud, list):
        return aud[0] if aud else None
    return aud if isinstance(aud, str) else None


def _to_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _truncate(text: str, limit: int = 500) -> str:
    if text is None:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + "...(truncated)"


def _mask(value: str) -> str:
    if len(value) <= 6:
        return f"{value[:2]}***"
    return f"{value[:4]}***{value[-2:]}"
