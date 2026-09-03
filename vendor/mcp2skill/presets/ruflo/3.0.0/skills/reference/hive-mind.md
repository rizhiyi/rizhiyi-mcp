# Hive-Mind Commands

## spawn — Spawn workers and join hive-mind

```bash
mcp2cli ruflo hive-mind spawn --count 3
mcp2cli ruflo hive-mind spawn --count 5 --role specialist --agent-type analyst
```

Also supports: `--count`, `--role`, `--agent-type`, `--prefix` (roles: worker, specialist, scout)

## init — Initialize hive-mind collective

```bash
mcp2cli ruflo hive-mind init
mcp2cli ruflo hive-mind init --topology mesh --queen-id queen-1
```

Also supports: `--topology`, `--queen-id` (topologies: mesh, hierarchical, ring, star)

## status — Get hive-mind status

```bash
mcp2cli ruflo hive-mind status
mcp2cli ruflo hive-mind status --verbose true
```

## join — Join an agent to the hive-mind

```bash
mcp2cli ruflo hive-mind join --agent-id agent-1
mcp2cli ruflo hive-mind join --agent-id agent-2 --role specialist
```

Also supports: `--role`

## leave — Remove agent from hive-mind

```bash
mcp2cli ruflo hive-mind leave --agent-id agent-1
```

## consensus — Propose or vote on consensus

```bash
mcp2cli ruflo hive-mind consensus --action propose --type config-update --value '{"timeout": 30}'
mcp2cli ruflo hive-mind consensus --action vote --proposal-id p1 --vote true --voter-id agent-1
mcp2cli ruflo hive-mind consensus --action status --proposal-id p1
```

Also supports: `--strategy`, `--quorum-preset`, `--term`, `--timeout-ms` (strategies: bft, raft, quorum)

## broadcast — Broadcast to all workers

```bash
mcp2cli ruflo hive-mind broadcast --message "Start phase 2"
mcp2cli ruflo hive-mind broadcast --message "Critical: abort" --priority critical
```

Also supports: `--priority`, `--from-id`

## memory — Access hive shared memory

```bash
mcp2cli ruflo hive-mind memory --action set --key shared-state --value '{"phase": 2}'
mcp2cli ruflo hive-mind memory --action get --key shared-state
mcp2cli ruflo hive-mind memory --action list
```

## shutdown — Shutdown hive-mind

```bash
mcp2cli ruflo hive-mind shutdown
mcp2cli ruflo hive-mind shutdown --graceful false --force true
```

Use `mcp2cli ruflo hive-mind <action> --help` for full parameter details.
