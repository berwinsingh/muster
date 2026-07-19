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
| **Runtime** | Python venv | Auto-detect `.venv` / `venv` / `env`; activate before command; browse or create venv from wizard |
| **Runtime** | Node / nvm | Detect `.nvmrc` and `package.json` engines; prepend `nvm use` automatically |
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
| **Security** | Trust gate | Run/stop/restart blocked in untrusted workspaces until the user trusts the folder |
| **Security** | Config-only commands | Only commands defined in Muster config can be executed — no arbitrary shell |
| **Security** | Non-destructive | `keepExistingTerminals` (default true) preserves unrelated terminals; only tracked processes are stopped |

---

## 🤖 AI / Agent Integration

Muster exposes a native **MCP server** so AI agents in Cursor (and other MCP clients) can discover, start, stop, and monitor server groups — without bypassing VS Code security.

| Capability | Details |
|------------|---------|
| **MCP server** | Registered via `vscode.lm.registerMcpServerDefinitionProvider`; stdio transport to `dist/mcp/server.js` |
| **Scoped access** | Agents can only act on group/service IDs defined in config; unknown IDs are rejected |
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

### Terminal agents (Claude Code, Codex)

The extension writes its IPC endpoint to `~/.config/muster/ipc/` on startup,
so MCP clients outside VS Code can find it. `bin/muster-mcp.cjs` locates the
compiled MCP server (repo build or installed extension) and launches it:

```bash
claude mcp add muster -- node <path-to-repo>/bin/muster-mcp.cjs
codex mcp add muster -- node <path-to-repo>/bin/muster-mcp.cjs
```

The repo is also a Claude Code plugin (skill + MCP server preconfigured):

```
/plugin marketplace add berwinsingh/one-click-terminal-setup-vscode
/plugin install muster@muster
```

VS Code (or Cursor) must be open with the Muster extension activated —
tool calls proxy through the running extension so trust checks and run
confirmations still apply. Stale endpoints from crashed sessions are
detected and cleaned automatically.

---

## Related

- [README.md](README.md) — Quick start, visual configuration, and development setup
- [schemas/muster.schema.json](schemas/muster.schema.json) — Full JSON Schema for `muster.json`
- [skills/muster/SKILL.md](skills/muster/SKILL.md) — Agent skill for Cursor and MCP clients
