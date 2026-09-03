# Think Commands

## think — Execute a sequential thinking step

```bash
# Start a reasoning sequence
mcp2cli sequential-thinking think --thought "Break down the problem into components" --thought-number 1 --total-thoughts 5 --next-thought-needed true

# Continue with next thought
mcp2cli sequential-thinking think --thought "Evaluate approach A vs approach B" --thought-number 2 --total-thoughts 5 --next-thought-needed true

# Final concluding thought
mcp2cli sequential-thinking think --thought "Based on analysis, the optimal solution is X" --thought-number 5 --total-thoughts 5 --next-thought-needed false
```

Also supports: `--is-revision`, `--revises-thought`, `--branch-from-thought`, `--branch-id`, `--needs-more-thoughts`

Use `mcp2cli sequential-thinking think --help` for full parameter details.
