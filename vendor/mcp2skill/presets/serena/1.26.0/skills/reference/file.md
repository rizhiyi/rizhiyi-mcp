# File Commands

## get — Read a file or chunk

```bash
# Read entire file
mcp2cli serena file get --relative-path src/main.py

# Read specific lines
mcp2cli serena file get --relative-path src/main.py --start-line 10 --end-line 50
```

Also supports: `--max-answer-chars`

## create — Create or overwrite a text file

```bash
mcp2cli serena file create --relative-path src/new_file.py --content 'print("hello")'
```

## list — List files and directories

```bash
# List project root
mcp2cli serena file list --relative-path . --recursive false

# List recursively
mcp2cli serena file list --relative-path src --recursive true
```

Also supports: `--skip-ignored-files`, `--max-answer-chars`

## find — Find files by name mask

```bash
# Find all Python files in src/
mcp2cli serena file find --file-mask '*.py' --relative-path src

# Find from project root
mcp2cli serena file find --file-mask '*.ts' --relative-path .
```

## replace — Replace pattern occurrences in a file

```bash
# Literal replacement
mcp2cli serena file replace --relative-path src/main.py --needle 'old_name' --repl 'new_name' --mode literal

# Regex replacement
mcp2cli serena file replace --relative-path src/main.py --needle 'def old_func.*?return' --repl 'def new_func(): return' --mode regex
```

Also supports: `--allow-multiple-occurrences`

## search — Search regex pattern across codebase

```bash
# Simple substring search
mcp2cli serena file search --substring-pattern 'def my_func'

# Search in specific directory with context
mcp2cli serena file search --substring-pattern 'class Auth' --relative-path src --context-lines-before 2 --context-lines-after 5

# Search only in Python files
mcp2cli serena file search --substring-pattern 'import requests' --paths-include-glob '*.py'
```

Also supports: `--context-lines-before`, `--context-lines-after`, `--paths-include-glob`, `--paths-exclude-glob`, `--relative-path`, `--restrict-search-to-code-files`, `--max-answer-chars`

Use `mcp2cli serena file <action> --help` for full parameter details.
