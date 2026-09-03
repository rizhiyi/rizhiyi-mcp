# Page Commands

## create — Open a new tab and load a URL

```bash
mcp2cli chrome-devtools page create --url https://example.com

# Open in background
mcp2cli chrome-devtools page create --url https://example.com --background true
```

Also supports: `--background`, `--isolated-context`, `--timeout`

## list — List all open pages

```bash
mcp2cli chrome-devtools page list
```

## navigate — Navigate to URL or go back/forward/reload

```bash
mcp2cli chrome-devtools page navigate --type url --url https://example.com
mcp2cli chrome-devtools page navigate --type back
mcp2cli chrome-devtools page navigate --type reload
```

Also supports: `--ignore-cache`, `--handle-before-unload`, `--init-script`, `--timeout`

## select — Select a page as active context

```bash
# First list pages to find the ID
mcp2cli chrome-devtools page list

mcp2cli chrome-devtools page select --page-id 1
```

Also supports: `--bring-to-front`

## close — Close a page by ID

```bash
mcp2cli chrome-devtools page close --page-id 2
```

## wait — Wait for text to appear on the page

```bash
mcp2cli chrome-devtools page wait --text '["Submit"]'

# Wait for any of multiple texts
mcp2cli chrome-devtools page wait --text '["Loaded", "Ready", "Done"]'
```

Also supports: `--timeout`

## emulate — Emulate network conditions, CPU, geolocation, or viewport

```bash
# Slow network
mcp2cli chrome-devtools page emulate --network-conditions "Slow 3G"

# Mobile viewport
mcp2cli chrome-devtools page emulate --viewport "375x667x2,mobile,touch"

# Dark mode
mcp2cli chrome-devtools page emulate --color-scheme dark
```

Also supports: `--cpu-throttling-rate`, `--geolocation`, `--user-agent`

## resize — Resize page window

```bash
mcp2cli chrome-devtools page resize --width 1280 --height 720
mcp2cli chrome-devtools page resize --width 375 --height 812
```

Use `mcp2cli chrome-devtools page <action> --help` for full parameter details.
