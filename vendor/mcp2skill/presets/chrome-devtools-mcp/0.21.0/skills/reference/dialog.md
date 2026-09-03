# Dialog Commands

## handle — Accept or dismiss a browser dialog

```bash
# Accept dialog (OK / Confirm)
mcp2cli chrome-devtools dialog handle --action accept

# Dismiss dialog (Cancel)
mcp2cli chrome-devtools dialog handle --action dismiss

# Accept with prompt text
mcp2cli chrome-devtools dialog handle --action accept --prompt-text "my input"
```

Also supports: `--prompt-text`

> Use this when a browser dialog (alert, confirm, prompt) appears after an action.

Use `mcp2cli chrome-devtools dialog handle --help` for full parameter details.
