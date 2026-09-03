# Page Commands

## navigate — Navigate to a URL

```bash
mcp2cli puppeteer page navigate --url https://example.com
mcp2cli puppeteer page navigate --url https://example.com --launch-options '{"headless": true}'
```

Also supports: `--launch-options`, `--allow-dangerous`

## screenshot — Take a screenshot of the current page or element

```bash
# Full page screenshot
mcp2cli puppeteer page screenshot --name my-screenshot

# Screenshot a specific element
mcp2cli puppeteer page screenshot --name header-shot --selector "header"

# Screenshot with custom dimensions
mcp2cli puppeteer page screenshot --name wide-shot --width 1280 --height 720
```

Also supports: `--selector`, `--width`, `--height`, `--encoded`

## evaluate — Execute JavaScript in the browser console

```bash
# Get page title
mcp2cli puppeteer page evaluate --script "document.title"

# Get element count
mcp2cli puppeteer page evaluate --script "document.querySelectorAll('a').length"

# Scroll to bottom
mcp2cli puppeteer page evaluate --script "window.scrollTo(0, document.body.scrollHeight)"
```

Use `mcp2cli puppeteer page <action> --help` for full parameter details.
