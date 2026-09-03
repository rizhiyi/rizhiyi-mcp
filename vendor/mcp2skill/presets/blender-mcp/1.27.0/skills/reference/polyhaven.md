# PolyHaven Commands

## polyhaven status — Check PolyHaven integration status

```bash
mcp2cli blender polyhaven status
```

## polyhaven category list — List asset categories

```bash
mcp2cli blender polyhaven category list --asset-type textures
mcp2cli blender polyhaven category list --asset-type hdris
```

Also supports: `--user-prompt`
Asset types: `hdris`, `textures`, `models`, `all`

## polyhaven asset search — Search for PolyHaven assets

```bash
mcp2cli blender polyhaven asset search --asset-type textures
mcp2cli blender polyhaven asset search --asset-type hdris --categories 'sky,outdoor'
mcp2cli blender polyhaven asset search --asset-type models --categories 'furniture'
```

Also supports: `--categories`, `--user-prompt`

## polyhaven asset download — Download and import a PolyHaven asset

```bash
mcp2cli blender polyhaven asset download --asset-id venice-sunset --asset-type hdris
mcp2cli blender polyhaven asset download --asset-id wood-plank --asset-type textures --resolution 2k
mcp2cli blender polyhaven asset download --asset-id barrel --asset-type models --resolution 1k --file-format gltf
```

Also supports: `--resolution`, `--file-format`, `--user-prompt`

## polyhaven texture set — Apply a texture to a scene object

```bash
mcp2cli blender polyhaven texture set --object-name Cube --texture-id wood-plank
mcp2cli blender polyhaven texture set --object-name "My Mesh" --texture-id concrete-floor
```

Also supports: `--user-prompt`

> Note: Texture must be downloaded first via `polyhaven asset download`.

Use `mcp2cli blender polyhaven <action> --help` for full parameter details.
