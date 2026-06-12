from __future__ import annotations

from pathlib import Path
from tempfile import gettempdir

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .types import AuthContext, HttpClientConfig, RequestMeta, RequestSource, ServerContext

_DEFAULT_STORE_DIR = Path(gettempdir()) / "rizhiyi-mcp" / "log-tool-results"


class RuntimeConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    logease_base_url: str = "http://127.0.0.1:8090"
    logease_tls_reject_unauthorized: bool = False
    mcp_http_host: str = "0.0.0.0"
    mcp_http_port: int = 3000
    mcp_http_base_path: str = "/mcp"
    log_tools_result_store_dir: Path = Field(default_factory=lambda: _DEFAULT_STORE_DIR)
    log_tools_result_ttl_seconds: int = 1800
    log_tools_result_inline_max_bytes: int = 24 * 1024
    log_tools_result_max_file_bytes: int = 5 * 1024 * 1024
    upstream_timeout_seconds: float = 30.0

    @field_validator("mcp_http_base_path", mode="before")
    @classmethod
    def normalize_base_path(cls, value: str | None) -> str:
        path_value = (value or "/mcp").strip()
        if not path_value or path_value == "/":
            return "/mcp"
        normalized = path_value if path_value.startswith("/") else f"/{path_value}"
        return normalized.rstrip("/") or "/mcp"

    @field_validator(
        "mcp_http_port",
        "log_tools_result_ttl_seconds",
        "log_tools_result_inline_max_bytes",
        "log_tools_result_max_file_bytes",
        mode="after",
    )
    @classmethod
    def validate_positive_int(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("必须是正整数")
        return value

    @field_validator("upstream_timeout_seconds", mode="after")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("超时时间必须大于 0")
        return value

    def create_http_client_config(self, auth_context: AuthContext) -> HttpClientConfig:
        return HttpClientConfig(
            base_url=self.logease_base_url,
            headers=auth_context.headers,
            verify_tls=self.logease_tls_reject_unauthorized,
            timeout_seconds=self.upstream_timeout_seconds,
        )


def create_server_context(
    runtime_config: RuntimeConfig,
    auth_context: AuthContext,
    *,
    source: RequestSource,
    path: str | None = None,
    client_address: str | None = None,
) -> ServerContext:
    return ServerContext(
        runtime_config=runtime_config,
        auth_context=auth_context,
        request_meta=RequestMeta(
            source=source,
            path=path,
            client_address=client_address,
        ),
    )
