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

  console.log('[integration] opening Muster sidebar views');
  await vscode.commands.executeCommand('workbench.view.extension.muster');
  await vscode.commands.executeCommand('muster.groups.focus');
  await vscode.commands.executeCommand('muster.issues.focus');

  console.log('[integration] running smoke group');
  const terminalOpened = waitForTerminal('Muster: Smoke Logger');
  try {
    await vscode.commands.executeCommand('muster.runGroup', 'smoke');
    await terminalOpened;
    await delay(1500);
    await vscode.commands.executeCommand('muster.refresh');
  } finally {
    await vscode.commands.executeCommand('muster.stopGroup', 'smoke');
  }

  console.log('[integration] smoke test complete');
}

module.exports = { run };
