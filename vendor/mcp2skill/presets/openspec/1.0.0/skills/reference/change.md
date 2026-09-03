# Change Commands

## create — Create a new change directory

```bash
mcp2cli openspec change create --name add-dark-mode
mcp2cli openspec change create --name add-dark-mode --description "Add dark mode support to the UI"
```

Also supports: `--description`

## status — Display artifact completion status for a change

```bash
mcp2cli openspec change status
mcp2cli openspec change status --change-name add-dark-mode
```

Also supports: `--change-name`, `--json`

## instructions — Output enriched instructions for an artifact or apply action

```bash
mcp2cli openspec change instructions --artifact design.md
mcp2cli openspec change instructions --artifact design.md --change-name add-dark-mode
mcp2cli openspec change instructions --artifact apply --change-name add-dark-mode
```

Also supports: `--change-name`, `--json`

## archive — Archive a completed change and update main specs

```bash
mcp2cli openspec change archive --change-name add-dark-mode
mcp2cli openspec change archive --change-name add-dark-mode --skip-specs
```

Also supports: `--skip-specs`

Use `mcp2cli openspec change <cmd> --help` for full parameter details.
