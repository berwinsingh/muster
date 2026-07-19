import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadMergedConfigFromPaths } from '../config/loader';
import { WorkspaceConfigSchema } from '../config/schema';
import { normalizeConfigIds, slugifyId } from '../config/slugify';

describe('config loader', () => {
  it('merges workspace groups with $schema present', () => {
    const root = mkdtempSync(join(tmpdir(), 'muster-loader-'));
    mkdirSync(join(root, '.vscode'), { recursive: true });
    writeFileSync(
      join(root, '.vscode', 'muster.json'),
      JSON.stringify(
        {
          $schema: '../schemas/muster.schema.json',
          version: '1.0.0',
          groups: [
            {
              id: 'dev',
              label: 'Development',
              layout: 'dedicated',
              order: 'parallel',
              services: [{ id: 'api', name: 'API', command: 'npm run dev' }],
            },
          ],
        },
        null,
        2
      )
    );

    const config = loadMergedConfigFromPaths(root, true);
    assert.equal(config.groups.length, 1);
    assert.equal(config.groups[0]?.id, 'dev');
    assert.equal(config.sources.workspaceConfigPath?.endsWith('muster.json'), true);
  });

  it('rejects invalid workspace config at parse time', () => {
    const parsed = WorkspaceConfigSchema.safeParse({
      version: '1.0.0',
      groups: [{ id: '', label: 'Bad', services: [] }],
    });
    assert.equal(parsed.success, false);
  });

  it('slugifies ids with spaces before validation', () => {
    const normalized = normalizeConfigIds({
      version: '1.0.0',
      groups: [
        {
          id: 'OrgWorkspace Full',
          label: 'OrgWorkspace Full',
          layout: 'dedicated',
          order: 'parallel',
          services: [
            {
              id: 'service 1',
              name: 'Service 1',
              command: 'npm run dev',
            },
          ],
        },
      ],
    });

    assert.match(normalized.groups[0]!.id, /^orgworkspace-full/);
    assert.match(normalized.groups[0]!.services[0]!.id, /^service-1/);
    assert.doesNotThrow(() => WorkspaceConfigSchema.parse(normalized));
  });
});

describe('slugifyId', () => {
  it('converts labels to kebab-case ids', () => {
    assert.equal(slugifyId('Service 1'), 'service-1');
    assert.equal(slugifyId('OrgWorkspace Full'), 'orgworkspace-full');
  });
});
