# Session Commands

## config — Get current agent configuration

```bash
mcp2cli serena session config
```

Returns active/available projects, tools, contexts, and modes.

## modes — Switch active agent modes

```bash
# Switch to editing + interactive mode
mcp2cli serena session modes --modes '["editing","interactive"]'

# Switch to planning + one-shot mode
mcp2cli serena session modes --modes '["planning","one-shot"]'
```

## prepare — Prepare for a new conversation

```bash
mcp2cli serena session prepare
```

> Call only on explicit user request to reset conversation state.

## instructions — Get Serena Instructions Manual

```bash
mcp2cli serena session instructions
```

> Call immediately after receiving a task if you haven't read the manual yet.

Use `mcp2cli serena session <action> --help` for full parameter details.
