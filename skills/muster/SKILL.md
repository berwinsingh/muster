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
5. Use `stop_server_group` or `restart_server_group` when needed

## Tool reference

### Read-only (no confirmation)

```
list_server_groups()
get_group_status({ "groupId": "full-stack" })
describe_config()
```

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

If no config exists, create `.vscode/muster.json`:

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
