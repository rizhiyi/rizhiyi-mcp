# Query Commands

## query — Run a read-only BigQuery SQL query

```bash
# Simple table query
mcp2cli bigquery query --sql 'SELECT * FROM dataset.table LIMIT 10'

# Aggregate query
mcp2cli bigquery query --sql 'SELECT COUNT(*) FROM project.dataset.table WHERE date = "2026-04-06"'

# Query with byte limit
mcp2cli bigquery query --sql 'SELECT * FROM dataset.large_table LIMIT 100' --maximum-bytes-billed '500000000'
```

Also supports: `--maximum-bytes-billed`

Use `mcp2cli bigquery query --help` for full parameter details.
