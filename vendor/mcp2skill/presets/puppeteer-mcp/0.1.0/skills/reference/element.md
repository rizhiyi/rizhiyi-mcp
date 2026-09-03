# Element Commands

## click — Click an element on the page

```bash
mcp2cli puppeteer element click --selector "#submit-btn"
mcp2cli puppeteer element click --selector "button[type='submit']"
```

## fill — Fill out an input field

```bash
mcp2cli puppeteer element fill --selector "#username" --value "john"
mcp2cli puppeteer element fill --selector "input[name='email']" --value "user@example.com"
```

## select — Select a dropdown option

```bash
mcp2cli puppeteer element select --selector "#country" --value "US"
mcp2cli puppeteer element select --selector "select[name='role']" --value "admin"
```

## hover — Hover over an element

```bash
mcp2cli puppeteer element hover --selector ".dropdown-menu"
mcp2cli puppeteer element hover --selector "nav .menu-item:first-child"
```

Use `mcp2cli puppeteer element <action> --help` for full parameter details.
