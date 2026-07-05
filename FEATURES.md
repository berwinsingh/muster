# DevStack Features

**One click. Full stack running.**

DevStack is a VS Code extension for orchestrating dev server groups — configure once, run everything with a single click, and monitor output from one place. For setup and quick start, see [README.md](README.md).

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
| **Config** | Workspace config | `.vscode/devstack.json` — commit-friendly, per-project server definitions |
| **Config** | Global profiles | `~/.config/devstack/profiles.json` — reusable groups across workspaces |
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
| **UI** | Activity Bar | Dedicated DevStack sidebar with Server Groups and Events views |
| **UI** | Status bar | Quick run/stop toggle for the default or last-used group with live state |
| **UI** | Welcome view | Onboarding buttons: Create Group, Import Example, Open Visual Editor |
| **UI** | Config wizard v0.1.3 | Redesigned visual editor with runtime detection, folder pickers, and Save & Run |
| **UI** | Events timeline panel | Webview sidebar with segmented filters, chips, and scrollable event timeline |
| **Security** | Trust gate | Run/stop/restart blocked in untrusted workspaces until the user trusts the folder |
| **Security** | Config-only commands | Only commands defined in DevStack config can be executed — no arbitrary shell |
| **Security** | Non-destructive | `keepExistingTerminals` (default true) preserves unrelated terminals; only tracked processes are stopped |

---

## 🤖 AI / Agent Integration

DevStack exposes a native **MCP server** so AI agents in Cursor (and other MCP clients) can discover, start, stop, and monitor server groups — without bypassing VS Code security.

| Capability | Details |
|------------|---------|
| **MCP server** | Registered via `vscode.lm.registerMcpServerDefinitionProvider`; stdio transport to `dist/mcp/server.js` |
| **Scoped access** | Agents can only act on group/service IDs defined in config; unknown IDs are rejected |
| **Cursor skill** | `skills/devstack/SKILL.md` guides agents through the correct tool workflow |
| **IPC bridge** | Extension hosts a localhost IPC server; MCP tools proxy through it for live status and control |
| **MCP prompts** | `devstack/start` and `devstack/status` for common agent workflows |
| **MCP resources** | `devstack://config/workspace` (live config summary) and `devstack://logs/{groupId}/{serviceId}` (recent output) |

### Example agent workflow

1. Agent calls `describe_config` to locate workspace and profile paths
2. Agent calls `list_server_groups` to discover available groups
3. Agent calls `run_server_group({ "groupId": "dev" })` — user confirms in VS Code
4. Agent polls `get_group_status` until services reach `running`
5. Agent reads logs via `devstack://logs/dev/api` resource if errors appear
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
| `devstack://config/workspace` | Live workspace config paths and merged groups summary |
| `devstack://logs/{groupId}/{serviceId}` | Recent terminal output for a service (default 50 lines) |

### MCP prompts

| Prompt | Description |
|--------|-------------|
| `devstack/start` | Start the dev stack group best suited for this workspace |
| `devstack/status` | Show which DevStack services are currently running |

### Cursor skill

Install or reference `skills/devstack/SKILL.md` so agents:

- Use DevStack MCP tools instead of arbitrary shell commands
- Follow the read → run → poll → stop workflow
- Respect workspace trust and config-defined IDs only

---

## Related

- [README.md](README.md) — Quick start, visual configuration, and development setup
- [schemas/devstack.schema.json](schemas/devstack.schema.json) — Full JSON Schema for `devstack.json`
- [skills/devstack/SKILL.md](skills/devstack/SKILL.md) — Agent skill for Cursor and MCP clients
