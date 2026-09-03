# Hyper3D Commands

## hyper3d status — Check Hyper3D Rodin integration status

```bash
mcp2cli blender hyper3d status
```

## hyper3d model generate-from-text — Generate 3D model from text description

```bash
mcp2cli blender hyper3d model generate-from-text --text-prompt 'a wooden barrel'
mcp2cli blender hyper3d model generate-from-text --text-prompt 'medieval castle tower'
mcp2cli blender hyper3d model generate-from-text --text-prompt 'sports car' --bbox-condition '[2.0, 1.0, 1.0]'
```

Also supports: `--bbox-condition` (list of 3 floats for [Length, Width, Height] ratio), `--user-prompt`

> Returns a task_uuid (MAIN_SITE mode) or request_id (FAL_AI mode) — use with `hyper3d job poll` and `hyper3d model import`.

## hyper3d model generate-from-images — Generate 3D model from reference images

```bash
mcp2cli blender hyper3d model generate-from-images --input-image-paths '["/path/to/image.jpg"]'
mcp2cli blender hyper3d model generate-from-images --input-image-urls '["https://example.com/image.jpg"]'
```

Also supports: `--bbox-condition`, `--user-prompt`

> Use `--input-image-paths` for MAIN_SITE mode, `--input-image-urls` for FAL_AI mode.

## hyper3d job poll — Poll Hyper3D generation job status

```bash
mcp2cli blender hyper3d job poll --subscription-key <key>
mcp2cli blender hyper3d job poll --request-id <id>
```

> Poll until status is "Done" (MAIN_SITE) or "COMPLETED" (FAL_AI).

## hyper3d model import — Import completed Hyper3D asset

```bash
mcp2cli blender hyper3d model import --name MyModel --task-uuid abc123
mcp2cli blender hyper3d model import --name SpaceShip --request-id req456
```

Also supports: `--task-uuid` (MAIN_SITE), `--request-id` (FAL_AI)

Use `mcp2cli blender hyper3d <action> --help` for full parameter details.
