from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

import jwt as pyjwt

from .settings import DevOAuthSettings


TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token"
TOKEN_TYPE_REFRESH = "urn:ietf:params:oauth:token-type:refresh_token"
TOKEN_TYPE_ID = "urn:ietf:params:oauth:token-type:id_token"


@dataclass(slots=True)
class IssuedToken:
    token: str
    token_id: str
    subject: str
    username: str
    scope: str
    audience: str | None
    issued_token_type: str
    expires_at: int  # epoch seconds
    issued_at: int
    client_id: str
    # exchange 专用标记：若 audience=logease 时额外附带
    for_audience: str | None = None


class TokenStore:
    """内存 token 存储，重启即清空。仅开发用途。"""

    def __init__(self) -> None:
        self._by_token: dict[str, IssuedToken] = {}
        self._by_id: dict[str, IssuedToken] = {}

    def add(self, issued: IssuedToken) -> None:
        self._by_token[issued.token] = issued
        self._by_id[issued.token_id] = issued

    def get(self, token: str) -> IssuedToken | None:
        return self._by_token.get(token)

    def revoke(self, token: str) -> None:
        issued = self._by_token.pop(token, None)
        if issued is not None:
            self._by_id.pop(issued.token_id, None)

    def is_active(self, token: str) -> bool:
        issued = self.get(token)
        if issued is None:
            return False
        if issued.expires_at < int(time.time()):
            # 过期就清掉，省内存
            self.revoke(token)
            return False
        return True


class TokenIssuer:
    def __init__(self, settings: DevOAuthSettings, store: TokenStore) -> None:
        self._s = settings
        self._store = store

    # ------------------------------------------------------------------
    # 通用 access token 签发
    # ------------------------------------------------------------------
    def issue_access_token(
        self,
        *,
        subject: str,
        username: str,
        scope: str | None = None,
        audience: str | None = None,
        client_id: str | None = None,
        ttl_seconds: int | None = None,
        issued_token_type: str = TOKEN_TYPE_ACCESS,
        for_audience: str | None = None,
    ) -> IssuedToken:
        ttl = ttl_seconds if ttl_seconds is not None else self._s.access_token_ttl_seconds
        now = int(time.time())
        token_id = str(uuid.uuid4())
        payload: dict[str, Any] = {
            "iss": self._s.resolved_issuer(),
            "sub": subject,
            "aud": audience or "rizhiyi-mcp",
            "exp": now + ttl,
            "iat": now,
            "jti": token_id,
            "username": username,
            "scope": scope or self._s.default_scope,
            "client_id": client_id or self._s.client_id,
            "issued_token_type": issued_token_type,
        }
        if for_audience:
            payload["for_audience"] = for_audience
        token = pyjwt.encode(payload, self._s.signing_key, algorithm=self._s.signing_alg)
        issued = IssuedToken(
            token=token,
            token_id=token_id,
            subject=subject,
            username=username,
            scope=payload["scope"],
            audience=payload["aud"],
            issued_token_type=issued_token_type,
            expires_at=payload["exp"],
            issued_at=now,
            client_id=payload["client_id"],
            for_audience=for_audience,
        )
        self._store.add(issued)
        return issued

    def issue_refresh_token(self, *, subject: str, username: str) -> IssuedToken:
        now = int(time.time())
        token_id = f"ref-{uuid.uuid4()}"
        payload = {
            "iss": self._s.resolved_issuer(),
            "sub": subject,
            "aud": "refresh",
            "exp": now + self._s.refresh_token_ttl_seconds,
            "iat": now,
            "jti": token_id,
            "username": username,
            "client_id": self._s.client_id,
            "issued_token_type": TOKEN_TYPE_REFRESH,
        }
        token = pyjwt.encode(payload, self._s.signing_key, algorithm=self._s.signing_alg)
        issued = IssuedToken(
            token=token,
            token_id=token_id,
            subject=subject,
            username=username,
            scope="offline_access",
            audience="refresh",
            issued_token_type=TOKEN_TYPE_REFRESH,
            expires_at=payload["exp"],
            issued_at=now,
            client_id=self._s.client_id,
        )
        self._store.add(issued)
        return issued

    # ------------------------------------------------------------------
    # token exchange（RFC 8693）
    # ------------------------------------------------------------------
    def exchange_token(
        self,
        *,
        subject_token: str,
        requested_token_type: str | None,
        audience: str | None,
        scope: str | None,
    ) -> IssuedToken:
        original = self._store.get(subject_token)
        if original is None or not self._store.is_active(subject_token):
            raise ValueError("invalid_subject_token")

        # 基础继承原 subject/username
        new_scope = scope or original.scope
        new_audience = audience or "rizhiyi-mcp"
        return self.issue_access_token(
            subject=original.subject,
            username=original.username,
            scope=new_scope,
            audience=new_audience,
            client_id=original.client_id,
            issued_token_type=requested_token_type or TOKEN_TYPE_ACCESS,
            for_audience=audience,
        )

    # ------------------------------------------------------------------
    # 模拟日志易 login：接受 exchange 返回的 token，签发日志易 JWT
    # ------------------------------------------------------------------
    def issue_logease_jwt(
        self,
        *,
        exchange_token: str,
    ) -> dict[str, Any]:
        issued = self._store.get(exchange_token)
        if issued is None:
            raise ValueError("invalid_token")
        # 必须是面向 logease 的 token（通过 token exchange 获取）
        if issued.for_audience != "logease":
            raise ValueError("token_not_audience_logease")
        if not self._store.is_active(exchange_token):
            raise ValueError("expired_token")

        now = int(time.time())
        ttl = self._s.logease_jwt_ttl_seconds
        payload = {
            "iss": "urn:rizhiyi:mock-logease",
            "sub": issued.subject,
            "username": issued.username,
            "exp": now + ttl,
            "iat": now,
            "jti": f"logease-{uuid.uuid4()}",
            "logease_jwt": True,
            "scope": "api:read api:write",
        }
        jwt = pyjwt.encode(payload, self._s.logease_jwt_key, algorithm=self._s.logease_jwt_alg)

        refresh_payload = {**payload, "jti": f"logease-ref-{uuid.uuid4()}", "exp": now + ttl * 2, "kind": "refresh"}
        refresh_token = pyjwt.encode(refresh_payload, self._s.logease_jwt_key, algorithm=self._s.logease_jwt_alg)
        return {
            "access_token": jwt,
            "refresh_token": refresh_token,
            "token_type": "Bearer",
            "expires_in": ttl,
            "scope": payload["scope"],
            "username": issued.username,
        }

    # ------------------------------------------------------------------
    # introspect
    # ------------------------------------------------------------------
    def introspect(self, token: str) -> dict[str, Any]:
        active = self._store.is_active(token)
        if not active:
            return {"active": False}
        issued = self._store.get(token)
        assert issued is not None
        return {
            "active": True,
            "scope": issued.scope,
            "client_id": issued.client_id,
            "username": issued.username,
            "token_type": issued.issued_token_type,
            "exp": issued.expires_at,
            "iat": issued.issued_at,
            "nbf": issued.issued_at,
            "sub": issued.subject,
            "aud": issued.audience,
            "jti": issued.token_id,
            "iss": self._s.resolved_issuer(),
            "for_audience": issued.for_audience,
        }
