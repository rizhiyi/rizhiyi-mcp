"""Disable MCP servers in client configuration files."""

from __future__ import annotations

import json
import re
from pathlib import Path

import click

from mcp2cli.config.models import ConfigSource
from mcp2cli.utils.file_ops import atomic_write_json, atomic_write_text


def disable_server(
    server_name: str,
    config_path: Path,
    config_format: str,
) -> bool:
    """Set disabled=true for a server in a client config file.

    Missing client config files are treated as a no-op success so sync flows
    can safely skip clients that are not configured locally.

    Returns True if successful, False on failure.
    """
    if not config_path.exists():
        return True

    try:
        if config_format in ("claude_json", "cursor_json"):
            return _disable_json(server_name, config_path)
        elif config_format == "codex_toml":
            return _disable_toml(server_name, config_path)
        return False
    except Exception:
        return False


def _disable_json(server_name: str, config_path: Path) -> bool:
    text = config_path.read_text(encoding="utf-8")
    data = json.loads(text)

    servers = data.get("mcpServers", {})
    if server_name not in servers:
        return False

    if servers[server_name].get("disabled"):
        click.echo(f"  Already disabled in {config_path}")
        return True

    servers[server_name]["disabled"] = True

    atomic_write_json(config_path, data)
    return True


def _disable_toml(server_name: str, config_path: Path) -> bool:
    text = config_path.read_text(encoding="utf-8")

    m = re.search(
        rf'^\[mcp_servers\.{re.escape(server_name)}\]',
        text, re.MULTILINE,
    )
    if not m:
        return False

    rest = text[m.end():]
    next_section = re.search(r'^\[', rest, re.MULTILINE)
    section_body = rest[:next_section.start()] if next_section else rest

    if re.search(r'^\s*disabled\s*=', section_body, re.MULTILINE):
        return True  # already disabled

    insert_pos = m.end()
    text = text[:insert_pos] + "\ndisabled = true" + text[insert_pos:]
    atomic_write_text(config_path, text)
    return True


def disable_in_all_sources(
    server_name: str,
    sources: list[ConfigSource],
) -> bool:
    """Disable server in all config sources. Returns True if all succeed."""
    all_ok = True
    for src in sources:
        ok = disable_server(server_name, src.config_path, src.config_format)
        if ok:
            click.echo(f"  {src.config_path}: {server_name} disabled ✓")
        else:
            all_ok = False
    return all_ok
