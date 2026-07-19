const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Minimal JSON-RPC-over-stdio MCP client, standing in for a real external
 * client (Claude Code, Codex, Cursor) driving Muster's MCP server through
 * bin/muster-mcp.cjs. Deliberately does not inherit MUSTER_IPC_PORT from
 * this process, so tool calls are forced through the same IPC discovery
 * file lookup a genuinely separate process would use.
 */
function createMcpClient(command, args, env) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf-8');
  });

  function request(method, params) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out. stderr: ${stderr}`));
        }
      }, 15000);
    });
  }

  return {
    async initialize() {
      const result = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'muster-integration-test', version: '0.0.0' },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      return result;
    },
    listTools: () => request('tools/list', {}),
    callTool: (name, toolArgs) => request('tools/call', { name, arguments: toolArgs ?? {} }),
    stderr: () => stderr,
    close() {
      child.kill();
    },
  };
}

function parseToolText(toolResult) {
  return JSON.parse(toolResult.content[0].text);
}

function waitForTerminal(name, timeoutMs = 10000) {
  const existing = vscode.window.terminals.find((terminal) => terminal.name === name);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    let subscription;
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`Timed out waiting for terminal ${name}. Open terminals: ${vscode.window.terminals.map((terminal) => terminal.name).join(', ')}`));
    }, timeoutMs);
    subscription = vscode.window.onDidOpenTerminal((terminal) => {
      if (terminal.name !== name) return;
      clearTimeout(timer);
      subscription.dispose();
      resolve(terminal);
    });
  });
}

async function run() {
  console.log('[integration] locating extension');
  const extension = vscode.extensions.getExtension('muster.muster');
  assert.ok(extension, 'Muster extension should be discoverable in the Extension Host');

  const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  assert.ok(workspaceFolder, 'Smoke test workspace should be open');
  assert.equal(vscode.workspace.isTrusted, true, 'Smoke test workspace should be trusted');
  await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'muster.json'));

  console.log('[integration] activating extension');
  await extension.activate();
  assert.equal(extension.isActive, true, 'Muster extension should activate');

  const commands = await vscode.commands.getCommands(true);
  for (const command of ['muster.runGroup', 'muster.stopGroup', 'muster.refresh']) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  console.log('[integration] checking IPC discovery file');
  const discoveryDir = path.join(os.homedir(), '.config', 'muster', 'ipc');
  let discovered = null;
  for (let attempt = 0; attempt < 20 && !discovered; attempt++) {
    if (fs.existsSync(discoveryDir)) {
      const entries = fs
        .readdirSync(discoveryDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(discoveryDir, f), 'utf-8')))
        .filter((e) => e.workspace === workspaceFolder.uri.fsPath);
      if (entries.length > 0) discovered = entries[0];
    }
    if (!discovered) await delay(250);
  }
  assert.ok(discovered, 'IPC discovery file should be written for the workspace');
  assert.ok(discovered.port > 0, 'IPC discovery file should record a real port');

  console.log('[integration] opening Muster sidebar views');
  await vscode.commands.executeCommand('workbench.view.extension.muster');
  await vscode.commands.executeCommand('muster.groups.focus');
  await vscode.commands.executeCommand('muster.issues.focus');

  console.log('[integration] running smoke group via VS Code command');
  const terminalOpened = waitForTerminal('Muster: Smoke Logger');
  try {
    await vscode.commands.executeCommand('muster.runGroup', 'smoke');
    await terminalOpened;
    await delay(1500);
    await vscode.commands.executeCommand('muster.refresh');
  } finally {
    await vscode.commands.executeCommand('muster.stopGroup', 'smoke');
  }

  console.log('[integration] verifying external MCP client (simulates Claude Code / Codex / Cursor)');
  const launcherPath = path.join(extension.extensionPath, 'bin', 'muster-mcp.cjs');
  const externalEnv = { ...process.env, MUSTER_WORKSPACE: workspaceFolder.uri.fsPath };
  delete externalEnv.MUSTER_IPC_PORT; // force the discovery-file path, like a truly separate process

  const mcp = createMcpClient(process.execPath, [launcherPath], externalEnv);
  try {
    const initResult = await mcp.initialize();
    assert.equal(initResult.serverInfo.name, 'muster', 'external client should reach the Muster MCP server');

    const toolsList = await mcp.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    for (const expected of ['list_server_groups', 'run_server_group', 'get_group_status', 'stop_server_group']) {
      assert.ok(toolNames.includes(expected), `external client should see the "${expected}" tool`);
    }

    const groups = parseToolText(await mcp.callTool('list_server_groups'));
    assert.ok(
      groups.groups.some((g) => g.id === 'smoke'),
      'external client should discover the smoke group through the live extension'
    );

    console.log('[integration] running smoke group via external MCP tool call');
    const terminalReopened = waitForTerminal('Muster: Smoke Logger');
    await mcp.callTool('run_server_group', { groupId: 'smoke' });
    await terminalReopened;
    await delay(1500);

    const status = parseToolText(await mcp.callTool('get_group_status', { groupId: 'smoke' }));
    assert.equal(
      status.services.logger,
      'running',
      'a group started by an external MCP client should actually be running, not just report success'
    );

    await mcp.callTool('stop_server_group', { groupId: 'smoke' });
  } finally {
    mcp.close();
  }

  console.log('[integration] smoke test complete');
}

module.exports = { run };
