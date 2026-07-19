import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WorkspaceConfigSchema } from '../config/schema';
import { buildWorkspaceConfigPayload } from '../config/writer';

describe('config writer', () => {
  it('builds valid JSON payload with schema and slug ids', () => {
    const payload = buildWorkspaceConfigPayload({
      version: '1.0.0',
      groups: [
        {
          id: 'My Group',
          label: 'My Group',
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

    assert.equal(payload.$schema, '../schemas/muster.schema.json');
    assert.doesNotThrow(() => WorkspaceConfigSchema.parse(payload));
    const groups = payload.groups as Array<{ id: string; services: Array<{ id: string }> }>;
    assert.match(groups[0]!.id, /^my-group/);
    assert.match(groups[0]!.services[0]!.id, /^service-1/);
  });

  it('preserves already-valid ids', () => {
    const payload = buildWorkspaceConfigPayload({
      version: '1.0.0',
      groups: [
        {
          id: 'full-stack',
          label: 'Full Stack',
          layout: 'dedicated',
          order: 'parallel',
          services: [{ id: 'api', name: 'API', command: 'npm run dev' }],
        },
      ],
    });

    const groups = payload.groups as Array<{ id: string; services: Array<{ id: string }> }>;
    assert.equal(groups[0]!.id, 'full-stack');
    assert.equal(groups[0]!.services[0]!.id, 'api');
  });
});
