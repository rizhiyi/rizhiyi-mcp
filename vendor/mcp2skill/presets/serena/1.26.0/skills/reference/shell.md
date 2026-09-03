# Shell Command

## shell — Execute a shell command

```bash
# Run tests
mcp2cli serena shell --command 'npm test'

# Run in specific directory
mcp2cli serena shell --command 'pytest tests/' --cwd /path/to/project

# Build project
mcp2cli serena shell --command 'make build'
```

Also supports: `--cwd`, `--capture-stderr`, `--max-answer-chars`

> **Note**: Do not use for long-running processes (e.g., servers) or commands requiring user interaction.

Use `mcp2cli serena shell --help` for full parameter details.
