# Performance Commands

## trace-start — Start a performance trace

```bash
# Auto-reload and auto-stop (default)
mcp2cli chrome-devtools performance trace-start

# Save raw trace data
mcp2cli chrome-devtools performance trace-start --file-path trace.json.gz

# Manual stop (set auto-stop false)
mcp2cli chrome-devtools performance trace-start --auto-stop false
```

Also supports: `--reload`, `--auto-stop`, `--file-path`

> Navigate to the target page BEFORE starting the trace when `--reload` or `--auto-stop` is true.

## trace-stop — Stop the active performance trace

```bash
mcp2cli chrome-devtools performance trace-stop

# Save trace to file
mcp2cli chrome-devtools performance trace-stop --file-path trace.json.gz
```

Also supports: `--file-path`

## analyze — Analyze a specific performance insight

```bash
mcp2cli chrome-devtools performance analyze --insight-set-id <id> --insight-name LCPBreakdown
mcp2cli chrome-devtools performance analyze --insight-set-id <id> --insight-name DocumentLatency
```

> Get `--insight-set-id` from trace-stop output's "Available insight sets" list.

## memory-snapshot — Capture a heap snapshot for memory analysis

```bash
mcp2cli chrome-devtools performance memory-snapshot --file-path heap.heapsnapshot
```

> Use to debug memory leaks and analyze JavaScript object distribution.

## lighthouse — Run a Lighthouse audit

```bash
# Default (navigation mode, desktop)
mcp2cli chrome-devtools performance lighthouse

# Mobile snapshot audit
mcp2cli chrome-devtools performance lighthouse --mode snapshot --device mobile

# Save reports to directory
mcp2cli chrome-devtools performance lighthouse --output-dir-path /tmp/lighthouse
```

Also supports: `--mode`, `--device`, `--output-dir-path`

> Lighthouse covers accessibility, SEO, and best practices. For performance, use `trace-start`.

Use `mcp2cli chrome-devtools performance <action> --help` for full parameter details.
