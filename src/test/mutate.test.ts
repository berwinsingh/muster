import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
  addService,
  createGroup,
  deleteGroup,
  deleteService,
  updateGroup,
  updateService,
} from '../config/mutate';

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

  test('createGroup passes python/node settings through', () => {
    const next = createGroup(base(), {
      id: 'py',
      service: { id: 'api', command: 'uvicorn main:app', python: { venv: '.venv' }, node: { version: '20' } },
    });
    const svc = next.groups.find((g) => g.id === 'py')!.services[0];
    assert.deepEqual(svc.python, { venv: '.venv' });
    assert.deepEqual(svc.node, { version: '20' });
  });

  test('updateGroup patches only the given fields', () => {
    const next = updateGroup(base(), 'api', { label: 'Renamed', order: 'sequence' });
    const g = next.groups[0];
    assert.equal(g.label, 'Renamed');
    assert.equal(g.order, 'sequence');
    assert.equal(g.layout, 'dedicated'); // untouched
    assert.throws(() => updateGroup(base(), 'nope', { label: 'x' }), /Unknown group/);
  });

  test('updateService sets, keeps, and clears fields', () => {
    const withExtras = updateService(base(), 'api', 'web', {
      name: 'Web UI',
      port: 3000,
      python: { venv: '.venv' },
    });
    let svc = withExtras.groups[0].services[0];
    assert.equal(svc.name, 'Web UI');
    assert.equal(svc.port, 3000);
    assert.deepEqual(svc.python, { venv: '.venv' });
    assert.equal(svc.command, 'pnpm dev'); // untouched

    const cleared = updateService(withExtras, 'api', 'web', { port: null, python: null });
    svc = cleared.groups[0].services[0];
    assert.equal(svc.port, undefined);
    assert.equal(svc.python, undefined);
    assert.equal(svc.name, 'Web UI'); // untouched
  });

  test('updateService keeps command/commands mutually exclusive', () => {
    const multi = updateService(base(), 'api', 'web', { commands: ['a', 'b'] });
    assert.equal(multi.groups[0].services[0].command, undefined);
    assert.deepEqual(multi.groups[0].services[0].commands, ['a', 'b']);
    const single = updateService(multi, 'api', 'web', { command: 'c' });
    assert.equal(single.groups[0].services[0].command, 'c');
    assert.equal(single.groups[0].services[0].commands, undefined);
  });

  test('updateService rejects unknown targets and invalid values', () => {
    assert.throws(() => updateService(base(), 'api', 'nope', { name: 'x' }), /Unknown service/);
    assert.throws(() => updateService(base(), 'nope', 'web', { name: 'x' }), /Unknown group/);
    assert.throws(() => updateService(base(), 'api', 'web', { port: 99999 }));
  });

  test('deleteService removes one but refuses the last', () => {
    const two = addService(base(), 'api', { id: 'worker', command: 'node worker.js' });
    const one = deleteService(two, 'api', 'worker');
    assert.deepEqual(one.groups[0].services.map((s) => s.id), ['web']);
    assert.throws(() => deleteService(one, 'api', 'web'), /last service/);
    assert.throws(() => deleteService(base(), 'api', 'nope'), /Unknown service/);
  });
});
