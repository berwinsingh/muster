import * as fs from 'fs';
import * as vscode from 'vscode';
import { getWorkspaceConfigPath } from './paths';

/** Prefer the workspace folder that contains `.vscode/devstack.json`. */
export function getDevStackWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  for (const folder of folders) {
    const configPath = getWorkspaceConfigPath(folder.uri.fsPath);
    if (fs.existsSync(configPath)) {
      return folder;
    }
  }

  return folders[0];
}

export function hasWorkspaceConfigFile(folder?: vscode.WorkspaceFolder): boolean {
  if (!folder) {
    return false;
  }
  return fs.existsSync(getWorkspaceConfigPath(folder.uri.fsPath));
}
