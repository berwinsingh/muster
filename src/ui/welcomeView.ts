import * as vscode from 'vscode';

export function registerWelcomeCommands(context: vscode.ExtensionContext): void {
  // Welcome view actions are wired in extension.ts via contributed commands.
  // This module exists as a hook for future welcome-specific logic.
  void context;
}

export function getWelcomeContent(): string {
  return [
    'No server groups configured yet.',
    'Use the **+** (Create Group) and pencil (Configure) icons in the title bar.',
    '[Create Group](command:devstack.createGroup)',
    '[Import Example](command:devstack.importExample)',
    '[Open Visual Editor](command:devstack.openVisualEditor)',
  ].join('\n');
}
