# Code Commands

## code execute — Execute arbitrary Python code in Blender

```bash
# Add a primitive cube
mcp2cli blender code execute --code 'bpy.ops.mesh.primitive_cube_add()'

# Move an object
mcp2cli blender code execute --code 'bpy.data.objects["Cube"].location = (1, 2, 3)'

# Delete all objects
mcp2cli blender code execute --code 'bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()'
```

Also supports: `--user-prompt`

> Tip: Break complex operations into smaller code chunks for reliability.

Use `mcp2cli blender code execute --help` for full parameter details.
