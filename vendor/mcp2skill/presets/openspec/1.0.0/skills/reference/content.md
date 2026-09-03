# Content Commands

## list — List changes or specs

```bash
mcp2cli openspec content list
mcp2cli openspec content list --specs
```

Also supports: `--specs`, `--json`

## show — Show details of a change or spec

```bash
mcp2cli openspec content show --item-name add-dark-mode
mcp2cli openspec content show --item-name my-api-spec --type spec
```

Also supports: `--type`, `--json`

## read-file — Read any OpenSpec artifact file directly

Faster than `show` when you need file contents.

```bash
mcp2cli openspec content read-file --name add-dark-mode --file-type design.md
mcp2cli openspec content read-file --name add-dark-mode --file-type proposal.md
mcp2cli openspec content read-file --name add-dark-mode --file-type tasks.md --type change
```

Available `--file-type` values: `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`

Also supports: `--type` (change|spec, to disambiguate if names conflict)

## validate — Validate a change proposal or spec

```bash
mcp2cli openspec content validate
mcp2cli openspec content validate --item-name add-dark-mode
mcp2cli openspec content validate --all --strict
```

Also supports: `--item-name`, `--all`, `--strict`, `--json`

Use `mcp2cli openspec content <cmd> --help` for full parameter details.
