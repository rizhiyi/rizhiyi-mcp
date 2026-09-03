# Storage Commands

## status — Get storage configuration and status

```bash
mcp2cli trendradar storage status
```

No parameters required.

## sync — Sync data from remote storage to local

```bash
mcp2cli trendradar storage sync
mcp2cli trendradar storage sync --days 30
```

Also supports: `--days`

> **Note**: Requires S3 remote storage configured in config.yaml or env vars: S3_ENDPOINT_URL, S3_BUCKET_NAME, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.

Use `mcp2cli trendradar storage <cmd> --help` for full parameter details.
