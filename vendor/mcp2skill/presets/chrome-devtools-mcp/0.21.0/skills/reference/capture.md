# Capture Commands

## snapshot — Take accessibility tree snapshot (preferred over screenshot)

```bash
# Take snapshot and return inline
mcp2cli chrome-devtools capture snapshot

# Save to file
mcp2cli chrome-devtools capture snapshot --file-path /tmp/snapshot.txt
```

Also supports: `--verbose`, `--file-path`

## screenshot — Take a screenshot of the page or element

```bash
# Full page screenshot (PNG)
mcp2cli chrome-devtools capture screenshot --format png

# JPEG with quality
mcp2cli chrome-devtools capture screenshot --format jpeg --quality 85

# Screenshot of specific element
mcp2cli chrome-devtools capture screenshot --uid e5

# Full page (not just viewport)
mcp2cli chrome-devtools capture screenshot --full-page true

# Save to file instead of inline response
mcp2cli chrome-devtools capture screenshot --file-path /tmp/screen.png
```

Also supports: `--format`, `--quality`, `--uid`, `--full-page`, `--file-path`

Use `mcp2cli chrome-devtools capture <action> --help` for full parameter details.
