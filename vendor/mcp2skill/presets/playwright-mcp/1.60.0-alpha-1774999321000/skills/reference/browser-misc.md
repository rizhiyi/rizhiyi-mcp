# Browser Miscellaneous Commands

## tab — Manage browser tabs

```bash
# List all tabs
mcp2cli playwright browser tab --action list

# Open new tab
mcp2cli playwright browser tab --action new

# Select tab by index
mcp2cli playwright browser tab --action select --index 1

# Close tab by index (omit --index to close current)
mcp2cli playwright browser tab --action close --index 0
```

Also supports: `--index`

## console list — Get console messages

```bash
# Get info-level messages (default)
mcp2cli playwright browser console list --level info

# Get all errors
mcp2cli playwright browser console list --level error

# Save to file
mcp2cli playwright browser console list --level debug --filename console.txt
```

Also supports: `--all`, `--filename`

## network list — Get network requests

```bash
# Basic request list (no static assets, no body/headers)
mcp2cli playwright browser network list --static false --request-body false --request-headers false

# Filter by URL pattern
mcp2cli playwright browser network list --static false --request-body false --request-headers false --filter "/api/.*"
```

Also supports: `--filter`, `--filename`

## dialog handle — Handle a browser dialog (alert/confirm/prompt)

```bash
# Accept dialog
mcp2cli playwright browser dialog handle --accept true

# Dismiss dialog
mcp2cli playwright browser dialog handle --accept false

# Accept prompt with text
mcp2cli playwright browser dialog handle --accept true --prompt-text "my answer"
```

Also supports: `--prompt-text`

## file upload — Upload files

```bash
mcp2cli playwright browser file upload --paths '["/absolute/path/to/file.pdf"]'

# Upload multiple files
mcp2cli playwright browser file upload --paths '["/path/file1.png","/path/file2.png"]'
```

## script evaluate — Evaluate JavaScript on the page

```bash
# Run JS expression
mcp2cli playwright browser script evaluate --function "() => document.title"

# Run on element
mcp2cli playwright browser script evaluate --function "(el) => el.textContent" --ref e1 --element "heading text"
```

Also supports: `--element`, `--ref`, `--filename`

## script run — Run a Playwright code snippet

```bash
mcp2cli playwright browser script run --code "async (page) => { await page.getByRole('button', { name: 'Submit' }).click(); }"

# Load code from file
mcp2cli playwright browser script run --filename ./script.js
```

Also supports: `--code`, `--filename`

## wait — Wait for text or a specified time

```bash
# Wait for text to appear
mcp2cli playwright browser wait --text "Page loaded"

# Wait for text to disappear
mcp2cli playwright browser wait --text-gone "Loading..."

# Wait for a fixed time (seconds)
mcp2cli playwright browser wait --time 2
```

Also supports: `--time`, `--text`, `--text-gone`

Use `mcp2cli playwright browser <cmd> --help` for full parameter details.
