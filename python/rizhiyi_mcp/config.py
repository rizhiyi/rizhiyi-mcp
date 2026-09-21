from __future__ import annotations

from pathlib import Path
import re
from tempfile import gettempdir
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .types import AuthContext, HttpClientConfig, RequestMeta, RequestSource, ServerContext

_DEFAULT_STORE_DIR = Path(gettempdir()) / "rizhiyi-mcp" / "log-tool-results"
_DEFAULT_GUARDRAIL_DENY_COMMANDS = [
    "collect",
    "delete",
    "mcollect",
    "fit",
    "outputlookup",
    "download",
    "save",
    "dbxoutput",
    "lookup2",
    "fromes",
    "fromkafkapy",
    "rest",
    "dbxlookup",
    "dbxquery",
    "dbxexec",
    "ldapsearch",
    "ldapfilter",
    "ldapgroup",
    "ldapfetch",
    "history",
]


class RuntimeConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    logease_base_url: str = "https://127.0.0.1:8090"
    logease_username: str | None = None
    logease_tls_reject_unauthorized: bool = False
    mcp_http_host: str = "0.0.0.0"
    mcp_http_port: int = 3000
    mcp_http_base_path: str = "/mcp"
    # DNS rebinding protection（MCP SDK TransportSecuritySettings）。
    # SDK 自身默认关闭；这里也默认关闭，因为 MCP 网关已有 Authorization 鉴权，
    # 且 allowed_hosts 不支持 "*" 全通配，开了容易误伤外部访问。
    # 生产环境若需开启，设 MCP_ENABLE_DNS_REBINDING_PROTECTION=true，
    # 并同时配置 MCP_ALLOWED_HOSTS（如 ["*"] 或具体 host:port 列表）。
    mcp_enable_dns_rebinding_protection: bool = False
    mcp_allowed_hosts: list[str] = ["*"]
    mcp_allowed_origins: list[str] = ["*"]
    mcp_rate_limit_global_per_minute: int | None = None
    mcp_rate_limit_per_tool: dict[str, int] = Field(default_factory=dict)
    rizhiyi_log_dir: Path = Path("./logs")
    rizhiyi_log_name_prefix: str = "mcp-server"
    rizhiyi_log_rotate_bytes: int = 10 * 1024 * 1024
    rizhiyi_log_rotate_interval: Literal["1d", "1h"] = "1d"
    rizhiyi_log_keep_files: int = 7
    log_tools_result_store_dir: Path = Field(default_factory=lambda: _DEFAULT_STORE_DIR)
    log_tools_result_ttl_seconds: int = 1800
    log_tools_result_inline_max_bytes: int = 24 * 1024
    log_tools_result_max_file_bytes: int = 5 * 1024 * 1024
    upstream_timeout_seconds: float = 30.0
    mcp_guardrails_enabled: bool = False
    mcp_guardrail_enforce_mode: Literal["audit", "enforce"] = "audit"
    mcp_guardrail_deny_commands: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_GUARDRAIL_DENY_COMMANDS)
    )
    mcp_guardrail_risk_alert_threshold: int = 50
    mcp_guardrail_risk_reject_threshold: int = 100
    mcp_guardrail_risk_rule_overrides: dict[str, int] = Field(default_factory=dict)
    mcp_guardrail_safe_timerange: str = "24h"
    mcp_guardrail_exec_timeout_seconds: int = 60
    mcp_guardrail_max_events: int = 1000
    mcp_guardrail_sanitize_enabled: bool = True
    mcp_guardrail_sanitize_masks: list[str] = Field(
        default_factory=lambda: ["credit_card", "ssn"]
    )
    mcp_guardrail_sanitize_custom_patterns: list[dict[str, str]] = Field(default_factory=list)

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
        "rizhiyi_log_keep_files",
        "mcp_guardrail_exec_timeout_seconds",
        "mcp_guardrail_max_events",
        mode="after",
    )
    @classmethod
    def validate_positive_int(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("必须是正整数")
        return value

    @field_validator("mcp_rate_limit_global_per_minute", mode="after")
    @classmethod
    def validate_optional_positive_int(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("必须是正整数或留空")
        return value

    @field_validator("mcp_rate_limit_per_tool", mode="after")
    @classmethod
    def validate_per_tool_limits(cls, value: dict[str, int]) -> dict[str, int]:
        normalized: dict[str, int] = {}
        for raw_key, raw_limit in value.items():
            key = raw_key.strip()
            if not key:
                raise ValueError("工具限流键不能为空")
            if isinstance(raw_limit, bool) or raw_limit <= 0:
                raise ValueError(f"{key} 的限流值必须是正整数")
            normalized[key] = raw_limit
        return normalized

    @field_validator("rizhiyi_log_name_prefix", mode="after")
    @classmethod
    def validate_log_name_prefix(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or "/" in normalized or "\\" in normalized:
            raise ValueError("必须是非空文件名前缀，且不能包含路径分隔符")
        return normalized

    @field_validator("upstream_timeout_seconds", mode="after")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("超时时间必须大于 0")
        return value

    @field_validator(
        "mcp_guardrail_risk_alert_threshold",
        "mcp_guardrail_risk_reject_threshold",
        mode="after",
    )
    @classmethod
    def validate_risk_threshold(cls, value: int) -> int:
        if value < 0 or value > 100:
            raise ValueError("风险阈值必须在 0 到 100 之间")
        return value

    @field_validator("mcp_guardrail_deny_commands", mode="after")
    @classmethod
    def normalize_guardrail_commands(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip().lower() for item in value if item.strip()))

    @field_validator("mcp_guardrail_risk_rule_overrides", mode="after")
    @classmethod
    def validate_risk_rule_overrides(cls, value: dict[str, int]) -> dict[str, int]:
        normalized: dict[str, int] = {}
        for raw_name, raw_score in value.items():
            name = raw_name.strip().lower()
            if not name:
                raise ValueError("风险规则名称不能为空")
            if isinstance(raw_score, bool) or raw_score < 0:
                raise ValueError(f"{name} 的风险分值必须是非负整数")
            normalized[name] = raw_score
        return normalized

    @field_validator("mcp_guardrail_safe_timerange", mode="after")
    @classmethod
    def validate_safe_timerange(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("安全时间窗不能为空")
        return normalized

    @field_validator("mcp_guardrail_sanitize_masks", mode="after")
    @classmethod
    def normalize_sanitize_masks(cls, value: list[str]) -> list[str]:
        supported = {"credit_card", "ssn"}
        normalized = list(dict.fromkeys(item.strip().lower() for item in value if item.strip()))
        unknown = [item for item in normalized if item not in supported]
        if unknown:
            raise ValueError(f"不支持的脱敏器: {', '.join(unknown)}")
        return normalized

    @field_validator("mcp_guardrail_sanitize_custom_patterns", mode="after")
    @classmethod
    def validate_custom_sanitize_patterns(
        cls,
        value: list[dict[str, str]],
    ) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        for index, item in enumerate(value):
            pattern = str(item.get("pattern") or "")
            replacement = str(item.get("replacement") or "")
            if not pattern:
                raise ValueError(f"第 {index + 1} 个自定义脱敏规则缺少 pattern")
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"第 {index + 1} 个自定义脱敏正则无效: {exc}") from exc
            normalized.append({"pattern": pattern, "replacement": replacement})
        return normalized

    def create_http_client_config(self, auth_context: AuthContext) -> HttpClientConfig:
        return HttpClientConfig(
            base_url=self.logease_base_url,
            headers=auth_context.headers,
            verify_tls=self.logease_tls_reject_unauthorized,
            timeout_seconds=self.upstream_timeout_seconds,
            username=auth_context.username,
        )


def create_server_context(
    runtime_config: RuntimeConfig,
    auth_context: AuthContext,
    *,
    source: RequestSource,
    path: str | None = None,
    client_address: str | None = None,
    route_name: str | None = None,
    server_name: str | None = None,
    session_id: str | None = None,
) -> ServerContext:
    return ServerContext(
        runtime_config=runtime_config,
        auth_context=auth_context,
        request_meta=RequestMeta(
            source=source,
            path=path,
            client_address=client_address,
            route_name=route_name,
            server_name=server_name,
            session_id=session_id,
        ),
    )
