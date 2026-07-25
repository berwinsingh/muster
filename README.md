# Muster

One-click dev server group orchestration for VS Code with visual configuration and event monitoring.

See [FEATURES.md](FEATURES.md) for the full feature list.

## Quick start (3 clicks)

1. Open the **Muster** icon ($(server-process)) in the **Activity Bar** (left sidebar).
2. In the **Server Groups** panel, click **Create Group** in the welcome area **or** the **+** icon in the panel title bar.
3. Add a service, set its command, click **Save** (or **Save & Run**).

Configuration is stored in `.vscode/muster.json` — you never need to edit JSON manually.

## Where to click (empty workspace)

When no groups exist, the **Server Groups** view shows welcome buttons:

| Location | What to click |
|----------|----------------|
| Welcome area (center of panel) | **Create Group**, **Import Example**, or **Open Visual Editor** |
| **Server Groups** title bar | **+** (Create Group), **pencil** (Configure / visual editor), **refresh** |
| Command Palette (`Ctrl+Shift+P`) | `Muster: Create Group`, `Muster: Configure`, `Muster: Import Example` |

## Visual configuration

Open the visual editor from:

- Activity Bar → Muster → **Configure** (pencil icon) in the **Server Groups** title bar
- Welcome links: **Create Group**, **Import Example**, **Open Visual Editor**
- Right-click a group → **Edit Group**

The visual editor lets you:

- Create, edit, and delete **groups** (id, label, layout, start order)
- Add **services** with folder picker, command field, env file, delay, and dependencies
- Use **command suggestions** scanned from `package.json`, `Makefile`, `pyproject.toml`, and `go.mod`
- **Save** to `.vscode/muster.json` or **Save & Run** the first group
- Open **Advanced: Edit JSON** for raw editing when needed

### Group layouts

| Layout | Behavior |
|--------|----------|
| `dedicated` | One terminal per service |
| `aggregated` | All services in a single terminal |
| `split` | Split-pane terminal layout |

## Server Groups tree

The **Server Groups** view shows configured groups and their services with live status:

- Run / stop / restart groups from inline icons or context menu
- Service nodes show status and error/warning counts from the Events panel
- Edit groups from the context menu

## Events panel

The **Events** sidebar view monitors errors and warnings from:

- **Terminal output** — matched against configurable regex patterns
- **VS Code diagnostics** — when `monitoring.includeDiagnostics` is true

Filter events by:

- Date: Today / Last 7 days / All
- Severity: error / warning / info
- Group and service

Click an event to reveal its terminal or jump to the diagnostic location in the editor.

### Monitoring configuration

Add a `monitoring` section to `.vscode/muster.json`:

```json
{
  "monitoring": {
    "includeDiagnostics": true,
    "patterns": [
      {
        "id": "error",
        "severity": "error",
        "regex": "ERROR|Error:|Traceback",
        "sources": ["terminal"]
      },
      {
        "id": "warning",
        "severity": "warning",
        "regex": "WARN|Warning:",
        "sources": ["terminal"]
      }
    ]
  }
}
```

Default patterns are used when `monitoring` is omitted.

### Service config highlights

```jsonc
{
  "groups": [{
    "id": "full-stack",
    "label": "Full Stack Dev",
    "hooks": { "preRun": ["docker compose up -d db"] },   // lifecycle hooks (VPN, compose, migrations)
    "services": [
      {
        "id": "api",
        "name": "API",
        "command": "uvicorn main:app --port ${port}",
        "port": 8000,                                     // injected as PORT, ${port} substitution,
        "readyPattern": "startup complete"                // pre-launch in-use warning
      },
      {
        "id": "frontend",
        "name": "Web",
        "commands": ["pnpm install", "pnpm dev"],         // stacked commands, chained with &&
        "port": 3000,
        "cwd": "${workspaceFolder}/frontend"
      }
    ]
  }]
}
```

Runtime auto-detection (venv/nvm suggestions in the wizard) is opt-in via the
`muster.autoRuntimeDetection` setting; explicit `python.venv` / `node.version`
config always applies.

## Commands

| Command | Description |
|---------|-------------|
| `Muster: Run Group` | Start all services in a group |
| `Muster: Stop Group` | Stop a running group |
| `Muster: Configure` | Open the visual configuration editor |
| `Muster: Create Group` | Create a new group visually |
| `Muster: Import Example` | Load a starter configuration |
| `Muster: Open Config` | Open raw JSON config |

## CLI

Two modes, one command:

**`muster up` — standalone, no VS Code needed.** Reads `.vscode/muster.json`
(from the current directory or any parent) and runs the group right in your
terminal: same dependency ordering, ready patterns, hooks, and `${...}`
substitution as the extension. In a terminal it opens the **same interactive
dashboard** as remote `muster` — live status dots, per-service logs (`l`),
stop/start/restart one service or the whole group (`s`/`r`/`x`), mouse, the
`:` command palette — fed straight from the local supervisor. Press `l` on
the group row for the muster activity feed. `q` (or Ctrl+C) stops the whole
tree — no orphans. When piped, in CI, or with `--plain`, it streams flat
per-service prefixed logs instead.

```bash
cd my-project
muster up              # dashboard for the first group in the config
muster up full-stack   # or a specific one
muster up --plain      # flat log stream (automatic when piped)
```

`muster up` also detects each service's environment: Python venvs
(`.venv`/`venv`/`env`) are activated automatically, `.nvmrc` node pins are
applied through nvm (best-effort — a machine without nvm or the pinned
version falls back to the PATH node with a visible note), and services that
need neither run untouched. `--no-detect` opts out.

**Config commands work everywhere.** `init`, `create`, `add`, `edit`,
`delete`, `detect`, and `ls` never require VS Code: with the extension
running they route through it (so the sidebar refreshes live); without it
they read and write `.vscode/muster.json` directly, validated by the same
schema.

**Bare `muster` adapts.** With VS Code running it's a remote control for
the extension; without it, the same dashboard opens on your local config —
every group listed idle, `r` to start one, each backed by its own local
supervisor. No config yet? It walks you through creating your first group
(name, services, ports — with environment detection as you type) and drops
you straight into the dashboard.

**Background daemon — groups that outlive the terminal.** `muster daemon
start` puts a small background process in charge of this workspace, so
`run`, `stop`, `restart`, `status`, `logs`, and every MCP tool keep working
after you close the terminal (or VS Code). No editor required.

```bash
muster daemon start          # background, owns this workspace's groups
muster daemon status         # running? on what port?
muster daemon stop           # stops it and everything it's running
muster up web --detach       # start a group straight onto the daemon
```

Add `--allow-agent-actions` to let MCP clients (Claude Code, Codex, …)
start and stop groups without a human confirming each call. It's off by
default — the headless equivalent of the extension's confirmation prompt.

**Lifecycle commands — a remote control for whatever's running.** `run`,
`stop`, `restart`, `status`, and `logs` drive whichever server is reachable:
the daemon above, or the VS Code extension (where groups run in visible
terminals with the trust model applied). A daemon wins when both are up,
since it owns processes that outlive any editor window. Get `muster` on
your PATH however's easiest:

```bash
npm install -g muster-cli
```

That's the whole install — npm's own bin-linking puts `muster` and
`muster-mcp` on PATH with nothing else to configure (verified with an
isolated global install before this was written down anywhere). Two more
ways that need zero npm at all: the extension offers, once, to install
the CLI itself the first time it sees a config in a workspace — click
**Install** in the notification and it's done; or trigger it anytime with
**`Muster: Install 'muster' Command in PATH`** from the Command Palette
(same mechanism VS Code uses for its own `code` command). Prefer building
from a checkout instead: `npm link`, or run `node bin/muster.cjs` directly.

```bash
muster              # interactive TUI dashboard
muster ls           # groups + services + live status (add --json for scripting)
muster run full-stack
muster stop full-stack api        # stop just one service
muster stop full-stack --force    # …and close its terminal (default keeps it)
muster logs full-stack api -f --level error   # follow one service, errors only
muster logs full-stack --level warn           # whole group, lines tagged [service]
muster logs full-stack --grep timeout         # only lines containing "timeout"
```

Errors and warnings are tinted as they stream, and colour turns itself off
automatically when output is piped — `muster ls | grep api` gets clean text,
not escape codes. `NO_COLOR` and `FORCE_COLOR` are both honoured.

Manage config from the terminal too — no need to open the editor (these
work with or without VS Code):

```bash
muster init                                   # scaffold a starter .vscode/muster.json
muster create api --command "npm run dev" --port 4000 --label "API"
muster add api worker --command "node worker.js"   # add a service to a group
muster edit api --label "Backend" --order sequence # change group settings
muster edit api worker --port 5000 --venv .venv    # change service settings
muster delete api worker                      # remove a service
muster delete api                             # remove the whole group
muster detect                                 # audit environments: venv/node
                                              # needed? present? missing?
```

`create` and `add` detect the service's environment as they write it:
a found venv or `.nvmrc` is stored in the config, a Python project with
no venv gets a clear warning, and non-Python/Node commands are left alone.

The dashboard is operated three ways: hotkeys (`r`/`s`/`x` act on the
selected group *or* service, `l` logs, `a` all-services logs, `/` filter),
the mouse (click rows to select, click the footer buttons, scroll wheel),
or the command palette — press `:` and type what you want (`stop web`
fuzzy-matches `stop split-demo/web`, enter runs it). In the sidebar tree,
right-click a group or service for run/stop/edit/**delete**.

The log view filters like a real log tool: `v` cycles severity
(all → errors → warnings → info), `tab` cycles per-service focus in the
combined view, `/` adds a text filter, and all three compose. The same
severity classifier backs `muster logs --level` and the MCP
`get_service_logs` tool, so humans and agents see the same triage.

## Log history

Output is written to `~/.muster/logs/<workspace>/<group>/<service>.log` as
plain, timestamped, greppable text — so a crash you were reading survives
stopping the group, restarting it, and the process that produced it exiting.
Stopping a service **keeps** its terminal and scrollback; restarting keeps
the history too, with a `— restarted —` divider rather than a blank screen.

Each group decides how long to keep it:

```jsonc
{ "id": "web", "logRetention": "7d" }   // default; also "48h", "90m", or
                                        // "none" to keep until you clear it
```

Files rotate as they grow and old generations are never overwritten — the
only thing that removes history is the retention window.

## MCP integration

Muster exposes MCP tools for AI agents to define groups, run/stop services, and read terminal output — including `get_service_logs` with severity (`error`/`warn`/`info`) and substring filters, per service or across a whole group with `[service]` tags, so an agent can pull exactly "the errors from api" instead of dumping every line. `create_server_group` and `add_service_to_group` let an agent set a stack up from a plain-English description; they only write config, so starting anything still goes through the confirmation gate. Existing JSON config and MCP tools remain fully compatible.

Agents inside VS Code and Cursor pick the server up automatically. Terminal agents connect via the launcher:

```bash
claude mcp add muster -- node <path-to-repo>/bin/muster-mcp.cjs
```

The tools reach a standalone `muster daemon` or the VS Code extension,
whichever is running — so an agent can drive your stack with no editor open:

```bash
muster daemon start --allow-agent-actions
```

The repo doubles as a Claude Code plugin — see [FEATURES.md](FEATURES.md#client-setup) for Claude Code, Codex CLI, and Cursor setup, plus troubleshooting.

## Development

```bash
npm install
npm run compile
```

Press F5 in VS Code to launch the Extension Development Host.
