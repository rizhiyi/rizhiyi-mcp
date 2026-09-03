# Scene Commands

## scene get — Get current scene information

```bash
mcp2cli blender scene get --user-prompt 'show me the scene'
mcp2cli blender scene get --user-prompt 'list all objects'
```

## scene object get — Get details about a specific object

```bash
mcp2cli blender scene object get --object-name Cube
mcp2cli blender scene object get --object-name "My Mesh"
```

Also supports: `--user-prompt`

## scene viewport screenshot — Capture viewport screenshot

```bash
mcp2cli blender scene viewport screenshot
mcp2cli blender scene viewport screenshot --max-size 1200
```

Also supports: `--user-prompt`

Use `mcp2cli blender scene <action> --help` for full parameter details.
