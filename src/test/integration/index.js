const assert = require('node:assert/strict');
const vscode = require('vscode');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run() {
  console.log('[integration] locating extension');
  const extension = vscode.extensions.getExtension('devstack.devstack');
  assert.ok(extension, 'DevStack extension should be discoverable in the Extension Host');

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
  try {
    await vscode.commands.executeCommand('devstack.runGroup', 'smoke');
    await delay(2500);
    assert.ok(
      vscode.window.terminals.some((terminal) => terminal.name === 'DevStack: Smoke Logger'),
      'running the smoke group should create its terminal'
    );
    await vscode.commands.executeCommand('devstack.refresh');
  } finally {
    await vscode.commands.executeCommand('devstack.stopGroup', 'smoke');
  }

  console.log('[integration] smoke test complete');
}

module.exports = { run };
