"""Scan local preset-ready servers."""

from __future__ import annotations

from mcp2cli.config.tool_store import load_tools
from mcp2cli.constants import TOOLS_DIR


def scan_local_presets() -> dict[str, str]:
    """Return {server_name: version} for all locally pushable presets.

    A server is considered a local preset if it has a tools/<server>.json file.
    The version is derived from tools_json.version or scanned_at date.
    """
    result: dict[str, str] = {}
    if not TOOLS_DIR.exists():
        return result

    for tools_file in sorted(TOOLS_DIR.glob("*.json")):
        server_name = tools_file.stem
        tools_json = load_tools(server_name)
        if tools_json is None:
            continue
        version = tools_json.version or "unknown"
        result[server_name] = version

    return result
