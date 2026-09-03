# Entity Commands

## create — Create entities in the knowledge graph

```bash
# Create a single entity
mcp2cli memory entity create --entities '[{"name": "Alice", "entityType": "Person", "observations": ["Software engineer"]}]'

# Create multiple entities
mcp2cli memory entity create --entities '[{"name": "Alice", "entityType": "Person", "observations": ["Engineer"]}, {"name": "Acme Corp", "entityType": "Organization", "observations": ["Tech company"]}]'
```

## delete — Delete entities and their associated relations

```bash
# Delete a single entity
mcp2cli memory entity delete --entity-names '["Alice"]'

# Delete multiple entities
mcp2cli memory entity delete --entity-names '["Alice", "Bob"]'
```

Use `mcp2cli memory entity <action> --help` for full parameter details.
