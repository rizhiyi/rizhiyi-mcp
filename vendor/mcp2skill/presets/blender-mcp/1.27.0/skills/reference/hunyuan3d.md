# Hunyuan3D Commands

## hunyuan3d status — Check Hunyuan3D integration status

```bash
mcp2cli blender hunyuan3d status
```

## hunyuan3d model generate — Generate 3D model from text or image

```bash
# From text only
mcp2cli blender hunyuan3d model generate --text-prompt 'a ceramic vase'

# From image only
mcp2cli blender hunyuan3d model generate --input-image-url '/path/to/image.jpg'

# From text + image
mcp2cli blender hunyuan3d model generate --text-prompt 'a blue chair' --input-image-url 'https://example.com/chair.jpg'
```

Also supports: `--user-prompt`

> Returns a job_id (format: "job_xxx"). Use `hunyuan3d job poll` to check status.

## hunyuan3d job poll — Poll Hunyuan3D generation job status

```bash
mcp2cli blender hunyuan3d job poll --job-id job_abc123
```

> Poll until status is "DONE". Response includes `ResultFile3Ds` with the ZIP model path.

## hunyuan3d model import — Import completed Hunyuan3D asset

```bash
mcp2cli blender hunyuan3d model import --name MyVase --zip-file-url /path/to/model.zip
```

Use `mcp2cli blender hunyuan3d <action> --help` for full parameter details.
