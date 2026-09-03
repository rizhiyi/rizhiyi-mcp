"""Re-enable MCP servers in client configs (undo convert's disable)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import click

from mcp2cli.config.models import ConfigSource
from mcp2cli.utils.file_ops import atomic_write_json, atomic_write_text


def re_enable_server(
    server_name: str,
    config_path: Path,
    config_format: str,
) -> bool:
    """Remove the 'disabled' field from a server entry in a client config.

    Returns True if successful or already enabled.
    """
    if not config_path.exists():
        return True

    try:
        if config_format in ("claude_json", "cursor_json"):
            return _re_enable_json(server_name, config_path)
        elif config_format == "codex_toml":
            return _re_enable_toml(server_name, config_path)
        return True
    except Exception:
        return False


def _re_enable_json(server_name: str, config_path: Path) -> bool:
    text = config_path.read_text(encoding="utf-8")
    data = json.loads(text)

    servers = data.get("mcpServers", {})
    if server_name not in servers:
        return True

    entry = servers[server_name]
    if "disabled" not in entry:
        return True

    del entry["disabled"]
    atomic_write_json(config_path, data)
    return True


def _re_enable_toml(server_name: str, config_path: Path) -> bool:
    text = config_path.read_text(encoding="utf-8")

    m = re.search(
        rf'^\[mcp_servers\.{re.escape(server_name)}\]',
        text, re.MULTILINE,
    )
    if not m:
        return True

    rest = text[m.end():]
    next_section = re.search(r'^\[', rest, re.MULTILINE)
    section_end = m.end() + next_section.start() if next_section else len(text)
    section_body = text[m.end():section_end]

    new_body = re.sub(r'\ndisabled\s*=\s*[^\n]*', '', section_body)
    if new_body == section_body:
        return True  # nothing to remove

    atomic_write_text(config_path, text[:m.end()] + new_body + text[section_end:])
    return True


def re_enable_in_clients(
    server_name: str,
    sources: list[ConfigSource],
) -> bool:
    """Re-enable server in all disabled config sources."""
    all_ok = True
    for src in sources:
        ok = re_enable_server(server_name, src.config_path, src.config_format)
        if ok:
            click.echo(f"  ✓ {src.config_path}: {server_name} re-enabled")
        else:
            all_ok = False
    return all_ok
