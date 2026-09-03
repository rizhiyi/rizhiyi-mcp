# Sketchfab Commands

## sketchfab status — Check Sketchfab integration status

```bash
mcp2cli blender sketchfab status
```

## sketchfab model search — Search for Sketchfab models

```bash
mcp2cli blender sketchfab model search --query 'wooden chair'
mcp2cli blender sketchfab model search --query 'sci-fi spaceship' --count 10
mcp2cli blender sketchfab model search --query 'tree' --categories 'nature,plants'
```

Also supports: `--categories`, `--count`, `--downloadable`, `--user-prompt`

## sketchfab model preview — Preview model thumbnail

```bash
mcp2cli blender sketchfab model preview --uid abc123def456
```

Also supports: `--user-prompt`

> Use to visually confirm a model before downloading.

## sketchfab model download — Download and import a Sketchfab model

```bash
mcp2cli blender sketchfab model download --uid abc123def456 --target-size 1.0
mcp2cli blender sketchfab model download --uid abc123def456 --target-size 0.1
mcp2cli blender sketchfab model download --uid abc123def456 --target-size 4.5
```

Also supports: `--user-prompt`

> `--target-size` is in Blender units (meters). Examples: chair=1.0, car=4.5, cup=0.15.

Use `mcp2cli blender sketchfab model <action> --help` for full parameter details.
