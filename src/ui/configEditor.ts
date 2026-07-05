import * as vscode from 'vscode';
import { getWorkspaceConfigPath } from '../config/paths';

export async function openConfigEditor(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to edit DevStack config.');
    return;
  }

  const configPath = getWorkspaceConfigPath(folder.uri.fsPath);
  const uri = vscode.Uri.file(configPath);

  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    const sample = JSON.stringify(
      {
        version: '1.0.0',
        groups: [],
      },
      null,
      2
    );
    await vscode.workspace.fs.writeFile(uri, Buffer.from(sample, 'utf-8'));
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}
