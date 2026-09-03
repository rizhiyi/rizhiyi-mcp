# Swarm Commands

## init — Initialize a swarm

```bash
mcp2cli ruflo swarm init
mcp2cli ruflo swarm init --topology hierarchical --max-agents 10 --strategy specialized
```

Also supports: `--topology`, `--max-agents`, `--strategy`, `--config`
(topologies: hierarchical, mesh, hierarchical-mesh, ring, star, hybrid, adaptive)
(strategies: specialized, balanced, adaptive)

## status — Get swarm status

```bash
mcp2cli ruflo swarm status
mcp2cli ruflo swarm status --swarm-id swarm-1
```

Also supports: `--swarm-id`

## health — Check swarm health

```bash
mcp2cli ruflo swarm health
mcp2cli ruflo swarm health --swarm-id swarm-1
```

## shutdown — Shutdown a swarm

```bash
mcp2cli ruflo swarm shutdown
mcp2cli ruflo swarm shutdown --swarm-id swarm-1 --graceful false
```

Also supports: `--swarm-id`, `--graceful`

Use `mcp2cli ruflo swarm <action> --help` for full parameter details.
