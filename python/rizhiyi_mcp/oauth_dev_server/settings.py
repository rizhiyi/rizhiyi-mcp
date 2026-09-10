from __future__ import annotations


from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class DevOAuthSettings(BaseSettings):
    """Mock OAuth 开发服务器配置。"""

    model_config = SettingsConfigDict(
        env_prefix="OAUTH_DEV_",
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 4444
    issuer: str = Field(default="")
    # 默认内建 client
    client_id: str = "rizhiyi-mcp-dev"
    client_secret: str = "dev-secret"
    # 默认用户名（password grant）
    default_username: str = "dev-user"
    default_scope: str = "openid profile email offline_access"
    # JWT 签名
    signing_key: str = "oauth-dev-signing-key-change-me"
    signing_alg: str = "HS256"
    # 日志易模拟登录签名（与上面分开，模拟不同系统）
    logease_jwt_key: str = "logease-dev-secret"
    logease_jwt_alg: str = "HS256"
    logease_jwt_ttl_seconds: int = 1800
    # 普通 access token ttl
    access_token_ttl_seconds: int = 3600
    refresh_token_ttl_seconds: int = 86400

    def resolved_issuer(self, base_url_origin: str | None = None) -> str:
        if self.issuer:
            return self.issuer.rstrip("/")
        origin = base_url_origin or f"http://{self.host}:{self.port}"
        return origin.rstrip("/")
