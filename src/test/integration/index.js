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

  // Drive the CLI as a separate process (forces the discovery path, like a
  // real terminal). Defined early so the terminal-free config tests run
  // before any terminal rendering happens.
  const externalEnv = { ...process.env, MUSTER_WORKSPACE: workspaceFolder.uri.fsPath };
  delete externalEnv.MUSTER_IPC_PORT;
  const cliPath = path.join(extension.extensionPath, 'bin', 'muster.cjs');
  const runCli = (args) =>
    new Promise((resolve) => {
      const child = require('node:child_process').spawn(process.execPath, [cliPath, ...args], {
        env: externalEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => (stdout += c));
      child.stderr.on('data', (c) => (stderr += c));
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => child.kill('SIGTERM'), 30000);
    });

  console.log('[integration] CLI lists and mutates config through the live extension');
  const lsEarly = await runCli(['ls']);
  assert.equal(lsEarly.code, 0, `muster ls should succeed. stderr: ${lsEarly.stderr}`);
  assert.ok(lsEarly.stdout.includes('smoke'), 'muster ls should list the smoke group');

  // Config mutations (create/add/delete) — terminal-free, so they validate
  // deterministically even if terminal rendering flakes later. Snapshot and
  // restore the fixture so the test leaves it byte-identical.
  const cfgPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'muster.json');
  const originalCfg = fs.readFileSync(cfgPath, 'utf-8');
  try {
    const created = await runCli(['create', 'cli-made', '--command', 'echo hi', '--service', 'one', '--label', 'CLI Made']);
    assert.equal(created.code, 0, `muster create should succeed. stderr: ${created.stderr}`);
    let after = await runCli(['ls']);
    assert.ok(after.stdout.includes('cli-made'), 'created group should appear in ls');
    assert.ok(after.stdout.includes('one'), 'created service should appear in ls');

    const added = await runCli(['add', 'cli-made', 'two', '--command', 'echo two', '--port', '4321']);
    assert.equal(added.code, 0, `muster add should succeed. stderr: ${added.stderr}`);
    after = await runCli(['ls']);
    assert.ok(after.stdout.includes('two'), 'added service should appear in ls');
    assert.ok(after.stdout.includes('4321'), 'added service port should appear in ls');

    const dupe = await runCli(['create', 'cli-made', '--command', 'echo x']);
    assert.notEqual(dupe.code, 0, 'creating a duplicate group id should fail');

    const delSvc = await runCli(['delete', 'cli-made', 'two']);
    assert.equal(delSvc.code, 0, `muster delete service should succeed. stderr: ${delSvc.stderr}`);
    const delGroup = await runCli(['delete', 'cli-made']);
    assert.equal(delGroup.code, 0, `muster delete group should succeed. stderr: ${delGroup.stderr}`);
    after = await runCli(['ls']);
    assert.ok(!after.stdout.includes('cli-made'), 'deleted group should be gone from ls');
  } finally {
    fs.writeFileSync(cfgPath, originalCfg);
    await delay(300); // let the file-watcher settle
  }

  console.log('[integration] opening Muster sidebar views');
  await vscode.commands.executeCommand('workbench.view.extension.muster');
  await vscode.commands.executeCommand('muster.groups.focus');
  await vscode.commands.executeCommand('muster.issues.focus');

  console.log('[integration] running smoke group via VS Code command');
  const terminalOpened = waitForTerminal('Muster: Smoke Logger');
  try {
    await vscode.commands.executeCommand('muster.runGroup', 'smoke');
    await terminalOpened;
    assert.ok(
      vscode.window.terminals.some((terminal) => terminal.name === 'Muster'),
      'Muster orchestrator (narrator) terminal should open during a group run'
    );
    await delay(1500);
    await vscode.commands.executeCommand('muster.refresh');
  } finally {
    await vscode.commands.executeCommand('muster.stopGroup', 'smoke');
  }
  // Let this cycle's terminal finish disposing before the next cycle
  // creates a new one — three back-to-back run/stop cycles of the same
  // group is a stress test, not a realistic user pace.
  await delay(500);

  console.log('[integration] verifying external MCP client (simulates Claude Code / Codex / Cursor)');
  const launcherPath = path.join(extension.extensionPath, 'bin', 'muster-mcp.cjs');
  // externalEnv (discovery-forced, no MUSTER_IPC_PORT) is defined near the top.

  // The confirmation gate is on by default, so an agent run would block on
  // a modal no test can click. Stub the dialog to record that it fired and
  // return the given answer — this both unblocks the test and proves the
  // gate is real, not just documented. If the vscode API object won't
  // accept the stub, fall back to disabling the setting so the suite can
  // never hang on a real modal (the unit tests still cover the gate logic).
  const originalShowWarning = vscode.window.showWarningMessage;
  let confirmCalls = [];
  let stubAnswer = 'Allow';
  const stub = (message) => {
    confirmCalls.push(message);
    return Promise.resolve(stubAnswer);
  };
  let stubInstalled = false;
  try {
    vscode.window.showWarningMessage = stub;
    stubInstalled = vscode.window.showWarningMessage === stub;
  } catch {
    stubInstalled = false;
  }
  if (!stubInstalled) {
    console.log('[integration] could not stub the dialog; disabling confirmation to avoid a hang');
    await vscode.workspace
      .getConfiguration('muster')
      .update('confirmAgentActions', false, vscode.ConfigurationTarget.Global);
  }

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

    if (stubInstalled) {
      // Denial path: the tool reports an error (MCP convention: isError on a
      // normal response, not a protocol rejection) and nothing starts.
      console.log('[integration] agent run is blocked when the user denies confirmation');
      stubAnswer = undefined; // dismiss / Escape
      confirmCalls = [];
      const denyResult = await mcp.callTool('run_server_group', { groupId: 'smoke' });
      assert.equal(confirmCalls.length, 1, 'a confirmation dialog should have been shown for the agent run');
      assert.match(confirmCalls[0], /AI agent wants to start/, 'dialog should describe the action');
      assert.equal(denyResult.isError, true, 'a denied agent run should return an error result');
      assert.match(denyResult.content[0].text, /denied/i, 'the error should say the action was denied');
      const denied = parseToolText(await mcp.callTool('get_group_status', { groupId: 'smoke' }));
      assert.notEqual(denied.services.logger, 'running', 'a denied run must not start the service');
      stubAnswer = 'Allow';
      confirmCalls = [];
    }

    // Approval path: agent run proceeds (confirmed via stub, or unprompted
    // if confirmation was disabled as a fallback above).
    console.log('[integration] running smoke group via external MCP tool call');
    const terminalReopened = waitForTerminal('Muster: Smoke Logger');
    await mcp.callTool('run_server_group', { groupId: 'smoke' });
    if (stubInstalled) {
      assert.equal(confirmCalls.length, 1, 'approved run should also have prompted');
    }
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
    vscode.window.showWarningMessage = originalShowWarning;
    if (!stubInstalled) {
      await vscode.workspace
        .getConfiguration('muster')
        .update('confirmAgentActions', undefined, vscode.ConfigurationTarget.Global);
    }
    mcp.close();
  }
  await delay(500);

  console.log('[integration] installing the CLI onto PATH via command');
  const installDir = process.env.MUSTER_CLI_INSTALL_DIR;
  assert.ok(installDir, 'test runner should provide MUSTER_CLI_INSTALL_DIR');
  await vscode.commands.executeCommand('muster.installCli');
  const wrapperPath = path.join(installDir, 'muster');
  assert.ok(fs.existsSync(wrapperPath), 'install command should write the muster wrapper');
  assert.ok(
    fs.readFileSync(wrapperPath, 'utf-8').includes('bin/muster.cjs'),
    'wrapper should exec the extension launcher'
  );
  const wrapperRun = await new Promise((resolve) => {
    const child = require('node:child_process').spawn(wrapperPath, ['help'], {
      env: externalEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.on('exit', (code) => resolve({ code, stdout }));
    child.on('error', (err) => resolve({ code: -1, stdout: String(err) }));
    setTimeout(() => child.kill('SIGTERM'), 15000);
  });
  assert.equal(wrapperRun.code, 0, `installed wrapper should run. output: ${wrapperRun.stdout}`);
  assert.ok(wrapperRun.stdout.includes('muster'), 'wrapper should print CLI help');

  console.log('[integration] verifying the muster CLI runs a group against the live extension');
  const terminalForCli = waitForTerminal('Muster: Smoke Logger');
  const runResult = await runCli(['run', 'smoke']);
  assert.equal(runResult.code, 0, `muster run should succeed. stderr: ${runResult.stderr}`);
  assert.ok(
    runResult.stdout.includes('services running'),
    `muster run should report the final status. stdout: ${runResult.stdout}`
  );
  await terminalForCli;

  const logsResult = await runCli(['logs', 'smoke', 'logger', '-n', '50']);
  assert.equal(logsResult.code, 0, `muster logs should succeed. stderr: ${logsResult.stderr}`);

  const stopResult = await runCli(['stop', 'smoke']);
  assert.equal(stopResult.code, 0, `muster stop should succeed. stderr: ${stopResult.stderr}`);
  assert.ok(stopResult.stdout.includes('stopped smoke'), 'muster stop should confirm');

  console.log('[integration] smoke test complete');
}

module.exports = { run };
