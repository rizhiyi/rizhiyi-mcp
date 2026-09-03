# Script Commands

## evaluate — Evaluate a JavaScript function in the current page

```bash
# Get page title
mcp2cli chrome-devtools script evaluate --function '() => document.title'

# Get element text using snapshot UID as argument
mcp2cli chrome-devtools script evaluate --function '(el) => el.innerText' --args '["e5"]'

# Async fetch
mcp2cli chrome-devtools script evaluate --function 'async () => { const r = await fetch("/api/status"); return r.json(); }'
```

Also supports: `--args`

> Returned values must be JSON-serializable.
> UIDs in `--args` refer to elements from the accessibility snapshot.

Use `mcp2cli chrome-devtools script evaluate --help` for full parameter details.
