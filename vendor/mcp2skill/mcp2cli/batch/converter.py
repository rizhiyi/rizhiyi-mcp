"""Batch convert pipeline: scan, generate, and export multiple MCP servers."""

from __future__ import annotations

import json
from pathlib import Path

import click

from mcp2cli.batch.models import BatchEntry, BatchResult
from mcp2cli.utils import safe_filename


def _has_existing_preset(output_dir: str, server_name: str) -> bool:
    """Check if a preset already exists in the output directory."""
    root = Path(output_dir) / safe_filename(server_name)
    if not root.exists():
        return False
    return any(root.glob("*/manifest.json"))


def _convert_one(entry: BatchEntry, output_dir: str) -> BatchResult:
    """Run the full convert pipeline for a single server.

    Steps: scan → generate-cli → generate-skill → export
    """
    from mcp2cli.generator.cli_gen import generate_cli
    from mcp2cli.generator.skill_gen import generate_skill
    from mcp2cli.preset.exporter import export_preset
    from mcp2cli.scanner import scan_ephemeral

    name = entry.name

    # Step 1: Ephemeral scan
    click.echo(f"\n{'='*60}")
    click.echo(f"[scan] {name}")
    click.echo(f"{'='*60}")

    config = entry.to_server_config()
    server_meta: dict = {"command": config.command, "args": config.args}
    env_meta = entry.env_meta()
    if env_meta:
        server_meta["env"] = env_meta
    tools_json = scan_ephemeral(config, server_meta=server_meta)
    if tools_json is None:
        return BatchResult(name=name, status="failed", error="scan failed")

    # Step 2: Generate CLI YAML
    click.echo(f"\n[generate-cli] {name}")
    if not generate_cli(name):
        return BatchResult(
            name=name, status="failed", error="generate-cli failed",
            tool_count=len(tools_json.tools),
        )

    # Step 3: Generate Skill files
    click.echo(f"\n[generate-skill] {name}")
    if not generate_skill(name):
        return BatchResult(
            name=name, status="failed", error="generate-skill failed",
            tool_count=len(tools_json.tools),
        )

    # Step 4: Export preset
    click.echo(f"\n[export] {name}")
    if not export_preset(name, output_dir=output_dir, yes=True):
        return BatchResult(
            name=name, status="failed", error="export failed",
            tool_count=len(tools_json.tools),
        )

    return BatchResult(
        name=name,
        status="success",
        tool_count=len(tools_json.tools),
        version=tools_json.version,
    )


def batch_convert(
    entries: list[BatchEntry],
    output_dir: str,
    skip_existing: bool = True,
    concurrency: int = 1,
) -> list[BatchResult]:
    """Convert multiple MCP servers to presets.

    Args:
        entries: List of servers to convert.
        output_dir: Directory to export presets to (e.g. ``./presets``).
        skip_existing: Skip servers that already have a preset in output_dir.
        concurrency: Number of parallel conversions (currently sequential only).

    Returns:
        List of BatchResult with per-server outcomes.
    """
    results: list[BatchResult] = []
    total = len(entries)

    for i, entry in enumerate(entries, 1):
        click.echo(f"\n{'#'*60}")
        click.echo(f"# [{i}/{total}] {entry.name}")
        click.echo(f"#   package: {entry.package}")
        click.echo(f"#   command: {entry.command} {' '.join(entry.args)}")
        click.echo(f"{'#'*60}")

        # Skip check
        if skip_existing and _has_existing_preset(output_dir, entry.name):
            click.echo(f"  Skipping: preset already exists")
            results.append(BatchResult(name=entry.name, status="skipped"))
            continue

        try:
            result = _convert_one(entry, output_dir)
        except Exception as e:
            click.echo(f"  Unexpected error: {e}", err=True)
            result = BatchResult(
                name=entry.name, status="failed", error=str(e),
            )

        results.append(result)

    # Rebuild index.json once at the end
    from mcp2cli.preset.exporter import rebuild_index

    click.echo(f"\nRebuilding index.json...")
    rebuild_index(output_dir)

    # Print summary
    _print_summary(results)

    # Write failed.json for retry
    _write_failed(entries, results, output_dir)

    return results


def _print_summary(results: list[BatchResult]) -> None:
    """Print a summary report of the batch conversion."""
    success = [r for r in results if r.status == "success"]
    failed = [r for r in results if r.status == "failed"]
    skipped = [r for r in results if r.status == "skipped"]

    click.echo(f"\n{'='*60}")
    click.echo(f"Batch convert complete:")
    click.echo(f"  {len(success)} servers converted successfully")
    click.echo(f"  {len(failed)} servers failed")
    click.echo(f"  {len(skipped)} servers skipped (already exist)")

    if failed:
        click.echo(f"\nFailed servers:")
        for r in failed:
            click.echo(f"  - {r.name}: {r.error}")

    total_tools = sum(r.tool_count for r in success)
    if success:
        click.echo(f"\nTotal tools converted: {total_tools}")


def _write_failed(
    entries: list[BatchEntry],
    results: list[BatchResult],
    output_dir: str,
) -> None:
    """Write failed entries to failed.json for easy retry."""
    failed_names = {r.name for r in results if r.status == "failed"}
    if not failed_names:
        return

    failed_entries = [e for e in entries if e.name in failed_names]
    failed_path = Path(output_dir) / "failed.json"
    failed_path.write_text(
        json.dumps([e.to_dict() for e in failed_entries], indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    click.echo(f"\nFailed entries written to {failed_path}")
    click.echo(f"Retry with: mcp2cli batch convert --input {failed_path} -o {output_dir}")
