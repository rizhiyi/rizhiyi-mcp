# Docs Commands

## search — Search Cloudflare documentation

```bash
# Search for a product or feature
mcp2cli cloudflare docs search --query "Workers KV storage"

# Search for security products
mcp2cli cloudflare docs search --query "Zero Trust Access policy"

# Search for infrastructure topics
mcp2cli cloudflare docs search --query "D1 database SQL queries"
```

Required: `--query`

## migrate-guide — Get Pages to Workers migration guide

```bash
# Get the full migration guide (no parameters required)
mcp2cli cloudflare docs migrate-guide
```

> Always read this guide before migrating Pages projects to Workers.

Use `mcp2cli cloudflare docs <action> --help` for full parameter details.
