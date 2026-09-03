# Node Commands

## search — Search for nodes based on a query

```bash
# Search by entity name
mcp2cli memory node search --query "Alice"

# Search by entity type
mcp2cli memory node search --query "Person"

# Search by observation content
mcp2cli memory node search --query "engineer"
```

Matches against entity names, types, and observation content.

## get — Get specific nodes by their names

```bash
# Get a single node
mcp2cli memory node get --names '["Alice"]'

# Get multiple nodes
mcp2cli memory node get --names '["Alice", "Bob", "Acme Corp"]'
```

Use `mcp2cli memory node <action> --help` for full parameter details.
