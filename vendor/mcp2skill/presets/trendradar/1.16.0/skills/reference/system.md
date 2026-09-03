# System Commands

## status — Get system running status and health info

```bash
mcp2cli trendradar system status
```

No parameters required.

## config — Get current system configuration

```bash
mcp2cli trendradar system config
mcp2cli trendradar system config --section crawler
```

Also supports: `--section` (all/crawler/push/keywords/weights)

## version — Check for version updates

```bash
mcp2cli trendradar system version
mcp2cli trendradar system version --proxy-url 'http://127.0.0.1:7890'
```

Also supports: `--proxy-url`

## crawl — Manually trigger a crawl task

```bash
mcp2cli trendradar system crawl
mcp2cli trendradar system crawl --platforms zhihu weibo
mcp2cli trendradar system crawl --save-to-local true
```

Also supports: `--platforms`, `--save-to-local`, `--include-url`

## dates — List available date ranges

```bash
mcp2cli trendradar system dates
mcp2cli trendradar system dates --source local
```

Also supports: `--source` (local/remote/both)

Use `mcp2cli trendradar system <cmd> --help` for full parameter details.
