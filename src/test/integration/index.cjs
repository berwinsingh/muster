const assert = require('node:assert/strict');
const vscode = require('vscode');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run() {
  const extension = vscode.extensions.getExtension('devstack.devstack');
  assert.ok(extension, 'DevStack extension should be discoverable in the Extension Host');
  await extension.activate();
  assert.equal(extension.isActive, true, 'DevStack extension should activate');

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'devstack.runGroup',
    'devstack.stopGroup',
    'devstack.refresh',
    'devstack.groups.focus',
    'devstack.issues.focus',
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  await vscode.commands.executeCommand('workbench.view.extension.devstack');
  await vscode.commands.executeCommand('devstack.groups.focus');
  await vscode.commands.executeCommand('devstack.issues.focus');
  await vscode.commands.executeCommand('devstack.runGroup', 'smoke');
  await delay(2500);

  assert.ok(
    vscode.window.terminals.some((terminal) => terminal.name === 'DevStack: Smoke Logger'),
    'running the smoke group should create its terminal'
  );

  await vscode.commands.executeCommand('devstack.refresh');
  await vscode.commands.executeCommand('devstack.stopGroup', 'smoke');
}

module.exports = { run };
