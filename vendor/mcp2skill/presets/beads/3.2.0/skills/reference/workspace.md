# Workspace Commands

## dep — Add a dependency between issues

Dependency types: `blocks` (hard blocker), `related` (soft link), `parent-child` (epic/subtask), `discovered-from` (found during work).

```bash
mcp2cli beads dep --issue-id ISSUE-2 --depends-on-id ISSUE-1
mcp2cli beads dep --issue-id ISSUE-3 --depends-on-id ISSUE-2 --dep-type related
mcp2cli beads dep --issue-id ISSUE-4 --depends-on-id ISSUE-1 --dep-type parent-child
```

Also supports: `--workspace-root`

## stats — Get issue statistics

Returns: total, open, in_progress, closed, blocked, ready, average lead time.

```bash
mcp2cli beads stats
```

Also supports: `--workspace-root`

## context — Manage workspace context

Actions: `show` (current context), `set` (set workspace root), `init` (initialize beads in workspace).

```bash
mcp2cli beads context --action show
mcp2cli beads context --action set --workspace-root /path/to/project
mcp2cli beads context --action init
mcp2cli beads context --action init --workspace-root /path/to/project --prefix PROJ
```

Also supports: `--prefix`

## admin — Administrative and diagnostic operations

Actions: `validate`, `repair`, `schema`, `debug`, `migration`, `pollution`.

```bash
mcp2cli beads admin --action validate
mcp2cli beads admin --action validate --checks "orphans,duplicates"
mcp2cli beads admin --action repair --fix true
mcp2cli beads admin --action pollution
mcp2cli beads admin --action pollution --clean true
mcp2cli beads admin --action debug
mcp2cli beads admin --action schema
mcp2cli beads admin --action migration
```

Also supports: `--checks`, `--fix-all`, `--fix`, `--clean`, `--workspace-root`

## tool list — List available beads tools

```bash
mcp2cli beads tool list
```

## tool get — Get detailed info about a specific tool

```bash
mcp2cli beads tool get --tool-name create
mcp2cli beads tool get --tool-name dep
```

Use `mcp2cli beads <cmd> --help` for full parameter details.
