# Hooks Commands

## pre-task — Record task start and get agent suggestions

```bash
mcp2cli ruflo hooks pre-task --task-id t1 --description "Fix memory leak in auth module"
mcp2cli ruflo hooks pre-task --task-id t1 --description "Refactor API layer" --file-path src/api.ts
```

Also supports: `--file-path`

## post-task — Record task completion for learning

```bash
mcp2cli ruflo hooks post-task --task-id t1 --success true
mcp2cli ruflo hooks post-task --task-id t1 --success false --quality 0.4 --agent coder-1
```

Also supports: `--agent`, `--quality`, `--task`, `--store-decisions`

## pre-edit — Get context before editing a file

```bash
mcp2cli ruflo hooks pre-edit --file-path src/auth.ts
mcp2cli ruflo hooks pre-edit --file-path src/api.ts --operation refactor
```

Also supports: `--operation`, `--context` (operations: create, update, delete, refactor)

## post-edit — Record editing outcome

```bash
mcp2cli ruflo hooks post-edit --file-path src/auth.ts --success true
mcp2cli ruflo hooks post-edit --file-path src/auth.ts --success false --agent coder-1
```

Also supports: `--agent`

## pre-command — Assess risk before executing a command

```bash
mcp2cli ruflo hooks pre-command --command "git reset --hard HEAD~3"
```

## post-command — Record command execution outcome

```bash
mcp2cli ruflo hooks post-command --command "npm test" --exit-code 0
```

Also supports: `--exit-code`

## route — Route task to optimal agent

```bash
mcp2cli ruflo hooks route --task "implement OAuth flow"
mcp2cli ruflo hooks route --task "fix CSS layout bug" --context "React app, mobile-first"
```

Also supports: `--context`, `--use-semantic-router`

## init — Initialize hooks in project

```bash
mcp2cli ruflo hooks init
mcp2cli ruflo hooks init --template standard --path /path/to/project
```

Also supports: `--path`, `--template`, `--force` (templates: minimal, standard, full)

## metrics — View learning metrics dashboard

```bash
mcp2cli ruflo hooks metrics
mcp2cli ruflo hooks metrics --period 7d --include-v3 true
```

Also supports: `--period` (1h, 24h, 7d, 30d), `--include-v3`

## pretrain — Bootstrap intelligence from repo

```bash
mcp2cli ruflo hooks pretrain
mcp2cli ruflo hooks pretrain --depth deep --path /path/to/repo
```

Also supports: `--path`, `--depth`, `--skip-cache`

## Session hooks

```bash
mcp2cli ruflo hooks session start
mcp2cli ruflo hooks session start --restore-latest true
mcp2cli ruflo hooks session end --save-state true
mcp2cli ruflo hooks session restore --session-id sess-abc
```

## notify — Send cross-agent notification

```bash
mcp2cli ruflo hooks notify --message "Phase 1 complete" --target all
mcp2cli ruflo hooks notify --message "Urgent: build failed" --target agent-1 --priority urgent
```

Also supports: `--target`, `--priority`, `--data`

Use `mcp2cli ruflo hooks <action> --help` for full parameter details.
