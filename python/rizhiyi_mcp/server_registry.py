from __future__ import annotations

from collections.abc import Callable

from .log_tools_server import create_log_tools_server
from .service_servers import (
    create_dashboard_server,
    create_fieldconfig_server,
    create_ingest_server,
    create_manage_server,
    create_openapi_server,
    create_parserrule_server,
)
from .config import RuntimeConfig
from .servers import RizhiyiFastMCPServer, ServiceRuntimeState

ServerFactory = Callable[[RuntimeConfig, ServiceRuntimeState], RizhiyiFastMCPServer]

_SERVER_FACTORIES: dict[str, ServerFactory] = {
    "log-tools": create_log_tools_server,
    "manage": create_manage_server,
    "dashboard": create_dashboard_server,
    "parserrule": create_parserrule_server,
    "fieldconfig": create_fieldconfig_server,
    "ingest": create_ingest_server,
    "openapi": create_openapi_server,
}

server_registry: dict[str, ServerFactory] = dict(_SERVER_FACTORIES)
