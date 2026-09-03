# Observation Commands

## add — Add observations to existing entities

```bash
# Add observations to a single entity
mcp2cli memory observation add --observations '[{"entityName": "Alice", "contents": ["Joined company in 2024"]}]'

# Add observations to multiple entities
mcp2cli memory observation add --observations '[{"entityName": "Alice", "contents": ["Promoted to senior"]}, {"entityName": "Bob", "contents": ["Started new project"]}]'
```

## delete — Delete specific observations from entities

```bash
# Delete an observation from an entity
mcp2cli memory observation delete --deletions '[{"entityName": "Alice", "observations": ["Old job title"]}]'

# Delete observations from multiple entities
mcp2cli memory observation delete --deletions '[{"entityName": "Alice", "observations": ["Stale fact"]}, {"entityName": "Bob", "observations": ["Outdated note"]}]'
```

Use `mcp2cli memory observation <action> --help` for full parameter details.
