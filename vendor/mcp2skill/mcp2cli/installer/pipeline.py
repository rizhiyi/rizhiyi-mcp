"""Step pipeline runner and builder for install/convert flows."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import click

from mcp2cli.config.models import ServerConfig


@dataclass
class Step:
    """A single step in the install/convert pipeline."""

    name: str
    run: Callable[[], bool]
    retry_cmd: str
    depends_on: list[str] = field(default_factory=list)
    skip_if: list[str] = field(default_factory=list)
    fatal: bool = True  # Non-fatal steps don't affect overall success
    silent_fail: bool = False  # If True, suppress failure message on error


@dataclass
class PipelineResult:
    """Result of a pipeline run."""

    results: dict[str, bool]
    fatal_steps: set[str]

    @property
    def all_ok(self) -> bool:
        """True if all fatal steps succeeded."""
        return all(
            ok for name, ok in self.results.items() if name in self.fatal_steps
        )

    @property
    def failed_fatal(self) -> list[str]:
        """Names of fatal steps that failed."""
        return [
            name for name, ok in self.results.items()
            if not ok and name in self.fatal_steps
        ]


def run_pipeline(pipeline: list[Step]) -> PipelineResult:
    """Execute a pipeline of steps with dependency/skip logic.

    Returns a PipelineResult with per-step outcomes and overall status.
    """
    results: dict[str, bool] = {}
    fatal_steps = {step.name for step in pipeline if step.fatal}

    for step in pipeline:
        # Dependency check: skip if any dependency failed
        if any(not results.get(dep) for dep in step.depends_on):
            failed_deps = [d for d in step.depends_on if not results.get(d)]
            click.echo(f"  Skipping {step.name}: dependency failed ({', '.join(failed_deps)})")
            results[step.name] = False
            continue

        # Conditional skip: if any skip_if step succeeded, skip this one
        if any(results.get(s) for s in step.skip_if):
            click.echo(f"  Skipping {step.name}: preset used")
            results[step.name] = True  # Mark as success so dependents can proceed
            continue

        try:
            ok = step.run()
        except Exception as e:
            click.echo(f"  {step.name} error: {e}", err=True)
            ok = False

        results[step.name] = ok

        if not ok:
            if not step.silent_fail:
                click.echo(f"  ⚠ {step.name} failed. Retry later: {step.retry_cmd}")

    return PipelineResult(results=results, fatal_steps=fatal_steps)


# ---------------------------------------------------------------------------
# Unified pipeline builder (used by both install and convert commands)
# ---------------------------------------------------------------------------

def build_pipeline(
    server_name: str,
    config: ServerConfig,
    *,
    write_step_name: str = "write-config",
    force_write: bool = False,
    skip_disable: bool = False,
    no_preset: bool = False,
    preset_version: str | None = None,
    server_meta: dict | None = None,
) -> list[Step]:
    """Build the install/convert pipeline.

    Args:
        server_name: MCP server name.
        config: Server configuration to write.
        write_step_name: Name for the first (write-config) step.
        force_write: Pass ``force=True`` to ``write_server``.
        skip_disable: Skip disabling the MCP config during skill sync.
        no_preset: Skip the preset-check step.
        preset_version: Specific preset version to pull.
        server_meta: Server metadata dict to embed in tools.json during scan.
    """
    from mcp2cli.generator.cli_gen import generate_cli
    from mcp2cli.generator.skill_gen import generate_skill
    from mcp2cli.installer.servers_writer import write_server
    from mcp2cli.installer.skill_sync import skill_sync
    from mcp2cli.preset.checker import check_and_pull_preset
    from mcp2cli.scanner import scan_server

    return [
        Step(
            name=write_step_name,
            run=lambda: write_server(config, force=force_write),
            retry_cmd=f"mcp2cli mcp add {server_name}",
        ),
        Step(
            name="preset-check",
            run=lambda: check_and_pull_preset(
                server_name, version=preset_version, no_preset=no_preset,
            ),
            retry_cmd=f"mcp2cli preset pull {server_name}",
            depends_on=[write_step_name],
            fatal=False,
            silent_fail=True,
        ),
        Step(
            name="scan",
            run=lambda: scan_server(server_name, server_meta=server_meta) is not None,
            retry_cmd=f"mcp2cli scan {server_name}",
            depends_on=[write_step_name],
            skip_if=["preset-check"],
        ),
        Step(
            name="generate-cli",
            run=lambda: generate_cli(server_name),
            retry_cmd=f"mcp2cli generate cli {server_name}",
            depends_on=["scan"],
            skip_if=["preset-check"],
        ),
        Step(
            name="generate-skill",
            run=lambda: generate_skill(server_name),
            retry_cmd=f"mcp2cli generate skill {server_name}",
            depends_on=["generate-cli"],
            skip_if=["preset-check"],
        ),
        Step(
            name="skill-sync",
            run=lambda: skill_sync(server_name, skip_disable=skip_disable),
            retry_cmd=f"mcp2cli skill sync {server_name}",
            depends_on=["generate-skill"],
        ),
    ]
