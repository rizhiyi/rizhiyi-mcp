# File Commands

## get — Read text file contents

```bash
# Read a full file
mcp2cli filesystem file get --path /path/to/file.txt

# Read only the first 50 lines
mcp2cli filesystem file get --path /path/to/file.txt --head 50

# Read only the last 20 lines
mcp2cli filesystem file get --path /path/to/file.txt --tail 20
```

Also supports: `--head`, `--tail`

## write — Create or overwrite a file

```bash
mcp2cli filesystem file write --path /path/to/file.txt --content 'Hello World'
```

## edit — Make line-based edits to a file

```bash
# Replace specific text
mcp2cli filesystem file edit --path /path/to/file.txt --edits '[{"oldText":"foo","newText":"bar"}]'

# Preview changes without applying (dry run)
mcp2cli filesystem file edit --path /path/to/file.txt --edits '[{"oldText":"foo","newText":"bar"}]' --dry-run true
```

Also supports: `--dry-run`

## search — Search files by glob pattern

```bash
# Find all Python files recursively
mcp2cli filesystem file search --path /project --pattern '**/*.py'

# Find files in current directory only
mcp2cli filesystem file search --path /project --pattern '*.txt'
```

Also supports: `--exclude-patterns`

## get-multiple — Read multiple files at once

```bash
mcp2cli filesystem file get-multiple --paths '["file1.txt","file2.txt","/abs/path/file3.txt"]'
```

## get-media — Read image or audio file as base64

```bash
mcp2cli filesystem file get-media --path /path/to/image.png
```

## move — Move or rename a file or directory

```bash
# Move file to another directory
mcp2cli filesystem file move --source /old/path/file.txt --destination /new/path/file.txt

# Rename a file in place
mcp2cli filesystem file move --source /path/old-name.txt --destination /path/new-name.txt
```

## info — Get detailed file metadata

```bash
mcp2cli filesystem file info --path /path/to/file.txt
```

## read — Read file (deprecated)

```bash
# Prefer file get instead
mcp2cli filesystem file read --path /path/to/file.txt
```

Also supports: `--head`, `--tail`

Use `mcp2cli filesystem file <action> --help` for full parameter details.
