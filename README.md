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

## Commands

| Command | Description |
|---------|-------------|
| `Muster: Run Group` | Start all services in a group |
| `Muster: Stop Group` | Stop a running group |
| `Muster: Configure` | Open the visual configuration editor |
| `Muster: Create Group` | Create a new group visually |
| `Muster: Import Example` | Load a starter configuration |
| `Muster: Open Config` | Open raw JSON config |

## MCP integration

Muster exposes MCP tools for AI agents to list groups, run/stop services, and read terminal output. Existing JSON config and MCP tools remain fully compatible.

Agents inside VS Code and Cursor pick the server up automatically. Terminal agents connect via the launcher (VS Code must be open with Muster activated):

```bash
claude mcp add muster -- node <path-to-repo>/bin/muster-mcp.cjs
```

The repo doubles as a Claude Code plugin — see [FEATURES.md](FEATURES.md#terminal-agents-claude-code-codex) for the plugin install and Codex setup.

## Development

```bash
npm install
npm run compile
```

Press F5 in VS Code to launch the Extension Development Host.
