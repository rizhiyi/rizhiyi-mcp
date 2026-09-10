"""Mock OAuth 2.0 / OIDC 认证中心（开发环境专用）。

提供以下端点：
- GET  /.well-known/oauth-authorization-server
- GET  /.well-known/openid-configuration        (别名)
- GET  /authorize                                (浏览器调试用，自动批准)
- POST /token                                    (password / client_credentials / token-exchange)
- POST /introspect
- POST /userinfo
- POST /mock/logease-login                       (假装是日志易 login，返回 JWT)

仅用于本地开发与联调，严禁用于生产。
"""

from .server import create_app
from .settings import DevOAuthSettings

__all__ = ["create_app", "DevOAuthSettings"]
