# Memory Commands

## store — Store value with vector embedding

```bash
mcp2cli ruflo memory store --key mykey --value "some data to remember"
mcp2cli ruflo memory store --key auth-pattern --value "JWT refresh token pattern" --namespace patterns
```

Also supports: `--namespace`, `--tags`, `--ttl`, `--upsert`

## get — Retrieve a value by key

```bash
mcp2cli ruflo memory get --key mykey
mcp2cli ruflo memory get --key auth-pattern --namespace patterns
```

Also supports: `--namespace`

## search — Semantic vector search (HNSW-powered)

```bash
mcp2cli ruflo memory search --query "authentication patterns"
mcp2cli ruflo memory search --query "caching strategies" --limit 5 --threshold 0.5
```

Also supports: `--namespace`, `--limit`, `--threshold`

## list — List memory entries

```bash
mcp2cli ruflo memory list
mcp2cli ruflo memory list --namespace patterns --limit 20
```

Also supports: `--namespace`, `--limit`, `--offset`

## delete — Delete a memory entry

```bash
mcp2cli ruflo memory delete --key mykey
mcp2cli ruflo memory delete --key auth-pattern --namespace patterns
```

Also supports: `--namespace`

## stats — Get memory storage statistics

```bash
mcp2cli ruflo memory stats
```

## migrate — Migrate to sql.js backend

```bash
mcp2cli ruflo memory migrate
mcp2cli ruflo memory migrate --force true
```

Use `mcp2cli ruflo memory <action> --help` for full parameter details.
