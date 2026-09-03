# Workflow Commands

## run — Run a workflow from template or file

```bash
mcp2cli ruflo workflow run --template ci-pipeline
mcp2cli ruflo workflow run --file ./workflows/deploy.yaml
mcp2cli ruflo workflow run --template code-review --task "Review PR #42"
```

Also supports: `--file`, `--task`, `--options` (options: parallel, maxAgents, timeout, dryRun)

## create — Create a new workflow

```bash
mcp2cli ruflo workflow create --name my-flow
mcp2cli ruflo workflow create --name release-flow --description "Full release process"
```

Also supports: `--description`, `--steps`, `--variables`

## execute — Execute a workflow

```bash
mcp2cli ruflo workflow execute --workflow-id wf1
mcp2cli ruflo workflow execute --workflow-id wf1 --variables '{"env": "prod"}'
```

Also supports: `--variables`, `--start-from-step`

## status — Get workflow status

```bash
mcp2cli ruflo workflow status --workflow-id wf1
mcp2cli ruflo workflow status --workflow-id wf1 --verbose true
```

## list — List all workflows

```bash
mcp2cli ruflo workflow list
```

## pause — Pause a running workflow

```bash
mcp2cli ruflo workflow pause --workflow-id wf1
```

## resume — Resume a paused workflow

```bash
mcp2cli ruflo workflow resume --workflow-id wf1
```

## cancel — Cancel a workflow

```bash
mcp2cli ruflo workflow cancel --workflow-id wf1
```

## delete — Delete a workflow

```bash
mcp2cli ruflo workflow delete --workflow-id wf1
```

## template — Save or load workflow template

```bash
mcp2cli ruflo workflow template --workflow-id wf1
```

Use `mcp2cli ruflo workflow <action> --help` for full parameter details.
