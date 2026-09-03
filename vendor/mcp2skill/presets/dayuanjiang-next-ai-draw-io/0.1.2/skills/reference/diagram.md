# Diagram Commands

## create — Create a new diagram from mxGraphModel XML

```bash
# Create a simple diagram with one shape
mcp2cli diagram create --xml '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Shape" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'

# Create a flowchart with two nodes and an edge
mcp2cli diagram create --xml '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Start" style="ellipse;rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="3" value="End" style="ellipse;rounded=1;" vertex="1" parent="1"><mxGeometry x="300" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="4" style="endArrow=classic;" edge="1" source="2" target="3" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>'
```

⚠️ `--xml` is always required. Use for new diagrams or full replacements (not incremental edits).

## get — Get current diagram XML from browser

```bash
mcp2cli diagram get
```

Returns the current mxGraphModel XML including any manual user edits. Call this **before** `diagram edit` to see current cell IDs and structure.

## edit — Edit diagram using ID-based cell operations

```bash
# Add a new cell
mcp2cli diagram edit --operations '[{"operation":"add","cell_id":"rect-1","new_xml":"<mxCell id=\"rect-1\" value=\"Hello\" style=\"rounded=0;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"100\" y=\"100\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>"}]'

# Update an existing cell label and style
mcp2cli diagram edit --operations '[{"operation":"update","cell_id":"2","new_xml":"<mxCell id=\"2\" value=\"Updated\" style=\"rounded=1;fillColor=#dae8fc;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"100\" y=\"100\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>"}]'

# Delete a cell
mcp2cli diagram edit --operations '[{"operation":"delete","cell_id":"rect-1"}]'

# Multiple operations at once
mcp2cli diagram edit --operations '[{"operation":"add","cell_id":"n1","new_xml":"..."},{"operation":"delete","cell_id":"old-1"}]'
```

⚠️ Always call `diagram get` first to retrieve current cell IDs.

Operation types: `add`, `update`, `delete`. Each requires `operation` and `cell_id`; `add`/`update` also require `new_xml`.

## export — Export diagram to a file

```bash
# Export as PNG
mcp2cli diagram export --path ./diagram.png

# Export as SVG
mcp2cli diagram export --path ./diagram.svg

# Export as draw.io XML
mcp2cli diagram export --path ./diagram.drawio
```

Also supports: `--format` (drawio|png|svg, auto-detected from file extension if omitted)

Use `mcp2cli diagram <action> --help` for full parameter details.
