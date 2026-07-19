#!/usr/bin/env node
/**
 * Launcher for Muster's MCP stdio server, for terminal MCP clients
 * (Claude Code, Codex, or anything speaking MCP over stdio).
 *
 * Finds the compiled server in this order:
 *   1. MUSTER_MCP_SERVER env var (explicit path to server.js)
 *   2. dist/mcp/server.js next to this script (repo checkout, after a build)
 *   3. The newest installed Muster VS Code/Cursor extension
 *
 * The server talks to the running Muster extension in VS Code/Cursor via its
 * localhost IPC endpoint (found through ~/.config/muster/ipc), so VS Code
 * with the Muster extension must be open for tool calls to succeed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function findInExtensionsDir(extensionsDir) {
  let entries;
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((name) => name.startsWith('muster.muster-'))
    .map((name) => path.join(extensionsDir, name, 'dist', 'mcp', 'server.js'))
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates.length > 0 ? candidates[0].p : null;
}

function resolveServer() {
  if (process.env.MUSTER_MCP_SERVER && fs.existsSync(process.env.MUSTER_MCP_SERVER)) {
    return process.env.MUSTER_MCP_SERVER;
  }

  const local = path.join(__dirname, '..', 'dist', 'mcp', 'server.js');
  if (fs.existsSync(local)) {
    return local;
  }

  const home = os.homedir();
  const extensionRoots = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.windsurf', 'extensions'),
  ];
  for (const root of extensionRoots) {
    const found = findInExtensionsDir(root);
    if (found) return found;
  }
  return null;
}

const serverPath = resolveServer();
if (!serverPath) {
  process.stderr.write(
    'muster-mcp: could not find Muster\'s MCP server.\n' +
      'Install the Muster VS Code extension, or build from source (npm install && npm run compile), ' +
      'or point MUSTER_MCP_SERVER at a compiled dist/mcp/server.js.\n'
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    MUSTER_WORKSPACE: process.env.MUSTER_WORKSPACE || process.cwd(),
  },
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});
