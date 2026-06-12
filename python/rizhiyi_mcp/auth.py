from __future__ import annotations

import base64
import binascii

from .types import ApiKeyAuthorization, AuthContext, BasicAuthorization, ParsedAuthorization


def _mask_value(value: str) -> str:
    if len(value) <= 6:
        return f"{value[:2]}***"
    return f"{value[:4]}***{value[-2:]}"


def _parse_basic_authorization(raw_authorization: str, encoded_credentials: str) -> BasicAuthorization:
    try:
        decoded = base64.b64decode(encoded_credentials, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError("Basic Auth 编码无效。") from exc

    separator_index = decoded.find(":")
    if separator_index <= 0:
        raise ValueError("Basic Auth 缺少 user:password 结构。")

    username = decoded[:separator_index].strip()
    password = decoded[separator_index + 1 :]
    if not username or not password:
        raise ValueError("Basic Auth 需要同时包含用户名和密码。")

    return BasicAuthorization(
        kind="basic",
        raw_authorization=raw_authorization,
        username=username,
    )


def _parse_apikey_authorization(raw_authorization: str, api_key: str) -> ApiKeyAuthorization:
    normalized_api_key = api_key.strip()
    if not normalized_api_key:
        raise ValueError("apikey 认证缺少 key。")

    return ApiKeyAuthorization(
        kind="apikey",
        raw_authorization=raw_authorization,
        api_key_preview=_mask_value(normalized_api_key),
    )


def parse_authorization_header(authorization_header: str | None) -> ParsedAuthorization:
    raw_authorization = (authorization_header or "").strip()
    if not raw_authorization:
        raise ValueError("缺少 Authorization 请求头。")

    first_space_index = raw_authorization.find(" ")
    if first_space_index <= 0:
        raise ValueError("Authorization 格式无效。")

    scheme = raw_authorization[:first_space_index].strip().lower()
    credentials = raw_authorization[first_space_index + 1 :].strip()

    if scheme == "apikey":
        return _parse_apikey_authorization(raw_authorization, credentials)
    if scheme == "basic":
        return _parse_basic_authorization(raw_authorization, credentials)
    raise ValueError("仅支持 apikey 和 Basic 两种 Authorization 格式。")


def describe_authorization(auth: ParsedAuthorization) -> str:
    if auth.kind == "basic":
        return f"basic:{auth.username}"
    return f"apikey:{auth.api_key_preview}"


def build_auth_context_from_authorization(authorization_header: str | None) -> AuthContext:
    if not authorization_header:
        return AuthContext(authorization=None, headers={})

    authorization = parse_authorization_header(authorization_header)
    return AuthContext(
        authorization=authorization,
        headers={"Authorization": authorization.raw_authorization},
    )


def build_auth_context_from_env(
    *,
    logease_auth_header: str | None,
    logease_api_key: str | None,
) -> AuthContext:
    authorization_header = logease_auth_header or (
        f"apikey {logease_api_key}" if logease_api_key else None
    )
    return build_auth_context_from_authorization(authorization_header)
