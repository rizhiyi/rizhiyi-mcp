# CLI Command Tree Generation Rules

## Goal

Transform a flat list of MCP server tools into a hierarchical command tree, making command paths intuitive for humans and supporting progressive disclosure.

## Layering Principles

The command tree has at most 4 levels, from top to bottom:

| Level | Meaning | Examples |
|-------|---------|----------|
| Level 1 | Product/Domain | jira, confluence, github |
| Level 2 | Resource Type | issue, page, sprint, board |
| Level 3 | Action Verb | create, get, list, search |
| Level 4 | Only when necessary | Sub-resource operations (rarely used) |

### Layering Decision Rules

1. **Start with the tool name prefix**: Tool names usually contain domain and resource information
   - `jira_create_issue` → jira / issue / create
   - `confluence_get_page` → confluence / page / get
   - `jira_get_sprint_issues` → jira / sprint / issues (or flatten to jira / sprint / list)

2. **Servers with fewer than 5 tools**: Skip Level 1, start directly from the resource level
   - Example: Only `run_query`, `list_tables` → query / run, table / list

3. **Servers with a single tool**: No layering, place directly as a leaf node
   - Example: Only `execute` → directly under commands as execute

4. **Tools that cannot be naturally grouped**: Place into `misc` or `other` group

5. **Fewer than 3 tools in the same domain**: Can skip the resource level, use domain/action directly
   - Example: Only `confluence_search` → confluence / search (no intermediate level needed)

## Action Verb Standards

Leaf node command names (action verbs) should be normalized to the following standard verbs:

| Standard Verb | Use Case | Common Words in Source Tool Names |
|---------------|----------|----------------------------------|
| `create` | Create a new resource | create, add, new, insert |
| `get` | Get details of a single resource | get, fetch, read, show, view |
| `list` | List multiple resources | list, get_all, get_many, fetch_all |
| `search` | Search by criteria | search, query, find, filter |
| `update` | Modify an existing resource | update, edit, modify, set, change |
| `delete` | Delete a resource | delete, remove, destroy, drop |
| `move` | Move/transfer a resource | move, transfer, relocate |
| `download` | Download/export | download, export, dump |
| `upload` | Upload/import | upload, import, attach |
| `link` | Create an association | link, connect, associate, add_to |
| `unlink` | Remove an association | unlink, disconnect, remove_from |
| `transition` | Status transition | transition, change_status |

If a tool's action does not match any of the above verbs, keep its original action name (e.g., `batch-create`, `reply`).

## YAML Format Specification

### File Structure

```yaml
server: <server-name>
version: "<server version from tools JSON; null if not available>"
generated_at: "<ISO 8601 timestamp>"
generated_by: ai

server_aliases:
  - <alias>

command_shortcuts:
  - <shortcut>

commands:
  <group>:
    _description: "<group description>"
    <resource>:
      _description: "<resource description>"
      <action>:
        _tool: <original MCP tool name>
        _description: "<action description>"
        _examples:
          - "<usage example>"
```

### Metadata Field Specification

| Field | Location | Required | Description |
|-------|----------|----------|-------------|
| `version` | Top-level | Yes | Server version from tools/*.json, used to detect server upgrades. `null` if not provided by the server |
| `_tool` | Leaf node | Yes | Original MCP tool name, must exactly match the name in tools/*.json |
| `_description` | All nodes | Yes | Short English description (one sentence, capitalize first letter, no period) |
| `_examples` | Leaf node | Optional | List of usage examples, each being a complete command (with mcp2cli prefix) |

### Key Naming Rules

- Subcommand names (without `_` prefix) use **lowercase letters and hyphens**: `issue`, `page`, `batch-create`
- Do not use underscores (`_` prefix is reserved for metadata)
- Do not use camelCase

## server_aliases Auto-Generation Rules

Generate short aliases for server names. These aliases are used for **install-time resolution** (e.g., `mcp2cli install gitlab` → finds `zereight-gitlab-mcp`). Keep them minimal and meaningful.

1. Extract the **core product name** from the server name:
   - Remove `mcp-` prefix: `mcp-atlassian` → `atlassian`
   - Remove `-mcp` suffix: `atlassian-mcp` → `atlassian`
   - Remove `@scope/` prefix: `@modelcontextprotocol/github` → `github`
   - Remove author/org prefix: `zereight/gitlab-mcp` → `gitlab`, `dayuanjiang-next-ai-draw-io` → `drawio`
2. If the result conflicts with management commands (list, scan, generate, daemon, tools, call, install, convert, remove, update, preset, batch, mcp, skill) → do not generate
3. If the server name is already short (no prefix/suffix to remove) → do not generate aliases
4. Generate at most **1-2 aliases** — only the most recognizable product names

## command_shortcuts Auto-Generation Rules

Register top-level keys under commands as shortcuts **only for multi-product servers** where domain separation is essential. Shortcuts let users skip the server name: `mcp2cli jira ...` instead of `mcp2cli mcp-atlassian jira ...`.

1. **Multi-product servers** (e.g., atlassian has both jira and confluence): top-level command names that are **distinct product/sub-product names** → include (e.g., `jira`, `confluence`)
2. **Single-product servers** (e.g., gitlab-mcp, github-mcp, next-ai-draw-io): all tools belong to one product → `command_shortcuts: []` (empty), even if tools are internally grouped into sub-groups like `diagram` and `session`. Internal groupings are not shortcuts — there is no domain ambiguity to resolve
3. **Must always exclude** — two categories:
   - **Generic resource/domain names**: `issue`, `repo`, `mr`, `pipeline`, `branch`, `commit`, `user`, `group`, `project`, `label`, `wiki`, `namespace`, `event`, `deployment`, `release`, `search`, `list`, `get`, `create`, `run`, etc.
   - **Infrastructure/lifecycle names** (appear in almost any server): `session`, `auth`, `token`, `connection`, `config`, `setting`, `credential`, `workspace`, `context`, `state`, `cache`, etc.
4. **Simple test**: Ask — "Would a gitlab server, a jira server, and a slack server all plausibly have a top-level command with this exact name?" If yes → exclude it. For example, `session` fails this test (any server can have session management) → exclude
5. Conflicts with management commands → exclude

## Description Writing Guidelines

- Language: English
- Intermediate node `_description`: Describe what this group/resource is (noun phrase)
  - Good: `"Issue operations"`, `"Sprint management"`
  - Bad: `"Create and manage issues"`, `"Commands for sprints"`
- Leaf node `_description`: Describe what this action does (verb-led phrase)
  - Good: `"Create a new issue"`, `"Search issues using JQL"`
  - Bad: `"Issue creation"`, `"JQL search"`

## Example Selection Rules

The `_examples` field should contain the most common and representative usage examples. Rules:

1. 0-2 examples per leaf node
2. Only provide examples for **high-frequency operations** (create, search); low-frequency operations may omit examples
3. Examples use the full server name path: `mcp2cli <server> <group> <resource> <action> --arg val`
4. Parameter values should use realistic placeholder values: `--project INFRA`, `--summary "Fix memory leak"`
