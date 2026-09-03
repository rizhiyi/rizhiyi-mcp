# Article Commands

## read — Read article content at URL as Markdown

```bash
mcp2cli trendradar article read --url 'https://example.com/news/123'
```

Also supports: `--timeout`

> **Tip**: First use `mcp2cli trendradar news search --include-url true` to get URLs, then read with this command.

## batch-read — Batch read multiple article URLs (max 5)

```bash
mcp2cli trendradar article batch-read --urls 'https://a.com/1' 'https://b.com/2'
```

Also supports: `--timeout`

> **Note**: Max 5 URLs per batch; each request is separated by 5 seconds.

Use `mcp2cli trendradar article <cmd> --help` for full parameter details.
