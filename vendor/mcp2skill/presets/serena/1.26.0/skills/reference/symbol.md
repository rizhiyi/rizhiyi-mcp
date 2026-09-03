# Symbol Commands

## overview — Get high-level symbol overview of a file

```bash
mcp2cli serena symbol overview --relative-path src/main.py

# With child depth
mcp2cli serena symbol overview --relative-path src/main.py --depth 1
```

Also supports: `--depth`, `--max-answer-chars`

## find — Find symbols by name path pattern

```bash
# Find a class
mcp2cli serena symbol find --name-path-pattern MyClass

# Find a method in a class
mcp2cli serena symbol find --name-path-pattern MyClass/my_method

# Find with body included, restricted to a file
mcp2cli serena symbol find --name-path-pattern my_function --relative-path src/utils.py --include-body true
```

Also supports: `--depth`, `--relative-path`, `--include-body`, `--include-info`, `--include-kinds`, `--exclude-kinds`, `--substring-matching`, `--max-matches`, `--max-answer-chars`

## refs — Find symbols referencing a given symbol

```bash
mcp2cli serena symbol refs --name-path MyClass/my_method --relative-path src/main.py
```

Also supports: `--include-kinds`, `--exclude-kinds`, `--max-answer-chars`

## replace — Replace the body of a symbol

```bash
mcp2cli serena symbol replace --name-path MyClass/my_method --relative-path src/main.py --body 'def my_method(self):\n    return 42'
```

## insert-after — Insert content after a symbol definition

```bash
mcp2cli serena symbol insert-after --name-path MyClass/my_method --relative-path src/main.py --body 'def new_method(self):\n    pass'
```

## insert-before — Insert content before a symbol definition

```bash
mcp2cli serena symbol insert-before --name-path MyClass --relative-path src/main.py --body 'import logging\n'
```

## rename — Rename a symbol codebase-wide

```bash
mcp2cli serena symbol rename --name-path MyClass/old_method --relative-path src/main.py --new-name new_method
```

## delete — Delete a symbol if it has no references

```bash
mcp2cli serena symbol delete --name-path-pattern MyClass/unused_method --relative-path src/main.py
```

Use `mcp2cli serena symbol <action> --help` for full parameter details.
