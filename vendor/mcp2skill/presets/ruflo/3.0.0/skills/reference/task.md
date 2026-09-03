# Task Commands

## create — Create a new task

```bash
mcp2cli ruflo task create --type feature --description "Implement login page"
mcp2cli ruflo task create --type bugfix --description "Fix null pointer" --priority high
mcp2cli ruflo task create --type research --description "Evaluate caching options" --assign-to '["agent-1","agent-2"]'
```

Also supports: `--priority`, `--assign-to`, `--tags` (types: feature, bugfix, research, refactor)

## list — List all tasks

```bash
mcp2cli ruflo task list
mcp2cli ruflo task list --status pending --priority high
mcp2cli ruflo task list --type bugfix --assigned-to agent-1
```

Also supports: `--status`, `--type`, `--assigned-to`, `--priority`, `--limit`

## status — Get task status

```bash
mcp2cli ruflo task status --task-id t1
```

## update — Update task status or progress

```bash
mcp2cli ruflo task update --task-id t1 --status in-progress
mcp2cli ruflo task update --task-id t1 --progress 75
```

Also supports: `--assign-to`

## complete — Mark task as complete

```bash
mcp2cli ruflo task complete --task-id t1
mcp2cli ruflo task complete --task-id t1 --result '{"files": ["auth.ts"]}'
```

Also supports: `--result`

## assign — Assign task to agents

```bash
mcp2cli ruflo task assign --task-id t1 --agent-ids '["agent-1","agent-2"]'
mcp2cli ruflo task assign --task-id t1 --unassign true
```

## cancel — Cancel a task

```bash
mcp2cli ruflo task cancel --task-id t1
mcp2cli ruflo task cancel --task-id t1 --reason "Requirements changed"
```

## summary — Get tasks summary by status

```bash
mcp2cli ruflo task summary
```

Use `mcp2cli ruflo task <action> --help` for full parameter details.
