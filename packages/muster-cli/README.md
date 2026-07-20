# muster-cli

Terminal control for [Muster](https://github.com/berwinsingh/muster) — the
VS Code/Cursor extension that turns your dev servers into named, one-click
groups. This package is the `muster` command: a full-screen dashboard and a
set of plain commands, both driving the extension over its local API.

**Requires VS Code or Cursor open with the Muster extension installed and
active in your project** — this CLI is a client, not a standalone process
manager. Install the extension first: search "Muster" in the Marketplace or
Open VSX, or see the [main repo](https://github.com/berwinsingh/muster).

## Install

```bash
npm install -g muster-cli
```

## Use

```bash
muster              # interactive dashboard — hotkeys, mouse, or press :
                     # and type what you want ("stop web")
muster ls            # groups, services, ports, live status (--json for scripts)
muster run full-stack
muster stop full-stack api      # stop just one service
muster logs full-stack api -f   # follow one service's output
```

## Registering the MCP server (AI agents)

This package also installs `muster-mcp`, so terminal agents can control your
groups too — scoped to config-defined IDs only, no arbitrary shell:

```bash
claude mcp add muster -- muster-mcp
codex mcp add muster -- muster-mcp
```

Full docs, config reference, and the VS Code extension:
[github.com/berwinsingh/muster](https://github.com/berwinsingh/muster)
