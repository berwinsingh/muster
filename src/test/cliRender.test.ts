import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { buildRows, plainGroupList, renderButtons, renderRow, truncateAnsi } from '../cli/render';
import type { CliGroup, CliGroupStatus } from '../cli/client';

const GROUPS: CliGroup[] = [
  {
    id: 'full-stack',
    label: 'Full Stack Dev',
    layout: 'dedicated',
    order: 'parallel',
    services: [
      { id: 'api', name: 'FastAPI', command: 'uvicorn main:app', port: 8000 },
      { id: 'web', name: 'Next.js', command: 'pnpm dev', port: 3000 },
    ],
  },
  {
    id: 'worker-only',
    label: 'Workers',
    layout: 'aggregated',
    order: 'sequence',
    services: [{ id: 'worker', name: 'Celery', command: 'celery -A app worker' }],
  },
];

function statuses(): Map<string, CliGroupStatus> {
  return new Map([
    [
      'full-stack',
      { groupId: 'full-stack', state: 'running', services: { api: 'running', web: 'starting' } },
    ],
  ]);
}

function strip(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('cli rows', () => {
  test('flattens groups with statuses and idle fallback', () => {
    const rows = buildRows(GROUPS, statuses(), '');
    assert.equal(rows.length, 5); // 2 group rows + 3 service rows
    const api = rows[1];
    assert.equal(api.kind, 'service');
    assert.equal(api.kind === 'service' && api.status, 'running');
    const worker = rows[4];
    assert.equal(worker.kind === 'service' && worker.status, 'idle');
  });

  test('filter matches service and group names, hiding empty groups', () => {
    const rows = buildRows(GROUPS, statuses(), 'celery');
    assert.deepEqual(
      rows.map((r) => (r.kind === 'group' ? r.group.id : r.serviceId)),
      ['worker-only', 'worker']
    );
  });

  test('filter by group id keeps all its services', () => {
    const rows = buildRows(GROUPS, statuses(), 'full-stack');
    assert.equal(rows.filter((r) => r.kind === 'service').length, 2);
  });
});

describe('cli rendering', () => {
  test('service row shows port, name, and truncated command', () => {
    const rows = buildRows(GROUPS, statuses(), '');
    const line = strip(renderRow(rows[1], false, 120));
    assert.ok(line.includes('FastAPI'));
    assert.ok(line.includes(':8000'));
    assert.ok(line.includes('uvicorn main:app'));
  });

  test('selected row carries the selection marker', () => {
    const rows = buildRows(GROUPS, statuses(), '');
    assert.ok(strip(renderRow(rows[0], true, 120)).startsWith('▸'));
  });

  test('truncateAnsi cuts visible width, not escape codes', () => {
    const colored = '\x1b[32mhello world\x1b[0m';
    const cut = truncateAnsi(colored, 5);
    assert.equal(strip(cut), 'hello');
    assert.ok(cut.includes('\x1b[32m'));
  });

  test('plain list includes every group and service', () => {
    const text = strip(plainGroupList(GROUPS, statuses()));
    for (const expected of ['full-stack', 'api', ':8000', 'worker-only', 'celery -A app worker']) {
      assert.ok(text.includes(expected), `missing ${expected}`);
    }
  });

  test('button bar supports a custom quit label with matching hitbox', () => {
    const { line, buttons } = renderButtons('dash', 200, 'quit (stops all)');
    assert.ok(strip(line).includes('quit (stops all)'));
    const quit = buttons.find((b) => b.key === 'q');
    assert.ok(quit);
    // hitbox spans " q " + " quit (stops all) " → key+label+4 columns
    assert.equal(quit.x2 - quit.x1 + 1, 1 + 'quit (stops all)'.length + 4);
    const defaultBar = renderButtons('dash', 200);
    assert.ok(strip(defaultBar.line).includes(' quit '));
  });
});
