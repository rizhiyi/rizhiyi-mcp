# Element Commands

> Element UIDs come from `mcp2cli chrome-devtools capture snapshot` — always take a fresh snapshot first.

## click — Click on an element

```bash
mcp2cli chrome-devtools element click --uid e12

# Double click
mcp2cli chrome-devtools element click --uid e12 --dbl-click true
```

Also supports: `--dbl-click`, `--include-snapshot`

## fill — Type text into input or select option from `<select>`

```bash
mcp2cli chrome-devtools element fill --uid e5 --value "hello@example.com"
mcp2cli chrome-devtools element fill --uid e9 --value "Option A"
```

Also supports: `--include-snapshot`

## fill-form — Fill multiple form elements at once

```bash
mcp2cli chrome-devtools element fill-form --elements '[{"uid":"e3","value":"Alice"},{"uid":"e4","value":"alice@example.com"}]'
```

Also supports: `--include-snapshot`

## type — Type text into a focused input using keyboard

```bash
mcp2cli chrome-devtools element type --text "search query"

# Type and submit
mcp2cli chrome-devtools element type --text "search query" --submit-key Enter
```

Also supports: `--submit-key`

## press-key — Press a key or key combination

```bash
mcp2cli chrome-devtools element press-key --key "Enter"
mcp2cli chrome-devtools element press-key --key "Control+A"
mcp2cli chrome-devtools element press-key --key "Control+Shift+R"
```

Also supports: `--include-snapshot`

## hover — Hover over an element

```bash
mcp2cli chrome-devtools element hover --uid e8
```

Also supports: `--include-snapshot`

## drag — Drag element onto another element

```bash
mcp2cli chrome-devtools element drag --from-uid e10 --to-uid e20
```

Also supports: `--include-snapshot`

## upload — Upload a file through a file input

```bash
mcp2cli chrome-devtools element upload --uid e15 --file-path /path/to/file.pdf
```

Also supports: `--include-snapshot`

Use `mcp2cli chrome-devtools element <action> --help` for full parameter details.
