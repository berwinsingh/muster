import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { addService, createGroup, deleteGroup, deleteService } from '../config/mutate';

function base() {
  return {
    version: '1.0.0',
    groups: [
      {
        id: 'api',
        label: 'API',
        layout: 'dedicated' as const,
        order: 'parallel' as const,
        services: [{ id: 'web', name: 'Web', command: 'pnpm dev' }],
      },
    ],
  };
}

describe('config mutations', () => {
  test('createGroup adds a valid group with one service and defaults', () => {
    const next = createGroup(base(), {
      id: 'worker',
      service: { id: 'queue', command: 'celery -A app worker', port: 5555 },
    });
    const g = next.groups.find((x) => x.id === 'worker');
    assert.ok(g);
    assert.equal(g.layout, 'dedicated');
    assert.equal(g.order, 'parallel');
    assert.equal(g.label, 'worker'); // falls back to id
    assert.equal(g.services[0].name, 'queue'); // falls back to id
    assert.equal(g.services[0].port, 5555);
  });

  test('createGroup rejects a duplicate id', () => {
    assert.throws(
      () => createGroup(base(), { id: 'api', service: { id: 's', command: 'x' } }),
      /already exists/
    );
  });

  test('createGroup rejects a service with no command', () => {
    assert.throws(() => createGroup(base(), { id: 'x', service: { id: 's' } }));
  });

  test('addService appends to an existing group', () => {
    const next = addService(base(), 'api', { id: 'worker', command: 'node worker.js' });
    const g = next.groups.find((x) => x.id === 'api');
    assert.deepEqual(g?.services.map((s) => s.id), ['web', 'worker']);
  });

  test('addService rejects unknown group and duplicate service', () => {
    assert.throws(() => addService(base(), 'nope', { id: 's', command: 'x' }), /Unknown group/);
    assert.throws(() => addService(base(), 'api', { id: 'web', command: 'x' }), /already exists/);
  });

  test('deleteGroup removes it; unknown throws', () => {
    assert.equal(deleteGroup(base(), 'api').groups.length, 0);
    assert.throws(() => deleteGroup(base(), 'nope'), /Unknown group/);
  });

  test('deleteService removes one but refuses the last', () => {
    const two = addService(base(), 'api', { id: 'worker', command: 'node worker.js' });
    const one = deleteService(two, 'api', 'worker');
    assert.deepEqual(one.groups[0].services.map((s) => s.id), ['web']);
    assert.throws(() => deleteService(one, 'api', 'web'), /last service/);
    assert.throws(() => deleteService(base(), 'api', 'nope'), /Unknown service/);
  });
});
