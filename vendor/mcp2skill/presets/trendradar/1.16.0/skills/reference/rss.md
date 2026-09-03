# RSS Commands

## list — Get latest RSS subscription data

```bash
mcp2cli trendradar rss list
mcp2cli trendradar rss list --days 7 --feeds hacker-news 36kr
mcp2cli trendradar rss list --days 30 --limit 100 --include-summary true
```

Also supports: `--feeds`, `--days`, `--limit`, `--include-summary`

## search — Search RSS by keyword

```bash
mcp2cli trendradar rss search --keyword 'machine learning'
mcp2cli trendradar rss search --keyword 'AI' --feeds hacker-news --days 14
```

Also supports: `--feeds`, `--days`, `--limit`, `--include-summary`

## status — Get RSS feed status and statistics

```bash
mcp2cli trendradar rss status
```

No parameters required.

Use `mcp2cli trendradar rss <cmd> --help` for full parameter details.
