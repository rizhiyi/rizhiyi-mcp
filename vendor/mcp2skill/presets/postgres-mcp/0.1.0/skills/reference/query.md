# Query Commands

## query — Run a read-only SQL query

```bash
# Simple SELECT
mcp2cli postgres query --sql 'SELECT * FROM users LIMIT 10'

# List all public tables
mcp2cli postgres query --sql 'SELECT table_name FROM information_schema.tables WHERE table_schema='"'"'public'"'"''

# Aggregate query
mcp2cli postgres query --sql 'SELECT status, COUNT(*) FROM orders GROUP BY status'
```

Required: `--sql`

Use `mcp2cli postgres query --help` for full parameter details.
