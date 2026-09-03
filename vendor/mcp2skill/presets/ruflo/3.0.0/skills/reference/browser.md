# Browser Commands

## open — Navigate to URL

```bash
mcp2cli ruflo browser open --url https://example.com
```

## snapshot — Get accessibility tree snapshot

```bash
mcp2cli ruflo browser snapshot
```

## screenshot — Capture a screenshot

```bash
mcp2cli ruflo browser screenshot
```

## click — Click an element

```bash
mcp2cli ruflo browser click --ref elem-123
```

Also supports: CSS selector via `--selector` (check --help)

## fill — Clear and fill an input

```bash
mcp2cli ruflo browser fill --ref input-1 --value "user@example.com"
```

## type — Type text with key events

```bash
mcp2cli ruflo browser type --ref input-1 --text "search term"
```

## press — Press a keyboard key

```bash
mcp2cli ruflo browser press --key Enter
mcp2cli ruflo browser press --key "Control+A"
```

## get-text — Get text content of element

```bash
mcp2cli ruflo browser get-text --ref elem-1
```

## get-url — Get current page URL

```bash
mcp2cli ruflo browser get-url
```

## get-title — Get current page title

```bash
mcp2cli ruflo browser get-title
```

## eval — Execute JavaScript

```bash
mcp2cli ruflo browser eval --script "document.title"
```

## back / forward / reload

```bash
mcp2cli ruflo browser back
mcp2cli ruflo browser forward
mcp2cli ruflo browser reload
```

## close — Close browser session

```bash
mcp2cli ruflo browser close
```

## select — Select dropdown option

```bash
mcp2cli ruflo browser select --ref select-1 --value "option-value"
```

## scroll — Scroll the page

```bash
mcp2cli ruflo browser scroll --direction down --amount 300
```

Use `mcp2cli ruflo browser <action> --help` for full parameter details.
