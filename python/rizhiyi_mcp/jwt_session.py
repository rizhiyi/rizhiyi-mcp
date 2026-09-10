"""日志易 JWT Session：执行 introspect -> token exchange -> 日志易 login 获取 JWT，并负责缓存、自动续期、single-flight。

本模块依赖：
- oauth_client.OAuthClient（introspect + exchange）
- config.RuntimeConfig（所有 oauth_*、logease_*、upstream_timeout_seconds）
- httpx（调日志易 login 接口）
- PyJWT（decode JWT 获取 exp，若 expires_in 缺失）

OAuth 链路错误统一抛 OAuthClientError 或 LogEaseLoginError（均含 error_code/retryable）。
调用方（gateway）负责捕获并转换为 HTTP 响应。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt as pyjwt

from .config import RuntimeConfig
from .oauth_client import (
    OAuthClient,
    OAuthClientError,
    OAuthIntrospectResult,
    OAuthTokenResult,
)


class LogEaseLoginError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "LOGEASE_LOGIN_FAILED",
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
class LogEaseJWT:
    access_token: str
    refresh_token: str | None
    token_type: str
    expires_at: int  # epoch seconds
    raw: dict[str, Any]


class LogEaseJWTSession:
    def __init__(
        self,
        *,
        raw_bearer_token: str,
        runtime_config: RuntimeConfig,
        oauth_client: OAuthClient,
    ) -> None:
        if not raw_bearer_token:
            raise ValueError("raw_bearer_token 不能为空。")
        self._raw = raw_bearer_token
        self._cfg = runtime_config
        self._oauth = oauth_client
        self._lock = asyncio.Lock()

        # 状态
        self._introspect_result: OAuthIntrospectResult | None = None
        self._exchange_token: str | None = None
        self._logease_jwt: LogEaseJWT | None = None

    # ------------------------------------------------------------------
    # public api
    # ------------------------------------------------------------------
    async def get_logease_auth_headers(self) -> dict[str, str]:
        """获取调用日志易 API 所需的请求头（含 Authorization: Bearer <JWT>）。"""
        jwt = await self._ensure_valid_jwt()
        return {"Authorization": f"{jwt.token_type} {jwt.access_token}"}

    @property
    def username(self) -> str | None:
        """从 introspect 或 jwt 中推导出来的用户名。"""
        if self._introspect_result is not None:
            return self._introspect_result.username or self._introspect_result.sub
        if self._logease_jwt is not None:
            try:
                payload = pyjwt.decode(
                    self._logease_jwt.access_token,
                    options={"verify_signature": False, "verify_aud": False},
                )
                return payload.get("username") or payload.get("preferred_username") or payload.get("sub")
            except pyjwt.PyJWTError:
                return None
        return None

    # ------------------------------------------------------------------
    # cache check + single-flight
    # ------------------------------------------------------------------
    def _cached_jwt_still_valid(self) -> LogEaseJWT | None:
        j = self._logease_jwt
        if j is None:
            return None
        now = int(time.time())
        if j.expires_at - now > int(self._cfg.oauth_jwt_refresh_ahead_seconds):
            return j
        return None

    async def _ensure_valid_jwt(self) -> LogEaseJWT:
        # fast path：不用加锁先试一次缓存
        cached = self._cached_jwt_still_valid()
        if cached is not None:
            return cached
        # slow path：加锁，实现 single-flight
        async with self._lock:
            # 其它协程可能刚完成，再检查一次
            cached = self._cached_jwt_still_valid()
            if cached is not None:
                return cached
            # 尝试 refresh（如果有 refresh_token）
            refreshed_ok = False
            if self._logease_jwt and self._logease_jwt.refresh_token:
                try:
                    new_jwt = await self._refresh_logease_jwt(self._logease_jwt.refresh_token)
                    self._logease_jwt = new_jwt
                    refreshed_ok = True
                except LogEaseLoginError:
                    # refresh 失败就走完整链路重建
                    refreshed_ok = False
            if not refreshed_ok:
                self._logease_jwt = await self._run_full_chain()
            assert self._logease_jwt is not None
            return self._logease_jwt

    # ------------------------------------------------------------------
    # full chain: introspect -> exchange -> logease login
    # ------------------------------------------------------------------
    async def _run_full_chain(self) -> LogEaseJWT:
        # 1. introspect
        intro = await self._oauth.introspect(self._raw)
        if not intro.active:
            raise OAuthClientError(
                "OAuth access_token 未通过认证中心校验（inactive）。",
                code="OAUTH_INTROSPECT_FAILED",
                retryable=False,
                status=401,
                details=intro.raw,
            )
        self._introspect_result = intro

        # 2. token exchange（除非 skip）
        exchange: OAuthTokenResult
        try:
            exchange = await self._oauth.token_exchange(
                self._raw,
                audience=self._cfg.oauth_token_exchange_audience or None,
            )
        except OAuthClientError:
            raise
        self._exchange_token = exchange.access_token

        # 3. logease login：用 exchange token 换日志易 JWT
        login_token = exchange.access_token
        jwt = await self._call_logease_login(login_token)
        return jwt

    # ------------------------------------------------------------------
    # logease login + refresh
    # ------------------------------------------------------------------
    async def _call_logease_login(self, exchange_token: str) -> LogEaseJWT:
        cfg = self._cfg
        endpoint_cfg = (cfg.logease_login_endpoint or "").strip()
        if endpoint_cfg.startswith("http://") or endpoint_cfg.startswith("https://"):
            # 绝对 URL（开发环境下 mock OAuth server 的端点）
            url = endpoint_cfg
        else:
            # 相对路径，拼接 logease_base_url
            base = cfg.logease_base_url.rstrip("/")
            path = endpoint_cfg if endpoint_cfg.startswith("/") else f"/{endpoint_cfg}"
            url = f"{base}{path}"

        body: dict[str, Any] = {cfg.logease_login_token_field: exchange_token}
        # 传 username（如果有）：兼容日志易要求 username query 或 body 的场景
        if self._introspect_result is not None:
            uname = self._introspect_result.username or self._introspect_result.sub
            params: dict[str, Any] = {"username": uname} if uname else None
        else:
            params = None
        try:
            async with httpx.AsyncClient(
                timeout=float(cfg.upstream_timeout_seconds),
                verify=bool(cfg.logease_tls_reject_unauthorized),
            ) as http:
                resp = await http.post(
                    url,
                    json=body,
                    params=params,
                    headers={"Accept": "application/json"},
                )
        except httpx.ConnectError as exc:
            raise LogEaseLoginError(
                f"日志易 login 连接失败：{exc}",
                code="LOGEASE_LOGIN_FAILED",
                retryable=True,
                status=502,
            ) from exc
        except httpx.HTTPError as exc:
            raise LogEaseLoginError(
                f"日志易 login 调用失败：{exc}",
                code="LOGEASE_LOGIN_FAILED",
                retryable=True,
                status=502,
            ) from exc

        try:
            data = resp.json()
        except ValueError:
            data = {"_raw_text": resp.text[:500]}

        if resp.status_code >= 400:
            msg = (
                _digest_error_message(data)
                or f"HTTP {resp.status_code}"
            )
            raise LogEaseLoginError(
                f"日志易 login 被拒绝：{msg}",
                code="LOGEASE_LOGIN_FAILED",
                retryable=resp.status_code >= 500,
                status=resp.status_code,
                details=data if isinstance(data, dict) else {"body": str(data)},
            )
        if not isinstance(data, dict):
            raise LogEaseLoginError(
                "日志易 login 响应不是 object。",
                code="LOGEASE_LOGIN_FAILED",
                retryable=False,
                details={"body": _short(resp.text)},
            )
        access = data.get("access_token")
        if not isinstance(access, str) or not access:
            # 有些日志易版本返回在 {token} 或 {data: {access_token}} 里
            access = _find_access_token(data)
            if not access:
                raise LogEaseLoginError(
                    "日志易 login 响应中未找到 access_token。",
                    code="LOGEASE_LOGIN_FAILED",
                    retryable=False,
                    details=data,
                )
        expires_in = _to_int_or_none(data.get("expires_in"))
        exp_from_jwt = _extract_exp_from_jwt(access)
        if expires_in is None and exp_from_jwt is not None:
            expires_at = exp_from_jwt
        elif expires_in is not None:
            expires_at = int(time.time()) + int(expires_in)
        elif exp_from_jwt is not None:
            expires_at = exp_from_jwt
        else:
            # 默认 30 分钟
            expires_at = int(time.time()) + 1800

        token_type = str(data.get("token_type") or "Bearer")
        refresh = data.get("refresh_token")
        refresh_str = refresh if isinstance(refresh, str) and refresh else None
        return LogEaseJWT(
            access_token=access,
            refresh_token=refresh_str,
            token_type=token_type,
            expires_at=expires_at,
            raw=data,
        )

    async def _refresh_logease_jwt(self, refresh_token: str) -> LogEaseJWT:
        cfg = self._cfg
        # 开发环境常把 logease_login_endpoint 指向 mock server，但 refresh 接口通常和 login 在同一 host
        endpoint_cfg = (cfg.logease_login_endpoint or "").strip()
        if endpoint_cfg.startswith("http://") or endpoint_cfg.startswith("https://"):
            # 假设 refresh 在同一 origin 下的 /api/v3/login/token/refresh/
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(endpoint_cfg)
            origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
            url = f"{origin}/api/v3/login/token/refresh/"
        else:
            base = cfg.logease_base_url.rstrip("/")
            url = f"{base}/api/v3/login/token/refresh/"

        body: dict[str, Any] = {"refresh_token": refresh_token}
        # 如果默认 refresh 接口不对，允许通过 LOGEASE_LOGIN_REFRESH_ENDPOINT 覆盖
        # （使用 pydantic settings env 别名时更自然，这里简单处理）
        override = getattr(cfg, "logease_login_refresh_endpoint", None)
        if isinstance(override, str) and override.strip():
            endpoint = override.strip()
            if endpoint.startswith("http://") or endpoint.startswith("https://"):
                url = endpoint
            else:
                base = cfg.logease_base_url.rstrip("/")
                path = endpoint if endpoint.startswith("/") else f"/{endpoint}"
                url = f"{base}{path}"

        try:
            async with httpx.AsyncClient(
                timeout=float(cfg.upstream_timeout_seconds),
                verify=bool(cfg.logease_tls_reject_unauthorized),
            ) as http:
                resp = await http.post(
                    url,
                    json=body,
                    headers={"Accept": "application/json"},
                )
        except httpx.HTTPError as exc:
            raise LogEaseLoginError(
                f"日志易 JWT refresh 调用失败：{exc}",
                code="LOGEASE_LOGIN_FAILED",
                retryable=True,
                status=502,
            ) from exc
        if resp.status_code >= 400:
            raise LogEaseLoginError(
                f"日志易 JWT refresh 拒绝：HTTP {resp.status_code}",
                code="LOGEASE_LOGIN_FAILED",
                retryable=resp.status_code >= 500,
                status=resp.status_code,
                details={"body": _short(resp.text)},
            )
        try:
            data = resp.json()
        except ValueError:
            raise LogEaseLoginError(
                "日志易 refresh 响应不是 JSON。",
                code="LOGEASE_LOGIN_FAILED",
                retryable=False,
                details={"body": _short(resp.text)},
            )
        if not isinstance(data, dict):
            raise LogEaseLoginError(
                "refresh 响应不是 object。",
                code="LOGEASE_LOGIN_FAILED",
                retryable=False,
                details={"body": _short(resp.text)},
            )
        access = data.get("access_token")
        if not isinstance(access, str) or not access:
            raise LogEaseLoginError(
                "refresh 响应缺少 access_token。",
                code="LOGEASE_LOGIN_FAILED",
                retryable=False,
                details=data,
            )
        expires_in = _to_int_or_none(data.get("expires_in"))
        exp_jwt = _extract_exp_from_jwt(access)
        if expires_in is not None:
            expires_at = int(time.time()) + expires_in
        elif exp_jwt is not None:
            expires_at = exp_jwt
        else:
            expires_at = int(time.time()) + 1800
        refresh = data.get("refresh_token")
        return LogEaseJWT(
            access_token=access,
            refresh_token=refresh if isinstance(refresh, str) else None,
            token_type=str(data.get("token_type") or "Bearer"),
            expires_at=expires_at,
            raw=data,
        )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _digest_error_message(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in ("error_description", "message", "msg", "error", "detail"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    err = data.get("error")
    if isinstance(err, dict):
        for key in ("message", "description", "code"):
            val = err.get(key)
            if isinstance(val, str) and val:
                return f"{key}: {val}"
    return None


def _find_access_token(data: dict[str, Any]) -> str | None:
    for key in ("accessToken", "token", "jwt", "jwt_token", "bearer"):
        val = data.get(key)
        if isinstance(val, str) and val:
            return val
    inner = data.get("data")
    if isinstance(inner, dict):
        return _find_access_token(inner)
    return None


def _to_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_exp_from_jwt(access_token: str) -> int | None:
    try:
        payload = pyjwt.decode(
            access_token,
            options={"verify_signature": False, "verify_aud": False, "verify_exp": False},
        )
    except pyjwt.PyJWTError:
        return None
    exp = payload.get("exp")
    if isinstance(exp, int):
        return exp
    if isinstance(exp, (float, str)):
        try:
            return int(exp)
        except (TypeError, ValueError):
            return None
    return None


def _short(text: str, limit: int = 500) -> str:
    if text is None:
        return ""
    return text if len(text) <= limit else text[:limit] + "...(truncated)"
