from __future__ import annotations

from typing import Any

import httpx

from .types import ApiResponse, HttpClientConfig


class LogEaseHttpClient:
    def __init__(self, config: HttpClientConfig) -> None:
        self._config = config
        self._client = httpx.AsyncClient(
            base_url=config.base_url,
            headers=config.headers,
            verify=config.verify_tls,
            timeout=config.timeout_seconds,
        )

    async def __aenter__(self) -> "LogEaseHttpClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> ApiResponse[Any]:
        return await self._request("GET", path, params=params, headers=headers)

    async def post(
        self,
        path: str,
        *,
        data: Any = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> ApiResponse[Any]:
        return await self._request("POST", path, json=data, params=params, headers=headers)

    async def put(
        self,
        path: str,
        *,
        data: Any = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> ApiResponse[Any]:
        return await self._request("PUT", path, json=data, params=params, headers=headers)

    async def delete(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> ApiResponse[Any]:
        return await self._request("DELETE", path, params=params, headers=headers)

    async def _request(self, method: str, path: str, **kwargs: Any) -> ApiResponse[Any]:
        try:
            kwargs["headers"] = self._merge_default_headers(
                method=method,
                headers=kwargs.get("headers"),
                has_json_body="json" in kwargs,
            )
            response = await self._client.request(method, path, **kwargs)
            if response.status_code >= 400:
                details = _decode_response_body(response)
                return ApiResponse(
                    status=response.status_code,
                    error=str(details) if isinstance(details, str) else response.reason_phrase,
                    error_code="UPSTREAM_HTTP_ERROR",
                    suggestion="请检查上游服务地址、认证信息和请求参数。",
                    retryable=response.status_code >= 500,
                    details=details,
                    message=f"请求失败: HTTP {response.status_code}",
                )

            return ApiResponse(
                status=response.status_code,
                data=_decode_response_body(response),
                message="请求成功",
            )
        except httpx.ConnectError as exc:
            detail = str(exc)
            if "Connection refused" in detail:
                return ApiResponse(
                    status=502,
                    error=detail,
                    error_code="UPSTREAM_CONNECTION_REFUSED",
                    suggestion="目标地址拒绝连接。请确认日志易服务是否已启动，以及端口是否正确开放。",
                    retryable=True,
                    message=f"请求失败: {detail}",
                )
            return ApiResponse(
                status=502,
                error=detail,
                error_code="UPSTREAM_CONNECTION_FAILED",
                suggestion="请确认 LOGEASE_BASE_URL 的协议、地址和端口是否正确。",
                retryable=True,
                message=f"请求失败: {detail}",
            )
        except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
            detail = str(exc)
            return ApiResponse(
                status=502,
                error=detail,
                error_code="UPSTREAM_CONNECTION_RESET",
                suggestion="与上游服务的连接被直接断开。请优先检查地址、端口和协议是否匹配。",
                retryable=True,
                message=f"请求失败: {detail}",
            )
        except httpx.TimeoutException as exc:
            detail = str(exc) or "timeout"
            return ApiResponse(
                status=504,
                error=detail,
                error_code="UPSTREAM_TIMEOUT",
                suggestion="请求上游超时。请先缩小 time_range 或 limit；如果最小请求也超时，请检查网络或服务负载。",
                retryable=True,
                message=f"请求失败: {detail}",
            )
        except httpx.HTTPError as exc:
            detail = str(exc)
            return ApiResponse(
                status=500,
                error=detail,
                error_code="UPSTREAM_REQUEST_FAILED",
                suggestion="请检查上游服务地址、认证信息和请求参数；如问题持续，请先用最小请求验证连通性。",
                retryable=True,
                message=f"请求失败: {detail}",
            )

    def _merge_default_headers(
        self,
        *,
        method: str,
        headers: dict[str, str] | None,
        has_json_body: bool,
    ) -> dict[str, str]:
        merged_headers = dict(headers or {})
        if not _has_header(merged_headers, "Accept"):
            merged_headers["Accept"] = "application/json"
        if method.upper() in {"POST", "PUT", "PATCH"} and has_json_body and not _has_header(merged_headers, "Content-Type"):
            merged_headers["Content-Type"] = "application/json;charset=UTF-8"
        return merged_headers


def _decode_response_body(response: httpx.Response) -> Any:
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()
    return response.text


def _has_header(headers: dict[str, str], name: str) -> bool:
    target = name.lower()
    return any(key.lower() == target for key in headers)
