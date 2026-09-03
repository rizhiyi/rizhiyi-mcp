# Diagram Commands

## create — Create a new diagram from mxGraphModel XML

Use when creating a diagram from scratch or replacing the current diagram entirely.

```bash
# Create a simple diagram with one shape
mcp2cli drawio diagram create --xml '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Hello" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'

# Create a diagram with connected shapes
mcp2cli drawio diagram create --xml '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Start" style="ellipse;fillColor=#d5e8d4;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="3" value="End" style="ellipse;fillColor=#f8cecc;" vertex="1" parent="1"><mxGeometry x="280" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="4" edge="1" source="2" target="3" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>'
```

No optional parameters.

## get — Get the current diagram XML

Fetches the latest XML from the browser, including any manual user edits.

```bash
mcp2cli drawio diagram get
```

> **Important**: Always call this BEFORE `diagram edit` to see current cell IDs and structure.

No parameters required.

## edit — Edit diagram by ID-based cell operations

⚠️ **Call `diagram get` BEFORE this command** to avoid overwriting manual user edits.

Supports three operations: `add`, `update`, `delete`.

```bash
# Add a new cell
mcp2cli drawio diagram edit --operations '[{"operation": "add", "cell_id": "rect-1", "new_xml": "<mxCell id=\"rect-1\" value=\"New Box\" style=\"rounded=0;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"100\" y=\"200\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>"}]'

# Update an existing cell label
mcp2cli drawio diagram edit --operations '[{"operation": "update", "cell_id": "2", "new_xml": "<mxCell id=\"2\" value=\"Updated Label\" style=\"rounded=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"100\" y=\"100\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>"}]'

# Delete a cell
mcp2cli drawio diagram edit --operations '[{"operation": "delete", "cell_id": "rect-1"}]'
```

Operations array items:
- `operation` (required): `add` | `update` | `delete`
- `cell_id` (required): The mxCell id to target
- `new_xml` (required for add/update): Complete mxCell XML element including mxGeometry

## export — Export the current diagram to a file

Supports `.drawio` (XML), `.png`, and `.svg` formats.

```bash
# Export as PNG
mcp2cli drawio diagram export --path ./diagram.png

# Export as SVG
mcp2cli drawio diagram export --path ./diagram.svg

# Export as drawio XML
mcp2cli drawio diagram export --path ./diagram.drawio
```

Also supports: `--format` (drawio|png|svg, auto-detected from file extension if omitted)

Use `mcp2cli drawio diagram <action> --help` for full parameter details.
