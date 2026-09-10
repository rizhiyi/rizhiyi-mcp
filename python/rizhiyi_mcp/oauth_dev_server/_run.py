"""内部入口，仅被 __main__ 用 uvicorn factory 模式调用。

因为 uvicorn factory 需要拿到同一个 settings 实例（由命令行参数初始化），
而 __main__ 进程和 uvicorn 子进程不共享内存。这里采用简化做法：
直接用全局 settings 读环境变量（与命令行在 env 层注入等效）。
生产联调时命令行参数与环境变量总是会被显式设置，无需过度设计。
"""

from __future__ import annotations

from fastapi import FastAPI

from .server import create_app
from .settings import DevOAuthSettings


def _app_factory() -> FastAPI:
    return create_app(DevOAuthSettings())
