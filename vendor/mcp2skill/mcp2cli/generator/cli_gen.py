"""AI-powered CLI command tree generation."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import click
import yaml

from mcp2cli.cli.mapping import cli_path, extract_tools_from_yaml, print_command_tree
from mcp2cli.config.tool_store import load_tools, tools_path
from mcp2cli.constants import CLI_DIR, TEMPLATES_DIR
from mcp2cli.generator.llm_backend import ClaudeCLIBackend, get_backend
from mcp2cli.generator.validator import validate_cli_yaml

MAX_RETRIES = 2


def generate_cli(server_name: str, merge: bool = False) -> bool:
    """Generate CLI command tree YAML via LLM.

    Returns True on success.
    """
    tools_json = load_tools(server_name)
    if tools_json is None:
        click.echo(
            f"Error: tools/{server_name}.json not found.\n"
            f"Run `mcp2cli scan {server_name}` first.",
            err=True,
        )
        return False

    click.echo(f"Generating CLI command tree for {server_name} ({len(tools_json.tools)} tools)...")

    backend = get_backend()
    command_name = "generate cli"

    # Check for unfinished session
    existing_session = backend.find_session(command_name, server_name)
    if existing_session:
        if click.confirm("Found unfinished session. Resume?", default=True):
            click.echo(f"Resuming session {existing_session[:12]}...")
            result = backend.resume(
                existing_session,
                _build_resume_prompt(server_name),
                show_progress=True,
                progress_message="Resuming generation...",
            )
            if not result.is_error:
                return _post_validate(server_name, backend, result.session_id, command_name)
        existing_session = None

    # Build and send prompt
    prompt = _build_prompt(server_name, tools_json.version, merge)
    result = backend.invoke(
        prompt,
        command_name=command_name,
        server_name=server_name,
        show_progress=True,
        progress_message=f"Generating CLI tree for {server_name}...",
    )

    if result.is_error:
        click.echo(f"LLM error: {result.result}", err=True)
        return False

    return _post_validate(server_name, backend, result.session_id, command_name)


def _post_validate(
    server_name: str,
    backend: ClaudeCLIBackend,
    session_id: str | None,
    command_name: str,
) -> bool:
    """Run program-side validation with retry."""
    for attempt in range(1, MAX_RETRIES + 1):
        errors = validate_cli_yaml(server_name)
        if not errors:
            click.echo("Program validation passed ✓")
            # Print tree preview
            data = yaml.safe_load(cli_path(server_name).read_text(encoding="utf-8"))
            if data:
                yaml_tools = extract_tools_from_yaml(data)
                click.echo(f"  Coverage: {len(yaml_tools)} tools mapped")
                print_command_tree(data, server_name)
            click.echo(f"📦 Written to {cli_path(server_name)}")
            backend.clear_session(command_name, server_name)
            return True

        click.echo(f"Program validation failed (attempt {attempt}/{MAX_RETRIES}):")
        for e in errors:
            click.echo(f"  - {e}")

        if attempt >= MAX_RETRIES or session_id is None:
            click.echo("Validation failed. Please fix manually or re-run.", err=True)
            return False

        click.echo("Retrying with error context...")
        error_prompt = _build_retry_prompt(server_name, errors)
        result = backend.resume(session_id, error_prompt, show_progress=True, progress_message="Fixing validation errors...")
        if result.is_error:
            click.echo(f"LLM retry error: {result.result}", err=True)
            return False

    return False


def _build_prompt(server_name: str, version: str | None, merge: bool) -> str:
    skill_path = TEMPLATES_DIR / "cli_gen_skill.md"
    example_path = TEMPLATES_DIR / "cli_gen_example.md"
    tools_file = tools_path(server_name)
    output_path = cli_path(server_name)

    CLI_DIR.mkdir(parents=True, exist_ok=True)

    if merge:
        existing_cli = cli_path(server_name)
        return (
            f"You are the CLI command tree generator for mcp2cli. Your task is to extend an existing command tree with newly added tools from an MCP server.\n\n"
            f"Follow these steps:\n\n"
            f"Step 1: Read the generation rules\n"
            f"Read file {skill_path} to understand the command tree's layering principles, naming conventions, and format requirements.\n\n"
            f"Step 2: Read the output example\n"
            f"Read file {example_path} to understand the expected YAML output format and style.\n\n"
            f"Step 3: Get the tool list\n"
            f"Read file {tools_file}, which contains all tool definitions for MCP server \"{server_name}\".\n\n"
            f"Step 4: Read the existing command tree\n"
            f"Read file {existing_cli}, the current command mapping file.\n\n"
            f"Step 5: Diff analysis\n"
            f"Compare the tool list against the existing command tree:\n"
            f"- Find tools already mapped in the existing command tree (keep unchanged)\n"
            f"- Find new tools in the tool list that are not yet mapped\n"
            f"- Find tools referenced in the existing command tree that no longer exist in the tool list (remove)\n\n"
            f"Step 6: Incremental merge\n"
            f"Merge new tools into the existing command tree:\n"
            f"- Preserve existing structure, descriptions, aliases, and examples unchanged\n"
            f"- Only add mapping nodes for new tools\n"
            f"- Change generated_by to \"ai-merge\"\n"
            f"- Update the generated_at timestamp\n"
            f"- If there are tools that no longer exist, directly remove the corresponding leaf nodes\n\n"
            f"Step 7: Write the file\n"
            f"Write the fully merged YAML to {output_path}.\n\n"
            f"Step 8: Self-validate\n"
            f"Run `mcp2cli validate {server_name}` to check that the merged YAML satisfies all rules.\n"
            f"If validation fails, fix the YAML based on the output, rewrite {output_path}, and run `mcp2cli validate {server_name}` again until it passes.\n\n"
            f"Important constraints:\n"
            f"- The existing structure must be fully preserved; do not reorganize or modify descriptions\n"
            f"- Only new nodes need to follow the rules in cli_gen_skill.md\n"
            f"- After completion, output a summary: \"Merged: X new tools added, Y existing preserved, Z removed\"\n"
        )

    return (
        f"You are the CLI command tree generator for mcp2cli. Your task is to organize the flat tool list of an MCP server into a hierarchical command tree and output a YAML mapping file.\n\n"
        f"Follow these steps:\n\n"
        f"Step 1: Read the generation rules\n"
        f"Read file {skill_path} to understand the command tree's layering principles, naming conventions, and format requirements.\n\n"
        f"Step 2: Read the output example\n"
        f"Read file {example_path} to understand the expected YAML output format and style.\n\n"
        f"Step 3: Get the tool list\n"
        f"Read file {tools_file}, which contains all tool definitions for MCP server \"{server_name}\", including tool names, descriptions, and input_schema.\n\n"
        f"Step 4: Generate the command tree\n"
        f"Using the rules and example, organize all tools into a hierarchical command tree. Ensure:\n"
        f"- Every tool is mapped into the command tree (100% coverage)\n"
        f"- All rules from cli_gen_skill.md are followed\n"
        f"- The YAML format is consistent with cli_gen_example.md\n\n"
        f"Step 5: Write the file\n"
        f"Write the fully generated YAML content to {output_path}.\n\n"
        f"Step 6: Self-validate\n"
        f"Run `mcp2cli validate {server_name}` to check that the generated YAML satisfies all rules.\n"
        f"If validation fails, fix the YAML based on the output, rewrite {output_path}, and run `mcp2cli validate {server_name}` again until it passes.\n\n"
        f"Important constraints:\n"
        f"- Do not output explanations; execute the steps directly\n"
        f"- The written file must be valid YAML\n"
        f"- All tools must be covered; none may be omitted\n"
        f"- After completion, output a one-line summary: \"Generated: X tools mapped to Y commands\"\n"
    )


def _build_retry_prompt(server_name: str, errors: list[str]) -> str:
    output_path = cli_path(server_name)
    error_text = "\n".join(f"- {e}" for e in errors)
    return (
        f"The YAML you generated and wrote to {output_path} last time has the following issues:\n\n"
        f"{error_text}\n\n"
        f"Please fix the issues above and rewrite {output_path}.\n"
        f"Note:\n"
        f"- You have already read the skill/example/tools files; no need to re-read them\n"
        f"- Keep all correct parts unchanged; only fix the listed issues\n"
        f"- After fixing, run `mcp2cli validate {server_name}` to verify\n"
        f"- After fixing, output a summary: \"Fixed: <brief description of what was fixed>\"\n"
    )


def _build_resume_prompt(server_name: str) -> str:
    return (
        f"Please continue the unfinished CLI command tree generation task.\n"
        f"Target server: {server_name}\n"
        f"If the YAML file has already been generated, run `mcp2cli validate {server_name}` to verify it.\n"
        f"If it has not been generated yet, continue from where the task was interrupted.\n"
    )
