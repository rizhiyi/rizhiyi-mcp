from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from .config import RuntimeConfig
from .gateway import create_http_app


def create_app() -> FastAPI:
    return create_http_app(RuntimeConfig())


def main() -> None:
    settings = RuntimeConfig()
    uvicorn.run(
        "rizhiyi_mcp.main:create_app",
        factory=True,
        host=settings.mcp_http_host,
        port=settings.mcp_http_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
