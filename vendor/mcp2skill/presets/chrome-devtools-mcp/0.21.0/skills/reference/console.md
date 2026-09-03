# Console Commands

## list — List all console messages for the current page

```bash
# All messages
mcp2cli chrome-devtools console list

# Only errors and warnings
mcp2cli chrome-devtools console list --types '["error","warn"]'

# Paginated
mcp2cli chrome-devtools console list --page-size 50 --page-idx 0
```

Also supports: `--page-size`, `--page-idx`, `--types`, `--include-preserved-messages`

## get — Get a console message by ID

```bash
mcp2cli chrome-devtools console get --msgid 3
```

> Use `list` first to find msgid values.

Use `mcp2cli chrome-devtools console <action> --help` for full parameter details.
