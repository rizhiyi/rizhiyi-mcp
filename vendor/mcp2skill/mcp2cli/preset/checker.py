"""Pipeline integration entry point for preset checking."""

from __future__ import annotations

from dataclasses import dataclass

import click

from mcp2cli.preset.downloader import pull_preset
from mcp2cli.preset.models import PresetEntry, PresetIndex
from mcp2cli.preset.registry import _is_auto_check_enabled, fetch_index


@dataclass
class PresetProbeResult:
    """Result of probing remote preset index for a server."""

    entry: PresetEntry | None
    resolved_name: str  # canonical server name (after alias resolution)
    alias_used: str | None = None  # original alias if resolved through alias


def probe_preset(
    server_name: str,
    version: str | None = None,
    no_preset: bool = False,
) -> PresetEntry | None:
    """Probe for an available preset without pulling it.

    Returns the PresetEntry if found and valid, None otherwise.
    """
    if no_preset:
        return None

    if not _is_auto_check_enabled():
        return None

    index = fetch_index()
    if index is None:
        return None

    entry = index.find(server_name)
    if entry is None:
        return None

    if version is not None and version not in entry.versions:
        return None

    return entry


def probe_preset_with_alias(
    server_name: str,
    version: str | None = None,
    no_preset: bool = False,
) -> PresetProbeResult:
    """Probe for a preset with alias resolution.

    Returns PresetProbeResult with entry, resolved name, and alias info.
    """
    if no_preset or not _is_auto_check_enabled():
        return PresetProbeResult(entry=None, resolved_name=server_name)

    index = fetch_index()
    if index is None:
        return PresetProbeResult(entry=None, resolved_name=server_name)

    resolved = index.resolve_name(server_name)
    alias_used = server_name if resolved != server_name.replace("/", "-") else None

    entry = index.find(server_name)
    if entry is None:
        return PresetProbeResult(entry=None, resolved_name=resolved)

    if version is not None and version not in entry.versions:
        return PresetProbeResult(entry=None, resolved_name=resolved)

    return PresetProbeResult(entry=entry, resolved_name=resolved, alias_used=alias_used)


def fetch_server_meta_from_preset(
    server_name: str,
    version: str | None = None,
) -> dict | None:
    """Download preset tools.json and extract server_meta.

    Returns the server_meta dict if found, None otherwise.
    """
    from mcp2cli.preset.downloader import _download_json
    from mcp2cli.preset.registry import _raw_base
    from mcp2cli.utils import safe_filename

    raw_base = _raw_base()
    safe_name = safe_filename(server_name)

    # First get manifest to know the resolved version
    entry = probe_preset(server_name, version=version)
    if entry is None:
        return None

    try:
        resolved_version = entry.resolve_version(version)
    except ValueError:
        return None

    # Download tools.json directly
    tools_url = f"{raw_base}/{safe_name}/{resolved_version}/tools.json"
    tools_data = _download_json(tools_url)
    if tools_data is None:
        return None

    return tools_data.get("server_meta")


def check_and_pull_preset(
    server_name: str,
    version: str | None = None,
    no_preset: bool = False,
    force: bool = False,
) -> bool:
    """Pull a preset (no confirmation — caller is responsible for confirming).

    Used as a pipeline step in install/convert flows.

    Returns:
        True if preset was successfully pulled (downstream steps can be skipped).
        False if no preset used (continue normal flow).
    """
    entry = probe_preset(server_name, version=version, no_preset=no_preset)
    if entry is None:
        return False

    click.echo("Pulling preset...")
    ok = pull_preset(server_name, version=version, force=force)

    if ok:
        click.echo("  Skipping: scan, generate cli, generate skill (using preset)")
    else:
        click.echo("  Preset download failed. Proceeding with AI generation.")

    return ok
