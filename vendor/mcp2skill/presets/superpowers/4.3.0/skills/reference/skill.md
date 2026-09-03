# Skill Commands

## list — List all available Superpowers skills

```bash
mcp2cli superpowers skill list
```

No additional parameters.

## get — Read full content of a skill by name

```bash
# Read a skill before performing the task it covers
mcp2cli superpowers skill get --skill-name brainstorming

# Load a debugging skill
mcp2cli superpowers skill get --skill-name systematic-debugging

# Load a development workflow skill
mcp2cli superpowers skill get --skill-name test-driven-development
```

Also supports: `--skill-name` (required)

Use `mcp2cli superpowers skill <action> --help` for full parameter details.
