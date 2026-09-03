# Agent Commands

## spawn — Spawn a new agent with intelligent model selection

```bash
mcp2cli ruflo agent spawn --agent-type worker
mcp2cli ruflo agent spawn --agent-type analyst --model sonnet
mcp2cli ruflo agent spawn --agent-type coder --task "Implement OAuth flow" --model opus
```

Also supports: `--agent-id`, `--config`, `--domain`

## list — List all agents

```bash
mcp2cli ruflo agent list
mcp2cli ruflo agent list --status active
```

Also supports: `--domain`, `--include-terminated`

## status — Get agent status

```bash
mcp2cli ruflo agent status --agent-id agent-1
```

## update — Update agent status or configuration

```bash
mcp2cli ruflo agent update --agent-id agent-1 --status idle
mcp2cli ruflo agent update --agent-id agent-1 --health 0.9 --task-count 2
```

Also supports: `--config`

## terminate — Terminate an agent

```bash
mcp2cli ruflo agent terminate --agent-id agent-1
mcp2cli ruflo agent terminate --agent-id agent-1 --force true
```

## health — Check agent health

```bash
mcp2cli ruflo agent health
mcp2cli ruflo agent health --agent-id agent-1 --threshold 0.7
```

## pool — Manage agent pool

```bash
mcp2cli ruflo agent pool --action status
mcp2cli ruflo agent pool --action scale --target-size 5 --agent-type worker
```

Also supports: `--target-size`, `--agent-type` (actions: status, scale, drain, fill)

Use `mcp2cli ruflo agent <action> --help` for full parameter details.
