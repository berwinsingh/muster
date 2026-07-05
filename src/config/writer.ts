import * as vscode from 'vscode';
import { normalizeConfigIds } from './slugify';
import { GroupConfig, MonitoringConfig, WorkspaceConfigSchema } from './schema';
import { getWorkspaceConfigPath } from './paths';

export type WritableWorkspaceConfig = {
  version: string;
  groups: GroupConfig[];
  monitoring?: MonitoringConfig;
};

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

export function buildWorkspaceConfigPayload(config: WritableWorkspaceConfig): Record<string, unknown> {
  const normalized = normalizeConfigIds(config);
  const validated = WorkspaceConfigSchema.parse({
    version: normalized.version ?? '1.0.0',
    groups: normalized.groups,
    monitoring: normalized.monitoring,
  });

  return {
    $schema: '../schemas/devstack.schema.json',
    ...validated,
  };
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

export function getExampleConfig(): WritableWorkspaceConfig {
  return {
    version: '1.0.0',
    groups: [
      {
        id: 'dev',
        label: 'Development',
        layout: 'dedicated',
        order: 'parallel',
        services: [
          {
            id: 'api',
            name: 'API Server',
            command: 'npm run dev',
            cwd: '${workspaceFolder}',
          },
          {
            id: 'web',
            name: 'Frontend',
            command: 'pnpm dev',
            cwd: '${workspaceFolder}/frontend',
          },
        ],
      },
    ],
    monitoring: {
      maxDays: 7,
      includeDiagnostics: true,
      patterns: [
        {
          id: 'error',
          severity: 'error',
          category: 'runtime',
          regex: 'ERROR|Error:|Traceback|Exception',
          sources: ['terminal'],
        },
        {
          id: 'warning',
          severity: 'warning',
          category: 'runtime',
          regex: 'WARN|Warning:',
          sources: ['terminal'],
        },
      ],
    },
  };
}
