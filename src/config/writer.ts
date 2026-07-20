import * as vscode from 'vscode';
import { WorkspaceConfigSchema } from './schema';
import { getWorkspaceConfigPath } from './paths';
import { buildWorkspaceConfigPayload, WritableWorkspaceConfig } from './payload';

export { buildWorkspaceConfigPayload, getExampleConfig } from './payload';
export type { WritableWorkspaceConfig } from './payload';

export async function readWritableWorkspaceConfig(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<WritableWorkspaceConfig> {
  const configPath = getWorkspaceConfigPath(workspaceFolder.uri.fsPath);
  const uri = vscode.Uri.file(configPath);

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as unknown;
    const result = WorkspaceConfigSchema.safeParse(parsed);
    if (result.success) {
      return {
        version: result.data.version ?? '1.0.0',
        groups: result.data.groups ?? [],
        monitoring: result.data.monitoring,
      };
    }
  } catch {
    // fall through to default
  }

  return { version: '1.0.0', groups: [] };
}

export async function saveWorkspaceConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: WritableWorkspaceConfig
): Promise<void> {
  const payload = buildWorkspaceConfigPayload(config);

  const configPath = getWorkspaceConfigPath(workspaceFolder.uri.fsPath);
  const uri = vscode.Uri.file(configPath);
  const vscodeDir = vscode.Uri.joinPath(uri, '..');

  try {
    await vscode.workspace.fs.stat(vscodeDir);
  } catch {
    await vscode.workspace.fs.createDirectory(vscodeDir);
  }

  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(JSON.stringify(payload, null, 2), 'utf-8')
  );
}
