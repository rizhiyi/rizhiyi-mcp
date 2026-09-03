# Trace Commands

## get — Get trace information and metrics

```bash
# Get trace by ID
mcp2cli agentops trace get --trace-id abc123def456
```

Required: `--trace-id`

## get-complete — Get complete trace with all data

Use for explicit requests for COMPLETE or ALL trace data.

```bash
# Get complete trace data
mcp2cli agentops trace get-complete --trace-id abc123def456
```

Required: `--trace-id`

Use `mcp2cli agentops trace get --help` for full parameter details.
