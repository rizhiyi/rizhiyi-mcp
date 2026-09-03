# Project Commands

## activate — Activate a project by name or path

```bash
# Activate by registered name
mcp2cli serena project activate --project my-project

# Activate by path
mcp2cli serena project activate --project /path/to/my/project
```

## check-onboarding — Check if project onboarding was performed

```bash
mcp2cli serena project check-onboarding
```

> Call this before working on a project to verify onboarding status.

## onboarding — Perform project onboarding

```bash
mcp2cli serena project onboarding
```

> Call this if `check-onboarding` indicates onboarding has not been done. Call at most once per conversation.

Use `mcp2cli serena project <action> --help` for full parameter details.
