import * as vscode from 'vscode';

export function registerMcpProvider(context: vscode.ExtensionContext): void {
  const lm = (vscode as typeof vscode & { lm?: typeof vscode.lm }).lm;
  if (!lm?.registerMcpServerDefinitionProvider) {
    return;
  }

  const provider: vscode.McpServerDefinitionProvider = {
    provideMcpServerDefinitions: () => {
      const serverPath = context.asAbsolutePath('dist/mcp/server.js');
      return [
        new vscode.McpStdioServerDefinition('devstack', process.execPath, [serverPath], {
          DEVSTACK_IPC_PORT: process.env.DEVSTACK_IPC_PORT ?? '',
          DEVSTACK_WORKSPACE: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
        }),
      ];
    },
  };

  context.subscriptions.push(lm.registerMcpServerDefinitionProvider('devstack.mcp', provider));
}
