"""独立 CLI 入口，供 pyproject [project.scripts] 调用（rizhiyi-mcp-oauth-dev）。"""

from __future__ import annotations

import argparse
import sys

import uvicorn

from .server import create_app
from .settings import DevOAuthSettings


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rizhiyi-mcp-oauth-dev",
        description="rizhiyi-mcp 本地开发用 Mock OAuth 2.0 认证中心",
    )
    parser.add_argument("--host", default=None, help="绑定地址（默认 OAUTH_DEV_HOST 或 127.0.0.1）")
    parser.add_argument("--port", type=int, default=None, help="监听端口（默认 OAUTH_DEV_PORT 或 4444）")
    parser.add_argument("--issuer", default=None, help="issuer，默认根据 host/port 推断")
    parser.add_argument("--client-id", default=None, help="默认 client_id（默认 rizhiyi-mcp-dev）")
    parser.add_argument("--client-secret", default=None, help="默认 client_secret（默认 dev-secret）")
    parser.add_argument("--default-username", default=None, help="默认用户名（password grant，默认 dev-user）")
    parser.add_argument("--reload", action="store_true", help="启用自动重载（开发调试）")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    settings_kwargs: dict[str, object] = {}
    if args.host:
        settings_kwargs["host"] = args.host
    if args.port:
        settings_kwargs["port"] = args.port
    if args.issuer:
        settings_kwargs["issuer"] = args.issuer
    if args.client_id:
        settings_kwargs["client_id"] = args.client_id
    if args.client_secret:
        settings_kwargs["client_secret"] = args.client_secret
    if args.default_username:
        settings_kwargs["default_username"] = args.default_username
    settings = DevOAuthSettings(**settings_kwargs)

    print(
        f"[rizhiyi-mcp-oauth-dev] starting mock OAuth server on "
        f"http://{settings.host}:{settings.port} ...",
        file=sys.stderr,
    )
    print(
        "[rizhiyi-mcp-oauth-dev]  issuer will be resolved from request host header or default.",
        file=sys.stderr,
    )
    app = create_app(settings)
    uvicorn.run(app, host=settings.host, port=settings.port, reload=args.reload, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
