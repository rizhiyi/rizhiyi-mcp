# Date Commands

## resolve — Resolve natural language date expression to standard date range

> **Recommended**: Call this first when user provides natural language dates, then pass the result to other commands.

```bash
mcp2cli trendradar date resolve --expression '本周'
mcp2cli trendradar date resolve --expression 'last 7 days'
mcp2cli trendradar date resolve --expression '昨天'
```

Supported expressions: `今天`, `昨天`, `本周`, `上周`, `本月`, `上月`, `最近7天`, `最近30天`, `today`, `yesterday`, `this week`, `last week`, `last 7 days`, `last 30 days`, etc.

Returns: `{"date_range": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}, ...}`

Use `mcp2cli trendradar date resolve --help` for full parameter details.
