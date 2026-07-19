const assert = require('node:assert/strict');
const vscode = require('vscode');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const extension = vscode.extensions.getExtension('devstack.devstack');
  assert.ok(extension, 'DevStack extension should be discoverable in the Extension Host');

  const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  assert.ok(workspaceFolder, 'Smoke test workspace should be open');
  assert.equal(vscode.workspace.isTrusted, true, 'Smoke test workspace should be trusted');
  await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'devstack.json'));

  console.log('[integration] activating extension');
  await extension.activate();
  assert.equal(extension.isActive, true, 'DevStack extension should activate');

  const commands = await vscode.commands.getCommands(true);
  for (const command of ['devstack.runGroup', 'devstack.stopGroup', 'devstack.refresh']) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  console.log('[integration] opening DevStack sidebar views');
  await vscode.commands.executeCommand('workbench.view.extension.devstack');
  await vscode.commands.executeCommand('devstack.groups.focus');
  await vscode.commands.executeCommand('devstack.issues.focus');

  console.log('[integration] running smoke group');
  const terminalOpened = waitForTerminal('DevStack: Smoke Logger');
  try {
    await vscode.commands.executeCommand('devstack.runGroup', 'smoke');
    await terminalOpened;
    await delay(1500);
    await vscode.commands.executeCommand('devstack.refresh');
  } finally {
    await vscode.commands.executeCommand('devstack.stopGroup', 'smoke');
  }

  console.log('[integration] smoke test complete');
}

module.exports = { run };
