# Relation Commands

## create — Create relations between entities

```bash
# Create a single relation
mcp2cli memory relation create --relations '[{"from": "Alice", "to": "Bob", "relationType": "knows"}]'

# Create multiple relations
mcp2cli memory relation create --relations '[{"from": "Alice", "to": "Acme Corp", "relationType": "works_at"}, {"from": "Bob", "to": "Acme Corp", "relationType": "works_at"}]'
```

## delete — Delete relations from the knowledge graph

```bash
# Delete a specific relation
mcp2cli memory relation delete --relations '[{"from": "Alice", "to": "Bob", "relationType": "knows"}]'

# Delete multiple relations
mcp2cli memory relation delete --relations '[{"from": "Alice", "to": "Acme Corp", "relationType": "works_at"}, {"from": "Bob", "to": "Acme Corp", "relationType": "works_at"}]'
```

Use `mcp2cli memory relation <action> --help` for full parameter details.
