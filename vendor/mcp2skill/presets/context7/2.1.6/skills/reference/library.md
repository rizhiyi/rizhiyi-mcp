# Library Commands

## resolve — Resolve a library name to a Context7-compatible library ID

```bash
# Resolve react library
mcp2cli context7 library resolve --library-name react --query 'hooks usage'

# Resolve next.js
mcp2cli context7 library resolve --library-name 'next.js' --query 'server side rendering'

# Resolve with specific task context
mcp2cli context7 library resolve --library-name express --query 'middleware setup'
```

> Call this before `library search` to get a valid library ID (format: `/org/project`).
> Results include benchmark score and source reputation — prefer High/Medium reputation with higher snippet counts.

## search — Query up-to-date documentation and code examples

```bash
# Query next.js docs
mcp2cli context7 library search --library-id '/vercel/next.js' --query 'How to set up authentication with JWT'

# Query with specific version
mcp2cli context7 library search --library-id '/vercel/next.js/v14.3.0-canary.87' --query 'app router migration'

# Query react docs
mcp2cli context7 library search --library-id '/facebook/react' --query 'useEffect cleanup examples'
```

> Requires a valid `--library-id` from `library resolve` or directly as `/org/project` or `/org/project/version`.

Use `mcp2cli context7 library <action> --help` for full parameter details.
