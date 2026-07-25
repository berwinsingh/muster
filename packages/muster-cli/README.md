# muster-cli

Terminal control for [Muster](https://github.com/berwinsingh/muster) — named,
one-command dev server groups defined in `.vscode/muster.json`. This package
is the `muster` command: a full-screen dashboard, a standalone process
supervisor, and a set of plain commands.

**No VS Code required.** `muster up` runs your groups right in the terminal,
and every config command (`init`/`create`/`add`/`edit`/`delete`/`detect`)
edits `.vscode/muster.json` directly. When VS Code or Cursor *is* open with
the [Muster extension](https://github.com/berwinsingh/muster), the same
commands drive the extension instead, and `muster run`/`stop`/`logs` control
the servers running in your editor terminals.

## Install

```bash
npm install -g muster-cli
```

## Run your groups — no VS Code

```bash
muster                            # THE dashboard. No config yet? A short
                                  # wizard creates your first group, then
                                  # you land in the dashboard with it running.
muster up backend                 # or run one group immediately
muster up backend --plain         # flat interleaved logs (auto when piped)
```

`muster up` detects each service's environment automatically: Python venvs
(`.venv`/`venv`/`env`) are activated, `.nvmrc` pins are applied through nvm
(best-effort — falls back to your PATH node with a note), and services that
need neither run as-is. `--no-detect` turns this off.

## Configure groups from the terminal

```bash
muster create backend --command "uvicorn main:app" --service api \
       --cwd '${workspaceFolder}/server' --port 8000     # venv auto-detected
muster add backend web --command "pnpm dev" --port 3000  # .nvmrc auto-detected
muster edit backend --label "Full Stack" --order sequence
muster edit backend api --port 8080 --venv .venv
muster delete backend web
muster detect                     # audit every service's environment
muster ls                         # groups + services (+ live status via VS Code)
```

## Dashboard & logs

`muster` (VS Code running) or `muster up` (standalone) open the same
dashboard: `r` run · `s` stop · `x` restart · `l` logs · `a` all-services
logs · `/` filter · `:` command palette ("stop web") · mouse works too.

The log view filters like a real log tool: `v` cycles severity
(all → errors → warnings → info), `tab` cycles service focus in the
combined view, `/` adds a text filter — all three compose.

```bash
muster logs backend api -f --level error   # follow one service, errors only
muster logs backend --level warn           # whole group, tagged [service]
```

## Registering the MCP server (AI agents)

This package also installs `muster-mcp`, so terminal agents can control your
groups too — scoped to config-defined IDs only, no arbitrary shell. Agents
get `get_service_logs` with severity/substring filters, so they can pull
exactly "the errors from api" instead of dumping everything:

```bash
claude mcp add muster -- muster-mcp
codex mcp add muster -- muster-mcp
```

Full docs, config reference, and the VS Code extension:
[github.com/berwinsingh/muster](https://github.com/berwinsingh/muster)
