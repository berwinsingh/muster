---
name: muster
description: >-
  Start, stop, and monitor grouped dev servers (uvicorn, pnpm, celery, go, etc.)
  via the Muster VS Code extension MCP tools. Use when the user asks to run dev
  servers, start the stack, spin up backend/frontend, or manage server groups.
---

# Muster Agent Skill

Use the Muster MCP server tools to orchestrate dev server groups defined in `.vscode/muster.json` and `~/.config/muster/profiles.json`.

## When to use

- User asks to "start the dev stack", "run backend and frontend", "spin up servers"
- User wants to know which services are running
- User asks to stop or restart server groups

## When NOT to use

- Do not use generic `execute_command` or arbitrary shell for server orchestration
- Do not modify `tasks.json` or `launch.json` unless the user explicitly requests it
- Do not suggest commands not defined in Muster config

## Workflow

1. Call `describe_config` to find config paths
2. Call `list_server_groups` to discover available groups
3. Call `run_server_group` with `{ "groupId": "<id>" }` — user must confirm in VS Code
4. Poll `get_group_status` until services are `running`
5. Investigate problems with `get_service_logs` — filter by severity so you
   read only what matters (e.g. `level: "error"`)
6. Use `stop_server_group` or `restart_server_group` when needed

## Tool reference

### Read-only (no confirmation)

```
list_server_groups()
get_group_status({ "groupId": "full-stack" })
describe_config()
get_service_logs({ "groupId": "full-stack", "serviceId": "api", "level": "error" })
get_service_logs({ "groupId": "full-stack", "level": "warn" })       // whole group, lines tagged [service]
get_service_logs({ "groupId": "full-stack", "contains": "port 8000" }) // substring filter
```

`get_service_logs` accepts `lines` (default 100, max 500), `level`
(`all`/`error`/`warn`/`info`), and `contains` (case-insensitive substring);
omit `serviceId` to get every service in the group with `[service]` prefixes.
The response reports `totalLines` vs `matchedLines` so you know how much the
filter removed. Prefer a `level: "error"` call over fetching everything when
diagnosing a failing service.

### Write (requires user confirmation)

```
run_server_group({ "groupId": "full-stack" })
stop_server_group({ "groupId": "full-stack" })
restart_server_group({ "groupId": "full-stack" })
```

## Config locations

| File | Purpose |
|------|---------|
| `.vscode/muster.json` | Workspace server groups (commit to repo) |
| `~/.config/muster/profiles.json` | User-global reusable profiles |
| `schemas/muster.schema.json` | JSON Schema for validation |

## Scaffolding config

If no config exists and the `muster` CLI is installed, prefer it over
hand-writing JSON — it validates, slugifies ids, and auto-detects
environments (Python venvs, `.nvmrc`), and it works with or without VS Code:

```bash
muster init                                      # starter config
muster create dev --command "npm run dev" --service api --port 3000
muster add dev worker --command "celery -A app worker"
muster edit dev api --port 8080
muster detect                                    # audit venv/node environments
```

Otherwise create `.vscode/muster.json` by hand:

```json
{
  "$schema": "../schemas/muster.schema.json",
  "version": "1.0.0",
  "groups": [
    {
      "id": "dev",
      "label": "Dev Stack",
      "layout": "dedicated",
      "order": "parallel",
      "services": [
        {
          "id": "api",
          "name": "API",
          "command": "npm run dev",
          "cwd": "${workspaceFolder}"
        }
      ]
    }
  ]
}
```

## Terminal clients (Claude Code, Codex)

The MCP server proxies to the Muster extension running inside VS Code or
Cursor — the editor must be open with the extension activated for tool calls
to succeed. If a tool call fails with "Muster extension IPC not available",
tell the user to open the workspace in VS Code/Cursor with Muster installed,
then retry — or, when no VS Code is available, suggest `muster up <group>`
in a terminal, which supervises the group standalone with the same config.
Do not fall back to running the service commands yourself in a shell.

Registering the server manually (outside the plugin) — after
`npm install -g muster-cli`, `muster-mcp` is already on PATH:

```
claude mcp add muster -- muster-mcp
codex mcp add muster -- muster-mcp
```

From a repo checkout instead: `claude mcp add muster -- node <path>/bin/muster-mcp.cjs`.

## Fallback: VS Code commands

If MCP is unavailable, ask the user to run:

```
Muster: Run Group
```

Or invoke `muster.runGroup` with `{ "groupId": "full-stack" }` via a generic command bridge.

## Security

- Only use Muster MCP tools — never arbitrary shell execution
- Write tools require workspace trust and user confirmation
- Group and service IDs must exist in config

## Verification

After starting a group, call `get_group_status` and report:

- Group state (`idle`, `starting`, `running`, `partial`, `stopped`, `failed`)
- Per-service status
- Any services still in `starting` after 60s may need investigation
