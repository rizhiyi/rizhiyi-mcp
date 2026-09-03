# Memory Commands

## write — Write project info to a named memory

```bash
# Write a simple memory
mcp2cli serena memory write --memory-name 'auth/logic' --content 'Auth uses JWT tokens stored in Redis'

# Write with topic organization
mcp2cli serena memory write --memory-name 'global/python/style_guide' --content 'Use Black formatter, max line length 88'
```

Also supports: `--max-chars`

## get — Read a memory

```bash
mcp2cli serena memory get --memory-name 'auth/logic'
```

## list — List available memories

```bash
# List all memories
mcp2cli serena memory list

# Filter by topic
mcp2cli serena memory list --topic auth
```

Also supports: `--topic`

## update — Edit memory via pattern replacement

```bash
# Literal replacement
mcp2cli serena memory update --memory-name 'auth/logic' --needle 'Redis' --repl 'PostgreSQL' --mode literal

# Regex replacement
mcp2cli serena memory update --memory-name 'auth/logic' --needle 'JWT.*tokens' --repl 'session cookies' --mode regex
```

Also supports: `--allow-multiple-occurrences`

## rename — Rename or move a memory

```bash
mcp2cli serena memory rename --old-name 'auth/logic' --new-name 'security/auth/logic'
```

## delete — Delete a memory

```bash
mcp2cli serena memory delete --memory-name 'auth/logic'
```

Use `mcp2cli serena memory <action> --help` for full parameter details.
