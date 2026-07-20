# Muster Features

**One click. Full stack running.**

Muster is a VS Code extension for orchestrating dev server groups — configure once, run everything with a single click, and monitor output from one place. For setup and quick start, see [README.md](README.md).

---

## Feature overview

| Category | Feature | Description |
|----------|---------|-------------|
| **Core** | Server groups | Organize related services (API, frontend, workers) into named groups with labels and IDs |
| **Core** | One-click run / stop / restart | Start, stop, or restart entire groups from the tree view, status bar, command palette, or MCP |
| **Core** | Visual configuration wizard | Webview editor for groups and services — no manual JSON required (v0.1.3 redesign) |
| **Core** | Terminal layouts | `dedicated` (one terminal per service), `aggregated` (single terminal), or `split` (split panes) |
| **Core** | Start order | `parallel` or `sequence` with per-service `dependsOn` and `delayMs` |
| **Core** | Ready detection | Wait for `readyPattern` regex in terminal output or `healthUrl` HTTP check before proceeding |
| **Core** | Stacked commands | `commands: [...]` list per service, chained with `&&` — no more cramming setup steps into one string |
| **Core** | Ports | First-class `port` field: injected as `PORT` env var, `${port}` substitution in command/healthUrl, and a pre-launch warning when the port is already taken |
| **Core** | Lifecycle hooks | Group `hooks.preRun` / `hooks.postStop` commands (VPN connect, `docker compose up`, migrations) — preRun failures abort the run |
| **Runtime** | Python venv | Explicit `python.venv` activation; wizard auto-suggestion is opt-in via `muster.autoRuntimeDetection` |
| **Runtime** | Node / nvm | Explicit `node.version` prepends `nvm use`; `.nvmrc`/engines auto-detection is opt-in via `muster.autoRuntimeDetection` (off by default) |
| **Runtime** | Shell prepend | Custom `shell.prepend` commands run before the main command (venv, nvm, etc.) |
| **Runtime** | Command suggestions | Scan `package.json`, `Makefile`, `pyproject.toml`, and `go.mod` for dev commands |
| **Runtime** | Variable substitution | `${workspaceFolder}`, `${workspaceFolderBasename}`, and `${env:VAR}` in paths and commands |
| **Config** | Workspace config | `.vscode/muster.json` — commit-friendly, per-project server definitions |
| **Config** | Global profiles | `~/.config/muster/profiles.json` — reusable groups across workspaces |
| **Config** | Profile extension | `extends` field to inherit a named global profile in workspace config |
| **Config** | Auto IDs | Wizard generates slugified IDs with short UUID suffixes for new groups and services |
| **Config** | Import example | One-click starter config with sample API + frontend services |
| **Monitoring** | Event tracking | Capture errors, warnings, and info from terminal output and VS Code diagnostics |
| **Monitoring** | Configurable patterns | Custom regex patterns with severity, category, and source (`terminal` / `diagnostics`) |
| **Monitoring** | Date filtering | Today, 3 days, configurable max (default 7 days, up to 7), or all events |
| **Monitoring** | Severity filters | Filter by error, warning, info, or all |
| **Monitoring** | Group / service filters | Narrow events to a specific group or service |
| **Monitoring** | Category filters | Filter by optional pattern `category` tags |
| **Monitoring** | Click-to-navigate | Click an event to reveal its terminal or jump to the diagnostic in the editor |
| **UI** | Activity Bar | Dedicated Muster sidebar with Server Groups and Events views |
| **UI** | Status bar | Quick run/stop toggle for the default or last-used group with live state |
| **UI** | Welcome view | Onboarding buttons: Create Group, Import Example, Open Visual Editor |
| **UI** | Config wizard v0.1.3 | Redesigned visual editor with runtime detection, folder pickers, and Save & Run |
| **UI** | Events timeline panel | Webview sidebar with segmented filters, chips, and scrollable event timeline |
| **UI** | `muster` CLI + TUI | Full dashboard in any terminal: hotkeys, mouse (click rows/buttons, scroll), and a fuzzy command palette (`:` → "stop web"); per-service run/stop/restart; log follow + filter; `--json` for scripts |
| **Security** | Trust gate | Run/stop/restart blocked in untrusted workspaces until the user trusts the folder |
| **Security** | Config-only commands | Only commands defined in Muster config can be executed — no arbitrary shell |
| **Security** | Non-destructive | `keepExistingTerminals` (default true) preserves unrelated terminals; only tracked processes are stopped |

---

## The `muster` CLI

Control groups from any terminal while VS Code (or Cursor) is open with the
extension active. The CLI connects through the same localhost IPC + discovery
mechanism as the MCP server, so trust checks apply and everything stays
visible in VS Code terminals.

**Getting it on your PATH** — three ways, pick whichever fits:

| Way | Command | Notes |
|-----|---------|-------|
| npm (recommended) | `npm install -g muster-cli` | npm's own bin-linking puts `muster` and `muster-mcp` on PATH; nothing else to configure |
| Automatic prompt | — | Muster offers once, the first time it activates in a workspace with a config and the CLI isn't already reachable — click **Install** in the notification |
| Command | `Muster: Install 'muster' Command in PATH` | From the Command Palette anytime (same mechanism as VS Code's own `code` installer); writes wrappers to `/usr/local/bin` or `~/.local/bin`, with a copyable PATH line if needed |

The npm package (`packages/muster-cli` in this repo) ships the same
compiled CLI as a small, independent package — see
[PUBLISHING.md](PUBLISHING.md#npm-npm-install--g-muster-cli) for how it's
built and published. Building from a checkout instead: `npm link`, or
`node bin/muster.cjs` directly (it also finds the CLI inside an installed
extension).

### Commands

| Command | What it does |
|---------|--------------|
| `muster` | Interactive dashboard (TUI) |
| `muster ls [--json]` | Groups, services, ports, and live status |
| `muster run <group> [service]` | Start a group (or one service), wait for readiness, report `N/N running` |
| `muster stop <group> [service]` | Stop a group or a single service |
| `muster restart <group> [service]` | Restart a group or a single service |
| `muster status <group>` | Per-service status |
| `muster logs <group> <service> [-n N] [-f]` | Show or follow service output |
| `muster init` | Scaffold a starter `.vscode/muster.json` |
| `muster create <group> --command "…"` | Create a group with a first service (`--label --service --name --cwd --port --layout --order`) |
| `muster add <group> <service> --command "…"` | Add a service to a group (`--name --cwd --port`) |
| `muster delete <group> [service]` | Remove a group, or one service |

Config writes route through the running extension, so the sidebar tree
updates live and the same schema validation applies. In the tree itself,
group and service rows now have **Delete** in their right-click menu,
alongside run/stop/restart/edit.

### The dashboard

Three ways to operate it:

| Mode | How |
|------|-----|
| **Hotkeys** | `↑↓` select · `r` run · `s` stop · `x` restart (acts on the selected group *or* service) · `l` logs · `/` filter · `q` quit |
| **Mouse** | Click a row to select, click the selected service again to open its logs, click the footer buttons, scroll wheel to move/scroll |
| **Command palette** | `:` opens a fuzzy-matched list of every live action — type `stop web` to match `stop full-stack/web`, arrows choose, enter runs |

The log view follows output live (`f` toggles), scrolls with `↑↓`/wheel, and
filters with `/` — matching lines only, with a no-match indicator.

---

## 🤖 AI / Agent Integration

Muster exposes a native **MCP server** so AI agents in Cursor (and other MCP clients) can discover, start, stop, and monitor server groups — without bypassing VS Code security.

| Capability | Details |
|------------|---------|
| **MCP server** | Registered via `vscode.lm.registerMcpServerDefinitionProvider`; stdio transport to `dist/mcp/server.js` |
| **Scoped access** | Agents can only act on group/service IDs defined in config; unknown IDs are rejected |
| **Confirmation gate** | Every agent-initiated run/stop/restart pops a modal in VS Code — the action waits until you Allow it. Off switch: `muster.confirmAgentActions`. The muster CLI and sidebar are direct user intent and are never gated |
| **Cursor skill** | `skills/muster/SKILL.md` guides agents through the correct tool workflow |
| **IPC bridge** | Extension hosts a localhost IPC server; MCP tools proxy through it for live status and control |
| **MCP prompts** | `muster/start` and `muster/status` for common agent workflows |
| **MCP resources** | `muster://config/workspace` (live config summary) and `muster://logs/{groupId}/{serviceId}` (recent output) |

### Example agent workflow

1. Agent calls `describe_config` to locate workspace and profile paths
2. Agent calls `list_server_groups` to discover available groups
3. Agent calls `run_server_group({ "groupId": "dev" })` — user confirms in VS Code
4. Agent polls `get_group_status` until services reach `running`
5. Agent reads logs via `muster://logs/dev/api` resource if errors appear
6. Agent calls `stop_server_group` or `restart_server_group` when done

---

## AI Features

Detailed reference for MCP tools exposed to agents.

| Tool | Access | Confirmation | Description |
|------|--------|--------------|-------------|
| `list_server_groups` | Read-only | None | List all merged groups and their services |
| `get_group_status` | Read-only | None | Get per-service status (`idle`, `starting`, `running`, `failed`, `stopped`) and group state |
| `describe_config` | Read-only | None | Return config file paths, schema location, and IPC port |
| `run_server_group` | Write | **User confirmation required** | Start all services in a group |
| `stop_server_group` | Write | **User confirmation required** | Stop all services in a group |
| `restart_server_group` | Write | **User confirmation required** | Restart all services in a group |

### MCP resources (read-only)

| Resource URI | Description |
|--------------|-------------|
| `muster://config/workspace` | Live workspace config paths and merged groups summary |
| `muster://logs/{groupId}/{serviceId}` | Recent terminal output for a service (default 50 lines) |

### MCP prompts

| Prompt | Description |
|--------|-------------|
| `muster/start` | Start the dev stack group best suited for this workspace |
| `muster/status` | Show which Muster services are currently running |

### Cursor skill

Install or reference `skills/muster/SKILL.md` so agents:

- Use Muster MCP tools instead of arbitrary shell commands
- Follow the read → run → poll → stop workflow
- Respect workspace trust and config-defined IDs only

### Client setup

**Prerequisite for every client below:** VS Code (or Cursor) must be open
with the Muster extension activated — tool calls proxy through the running
extension via a localhost IPC endpoint written to `~/.config/muster/ipc/`
on startup, so trust checks and run confirmations still apply. Stale
endpoints from crashed sessions are detected and cleaned automatically.

Two ways to register `muster-mcp` as the server command, in order of
least setup:

1. **`npm install -g muster-cli`** puts a `muster-mcp` binary directly on
   PATH — the client config below can just say `muster-mcp`, no path to
   remember.
2. **`bin/muster-mcp.cjs`** from a repo checkout is the universal
   launcher: it finds the compiled MCP server automatically — an explicit
   `MUSTER_MCP_SERVER` env var, a local repo build (`dist/mcp/server.js`),
   or the newest installed Muster extension under `~/.vscode/extensions`,
   `~/.vscode-insiders/extensions`, `~/.cursor/extensions`, or
   `~/.windsurf/extensions`.

#### Claude Code

Easiest — install the repo as a plugin (registers the MCP server *and* the
agent skill in one step). In a Claude Code session:

```
/plugin marketplace add berwinsingh/muster
/plugin install muster@muster
```

Or register the MCP server directly:

```bash
claude mcp add muster -- muster-mcp                              # after npm install -g muster-cli
claude mcp add muster -- node /path/to/muster/bin/muster-mcp.cjs # from a repo checkout
```

Verify with `/mcp` in a Claude Code session — the `muster` server should
list six tools.

#### Codex CLI

```bash
codex mcp add muster -- muster-mcp                              # after npm install -g muster-cli
codex mcp add muster -- node /path/to/muster/bin/muster-mcp.cjs # from a repo checkout
```

Or add to `~/.codex/config.toml` directly:

```toml
[mcp_servers.muster]
command = "muster-mcp"
```

Verify with `/mcp` inside a Codex session.

#### Cursor

Cursor's agent runs inside the editor, so with the Muster extension
installed the stack is already local — but Cursor does not read VS Code's
MCP provider API, so register the server in `.cursor/mcp.json` (per
project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "muster": {
      "command": "muster-mcp"
    }
  }
}
```

(`command: "muster-mcp"` works after `npm install -g muster-cli`; from a
checkout instead, use `"command": "node", "args": ["/path/to/muster/bin/muster-mcp.cjs"]`.)

Then enable it under Settings → MCP. Point Cursor at
[skills/muster/SKILL.md](skills/muster/SKILL.md) (e.g. from your rules) so
the agent follows the read → run → poll → stop workflow.

#### Troubleshooting

- **"Muster extension IPC not available"** — VS Code/Cursor isn't open, or
  the Muster extension isn't activated in that window. Open the workspace
  and check the Muster icon appears in the Activity Bar, then retry.
- **Launcher exits with "could not find Muster's MCP server"** — install
  the Muster VS Code extension, or build from source
  (`npm install && npm run compile`), or set `MUSTER_MCP_SERVER` to a
  compiled `dist/mcp/server.js`.
- **Wrong workspace answered** — the discovery lookup prefers the workspace
  matching the client's cwd; set `MUSTER_WORKSPACE=/path/to/workspace` on
  the server entry to pin it explicitly.

---

## Related

- [README.md](README.md) — Quick start, visual configuration, and development setup
- [schemas/muster.schema.json](schemas/muster.schema.json) — Full JSON Schema for `muster.json`
- [skills/muster/SKILL.md](skills/muster/SKILL.md) — Agent skill for Cursor and MCP clients
