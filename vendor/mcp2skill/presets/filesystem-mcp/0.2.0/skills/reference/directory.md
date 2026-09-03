# Directory Commands

## create — Create a directory

```bash
# Create a single directory
mcp2cli filesystem directory create --path /new/dir

# Create nested directories in one operation
mcp2cli filesystem directory create --path /new/deep/nested/dir
```

## list — List directory contents

```bash
mcp2cli filesystem directory list --path /project
```

## list-sizes — List with size information

```bash
# List sorted by name (default)
mcp2cli filesystem directory list-sizes --path /project

# List sorted by size
mcp2cli filesystem directory list-sizes --path /project --sort-by size
```

Also supports: `--sort-by` (name|size)

## tree — Get recursive directory tree

```bash
# Full tree view
mcp2cli filesystem directory tree --path /project

# Exclude certain patterns
mcp2cli filesystem directory tree --path /project --exclude-patterns '["node_modules","__pycache__"]'
```

Also supports: `--exclude-patterns`

## list-allowed — List accessible directories

```bash
mcp2cli filesystem directory list-allowed
```

Use `mcp2cli filesystem directory <action> --help` for full parameter details.
