"""Download preset files from remote repository."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

import click

from mcp2cli.constants import CLI_DIR, DATA_DIR, TOOLS_DIR
from mcp2cli.preset.models import Manifest
from mcp2cli.preset.registry import _raw_base, find_preset
from mcp2cli.utils import safe_filename, skills_path
from mcp2cli.utils.file_ops import ensure_users_dir

FILE_TIMEOUT = 10


def pull_preset(
    server_name: str,
    version: str | None = None,
    force: bool = False,
    dry_run: bool = False,
) -> bool:
    """Download all preset files for a server.

    Args:
        server_name: MCP server name.
        version: Specific version to pull, or None for latest.
        force: Overwrite existing files without prompting.
        dry_run: Preview what would be downloaded without writing files.

    Returns True on success.
    """
    raw_base = _raw_base()
    safe_name = safe_filename(server_name)

    # Resolve version from index
    entry = find_preset(server_name)
    if entry is None:
        click.echo(f"Error: no preset found for '{server_name}'.", err=True)
        return False

    try:
        resolved_version = entry.resolve_version(version)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        return False

    if dry_run:
        click.echo(f"[DRY RUN] Would download preset for {server_name}:")
        click.echo(f"  Version: {resolved_version}")
        click.echo(f"  Available versions: {', '.join(entry.versions)}")
        return True

    # Fetch manifest
    manifest_url = f"{raw_base}/{safe_name}/{resolved_version}/manifest.json"
    manifest_data = _download_json(manifest_url)
    if manifest_data is None:
        click.echo(f"Error: could not download manifest for {server_name}@{resolved_version}.", err=True)
        return False

    manifest = Manifest.from_dict(manifest_data)
    base_url = f"{raw_base}/{safe_name}/{resolved_version}"

    click.echo(f"Downloading preset for {server_name}...")
    click.echo(
        f"  Preset: v{resolved_version}, "
        f"{manifest.tool_count} tools, "
        f"generated {manifest.generated_at[:10]}"
    )

    # Check existing files
    if not force:
        existing = _check_existing(server_name, manifest.files)
        if existing:
            click.echo(f"\n  Local files already exist for {server_name}:")
            for f in existing[:5]:
                click.echo(f"    {f}")
            if not click.confirm("  Overwrite with preset?", default=True):
                return False

    # Download each file
    downloaded: list[Path] = []
    for rel_path in manifest.files:
        url = f"{base_url}/{rel_path}"
        try:
            target = _map_target_path(server_name, rel_path)
        except ValueError as e:
            click.echo(f"  Error: {e}", err=True)
            for p in downloaded:
                p.unlink(missing_ok=True)
            return False
        target.parent.mkdir(parents=True, exist_ok=True)

        ok = download_file(url, target)
        if not ok:
            click.echo(f"  Error: failed to download {rel_path}", err=True)
            for p in downloaded:
                p.unlink(missing_ok=True)
            return False

        downloaded.append(target)
        click.echo(f"  ✓ {rel_path}")

    ensure_users_dir(skills_path(server_name))

    click.echo(f"Done! Files written to {DATA_DIR}/")
    return True


def download_file(url: str, target_path: Path) -> bool:
    """Download a single file to target path (atomic write)."""
    try:
        with urlopen(url, timeout=FILE_TIMEOUT) as resp:
            if resp.status != 200:
                return False
            content = resp.read()
    except (URLError, OSError):
        return False

    target_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target_path.parent, suffix=".tmp")
    try:
        with open(fd, "wb") as f:
            f.write(content)
        Path(tmp).replace(target_path)
        return True
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        return False


def _download_json(url: str) -> dict | None:
    try:
        with urlopen(url, timeout=FILE_TIMEOUT) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, OSError, json.JSONDecodeError):
        return None


def _map_target_path(server_name: str, rel_path: str) -> Path:
    """Map a manifest relative path to the local target path.

    Raises ValueError if the resolved path escapes DATA_DIR (path traversal).
    """
    if rel_path == "tools.json":
        target = TOOLS_DIR / f"{safe_filename(server_name)}.json"
    elif rel_path == "cli.yaml":
        target = CLI_DIR / f"{safe_filename(server_name)}.yaml"
    elif rel_path.startswith("skills/"):
        target = skills_path(server_name) / rel_path[len("skills/"):]
    else:
        target = DATA_DIR / server_name / rel_path

    resolved = target.resolve()
    if not resolved.is_relative_to(DATA_DIR.resolve()):
        raise ValueError(f"Path traversal detected in preset manifest: {rel_path}")
    return target


def install_from_local_dir(
    server_name: str,
    version_dir: Path,
    force: bool = False,
) -> bool:
    """Install preset files from a local version directory.

    version_dir must contain manifest.json, tools.json, cli.yaml, and skills/.

    Returns True on success.
    """
    manifest_path = version_dir / "manifest.json"
    if not manifest_path.exists():
        click.echo(f"Error: no manifest.json found in {version_dir}", err=True)
        return False

    try:
        manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest = Manifest.from_dict(manifest_data)
    except Exception as e:
        click.echo(f"Error: could not read manifest.json: {e}", err=True)
        return False

    click.echo(f"Installing from local preset: {version_dir}")
    click.echo(
        f"  {manifest.tool_count} tools, "
        f"generated {manifest.generated_at[:10]}"
    )

    if not force:
        existing = _check_existing(server_name, manifest.files)
        if existing:
            click.echo(f"\n  Local files already exist for {server_name}:")
            for f in existing[:5]:
                click.echo(f"    {f}")
            if not click.confirm("  Overwrite with local preset?", default=True):
                return False

    for rel_path in manifest.files:
        src = version_dir / rel_path
        if not src.exists():
            click.echo(f"  Error: missing file {rel_path} in {version_dir}", err=True)
            return False

        try:
            target = _map_target_path(server_name, rel_path)
        except ValueError as e:
            click.echo(f"  Error: {e}", err=True)
            return False

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        click.echo(f"  ✓ {rel_path}")

    ensure_users_dir(skills_path(server_name))
    click.echo(f"Done! Files written to {DATA_DIR}/")
    return True


def _check_existing(server_name: str, files: list[str]) -> list[Path]:
    """Check which preset files already exist locally."""
    existing: list[Path] = []
    for rel_path in files:
        target = _map_target_path(server_name, rel_path)
        if target.exists():
            existing.append(target)
    return existing
