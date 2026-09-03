# Config Commands

## get — Get a configuration value

```bash
mcp2cli ruflo config get --key model.default
mcp2cli ruflo config get --key memory.namespace --scope project
```

Also supports: `--scope` (scopes: project, user, system)

## update — Set a configuration value

```bash
mcp2cli ruflo config update --key model.default --value sonnet
mcp2cli ruflo config update --key memory.ttl --value 3600 --scope project
```

Also supports: `--scope`

## list — List all configuration values

```bash
mcp2cli ruflo config list
mcp2cli ruflo config list --scope project --prefix model
```

Also supports: `--scope`, `--prefix`, `--include-defaults`

## reset — Reset configuration to defaults

```bash
mcp2cli ruflo config reset
mcp2cli ruflo config reset --key model.default --scope project
```

Also supports: `--scope`, `--key`

## download — Export configuration to JSON

```bash
mcp2cli ruflo config download
mcp2cli ruflo config download --scope project --include-defaults true
```

Also supports: `--scope`, `--include-defaults`

## upload — Import configuration from JSON

```bash
mcp2cli ruflo config upload --config '{"model": {"default": "sonnet"}}'
mcp2cli ruflo config upload --config '{"memory": {"ttl": 3600}}' --merge true
```

Also supports: `--scope`, `--merge`

Use `mcp2cli ruflo config <action> --help` for full parameter details.
