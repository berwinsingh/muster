/**
 * Pure config serialization shared by the extension's writer and the
 * standalone CLI: no vscode, no filesystem — both sides persist through
 * the same normalizing, validating payload builder.
 */
import { normalizeConfigIds } from './slugify';
import { GroupConfig, MonitoringConfig, WorkspaceConfigSchema } from './schema';

export type WritableWorkspaceConfig = {
  version: string;
  groups: GroupConfig[];
  monitoring?: MonitoringConfig;
};

export function buildWorkspaceConfigPayload(config: WritableWorkspaceConfig): Record<string, unknown> {
  const normalized = normalizeConfigIds(config);
  const validated = WorkspaceConfigSchema.parse({
    version: normalized.version ?? '1.0.0',
    groups: normalized.groups,
    monitoring: normalized.monitoring,
  });

  return {
    $schema: '../schemas/muster.schema.json',
    ...validated,
  };
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
