import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
  applyGroupEdit,
  applyServiceEdit,
  groupForm,
  guessServiceId,
  uniqueServiceId,
  moveGroupHook,
  moveServiceStep,
  movedStepRow,
  removeGroupRow,
  removeServiceRow,
  rowServiceId,
  rowValue,
  serviceForm,
} from '../cli/form';
import { updateGroup, updateService } from '../config/mutate';
import type { GroupConfig, ServiceConfig } from '../config/schema';

const SINGLE: ServiceConfig = {
  id: 'python-ai',
  name: 'Python AI',
  command: 'uvicorn main:app --reload --port 8011',
  cwd: '${workspaceFolder}/docq_AI',
  port: 8011,
  python: { venv: 'venv' },
};

const MULTI: ServiceConfig = {
  id: 'python-ai',
  name: 'Python AI',
  commands: ['. venv/bin/activate', 'pip install -r requirements.txt', 'uvicorn main:app'],
};

const GROUP: GroupConfig = {
  id: 'org',
  label: 'OrgWorkspace Full',
  layout: 'dedicated',
  order: 'parallel',
  services: [SINGLE, { id: 'web', name: 'Web', command: 'pnpm dev' }],
};

/** Run a patch through the real mutation, so tests catch schema rejections. */
function applyToService(svc: ServiceConfig, rowId: string, value: string): ServiceConfig {
  const config = { version: '1.0.0', groups: [{ ...GROUP, services: [svc] }] };
  const next = updateService(config, 'org', svc.id, applyServiceEdit(svc, rowId, value));
  return next.groups[0].services[0];
}

function ids(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id);
}

describe('service form rows', () => {
  test('a single-command service shows one command row', () => {
    const rows = serviceForm(SINGLE);
    assert.ok(ids(rows).includes('command'));
    assert.ok(!ids(rows).some((id) => id.startsWith('step:')));
    assert.equal(rows.find((r) => r.id === 'port')?.value, '8011');
    assert.equal(rows.find((r) => r.id === 'venv')?.value, 'venv');
  });

  test('a multi-step service shows one row per step, reorderable', () => {
    const rows = serviceForm(MULTI);
    assert.deepEqual(
      rows.filter((r) => r.id.startsWith('step:')).map((r) => r.label),
      ['step 1', 'step 2', 'step 3']
    );
    assert.ok(rows.filter((r) => r.id.startsWith('step:')).every((r) => r.movable));
    assert.ok(!ids(rows).includes('command'));
  });

  test('unset optional fields read as a placeholder, not an empty gap', () => {
    const node = serviceForm(SINGLE).find((r) => r.id === 'node');
    assert.ok(node);
    const { text, muted } = rowValue(node);
    assert.equal(muted, true);
    assert.ok(text.length > 0);
  });
});

describe('editing a service field', () => {
  test('adding a step to a single-command service converts it to a list', () => {
    const next = applyToService(SINGLE, 'add-step', 'pip install -r requirements.txt');
    assert.deepEqual(next.commands, [
      'uvicorn main:app --reload --port 8011',
      'pip install -r requirements.txt',
    ]);
    // The schema treats the two as mutually exclusive.
    assert.equal(next.command, undefined);
  });

  test('adding another step appends to the existing list', () => {
    const next = applyToService(MULTI, 'add-step', 'echo done');
    assert.equal(next.commands?.length, 4);
    assert.equal(next.commands?.[3], 'echo done');
  });

  test('an empty add is a no-op, not an empty step', () => {
    assert.deepEqual(applyServiceEdit(MULTI, 'add-step', '   '), {});
  });

  test('editing one step leaves the others alone', () => {
    const next = applyToService(MULTI, 'step:1', 'pip install -e .');
    assert.deepEqual(next.commands, ['. venv/bin/activate', 'pip install -e .', 'uvicorn main:app']);
  });

  test('clearing an optional field removes it rather than storing empty', () => {
    const next = applyToService(SINGLE, 'cwd', '');
    assert.equal(next.cwd, undefined);
    assert.equal(applyToService(SINGLE, 'venv', '').python, undefined);
    assert.equal(applyToService(SINGLE, 'port', '').port, undefined);
  });

  test('a port has to be a port', () => {
    assert.throws(() => applyServiceEdit(SINGLE, 'port', 'eight thousand'), /not a port/);
    assert.throws(() => applyServiceEdit(SINGLE, 'port', '70000'), /not a port/);
    assert.equal(applyToService(SINGLE, 'port', '3000').port, 3000);
  });

  test('name and command cannot be emptied by accident', () => {
    assert.throws(() => applyServiceEdit(SINGLE, 'name', '  '), /cannot be empty/);
    assert.throws(() => applyServiceEdit(SINGLE, 'command', ''), /needs a command/);
    assert.throws(() => applyServiceEdit(MULTI, 'step:0', ''), /press x to remove/);
  });
});

describe('removing and reordering steps', () => {
  test('removing a step drops just that one', () => {
    const patch = removeServiceRow(MULTI, 'step:1');
    assert.deepEqual(patch.commands, ['. venv/bin/activate', 'uvicorn main:app']);
  });

  test('dropping back to one step collapses to a plain command', () => {
    const two: ServiceConfig = { ...MULTI, commands: ['a', 'b'] };
    const patch = removeServiceRow(two, 'step:0');
    assert.equal(patch.command, 'b');
    assert.equal(patch.commands, undefined);
  });

  test('the last remaining command cannot be removed', () => {
    assert.throws(() => removeServiceRow(SINGLE, 'command'), /nothing to remove/);
    const one: ServiceConfig = { ...MULTI, commands: ['only'] };
    assert.throws(() => removeServiceRow(one, 'step:0'), /needs a command/);
  });

  test('reordering swaps neighbours — order matters, they chain with &&', () => {
    const patch = moveServiceStep(MULTI, 'step:2', -1);
    assert.deepEqual(patch.commands, [
      '. venv/bin/activate',
      'uvicorn main:app',
      'pip install -r requirements.txt',
    ]);
  });

  test('moving off either end does nothing', () => {
    assert.deepEqual(moveServiceStep(MULTI, 'step:0', -1), {});
    assert.deepEqual(moveServiceStep(MULTI, 'step:2', 1), {});
  });

  test('the cursor follows the step it moved', () => {
    assert.equal(movedStepRow('step:2', -1), 'step:1');
    assert.equal(movedStepRow('cwd', -1), 'cwd');
  });
});

describe('naming a new service', () => {
  test('steps over the runner to the part that identifies it', () => {
    assert.equal(guessServiceId('npm run worker'), 'worker');
    assert.equal(guessServiceId('pnpm dev'), 'dev');
    assert.equal(guessServiceId('python -m uvicorn main:app'), 'uvicorn');
    assert.equal(guessServiceId('docker compose up -d db'), 'up');
    assert.equal(guessServiceId('npm start'), 'start');
  });

  test('a command that is nothing but runners still yields an id', () => {
    assert.equal(guessServiceId('npm run'), 'run');
    assert.equal(guessServiceId(''), 'service');
  });

  test('a non-runner command keeps its own first word', () => {
    assert.equal(guessServiceId('uvicorn main:app --reload'), 'uvicorn');
    assert.equal(guessServiceId('celery -A app worker'), 'celery');
  });

  test('a colliding id is suffixed instead of failing the add', () => {
    assert.equal(uniqueServiceId('dev', []), 'dev');
    assert.equal(uniqueServiceId('dev', ['dev']), 'dev-2');
    assert.equal(uniqueServiceId('dev', ['dev', 'dev-2']), 'dev-3');
  });
});

describe('group form', () => {
  test('lists services, hooks and the ways to add each', () => {
    const rows = groupForm(GROUP);
    assert.ok(ids(rows).includes('svc:python-ai'));
    assert.ok(ids(rows).includes('svc:web'));
    assert.ok(ids(rows).includes('add-service'));
    assert.ok(ids(rows).includes('add-preRun'));
    assert.ok(ids(rows).includes('delete-group'));
    assert.equal(rows.find((r) => r.id === 'svc:web')?.value, 'pnpm dev');
  });

  test('a service row shows the chained command for a multi-step service', () => {
    const rows = groupForm({ ...GROUP, services: [MULTI] });
    assert.match(rows.find((r) => r.id === 'svc:python-ai')!.value, /activate && pip install/);
  });

  test('layout and order offer their real choices', () => {
    const rows = groupForm(GROUP);
    assert.deepEqual(rows.find((r) => r.id === 'layout')?.choices, [
      'dedicated',
      'aggregated',
      'split',
    ]);
    assert.deepEqual(rows.find((r) => r.id === 'order')?.choices, ['parallel', 'sequence']);
  });

  test('rowServiceId reads the service back out of a row id', () => {
    assert.equal(rowServiceId('svc:web'), 'web');
    assert.equal(rowServiceId('label'), null);
  });
});

describe('editing group hooks', () => {
  /** Through the real mutation, so a bad patch fails the test. */
  function applyToGroup(group: GroupConfig, rowId: string, value: string): GroupConfig {
    const config = { version: '1.0.0', groups: [group] };
    return updateGroup(config, group.id, applyGroupEdit(group, rowId, value)).groups[0];
  }

  test('adding the first preRun hook creates the hooks block', () => {
    const next = applyToGroup(GROUP, 'add-preRun', 'docker compose up -d db');
    assert.deepEqual(next.hooks?.preRun, ['docker compose up -d db']);
  });

  test('hooks are kept separate — adding a postStop leaves preRun alone', () => {
    const withPre = applyToGroup(GROUP, 'add-preRun', 'alembic upgrade head');
    const both = applyToGroup(withPre, 'add-postStop', 'docker compose down');
    assert.deepEqual(both.hooks?.preRun, ['alembic upgrade head']);
    assert.deepEqual(both.hooks?.postStop, ['docker compose down']);
  });

  test('removing the last hook drops the block rather than leaving it empty', () => {
    const withPre = applyToGroup(GROUP, 'add-preRun', 'echo hi');
    const config = { version: '1.0.0', groups: [withPre] };
    const cleared = updateGroup(config, 'org', removeGroupRow(withPre, 'preRun:0')).groups[0];
    assert.equal(cleared.hooks, undefined);
  });

  test('hooks reorder like steps do', () => {
    const group: GroupConfig = { ...GROUP, hooks: { preRun: ['first', 'second'] } };
    assert.deepEqual(moveGroupHook(group, 'preRun:1', -1).hooks, { preRun: ['second', 'first'] });
  });

  test('layout and order changes go through as written', () => {
    assert.equal(applyToGroup(GROUP, 'layout', 'split').layout, 'split');
    assert.equal(applyToGroup(GROUP, 'order', 'sequence').order, 'sequence');
  });

  test('an empty label is refused', () => {
    assert.throws(() => applyGroupEdit(GROUP, 'label', ' '), /cannot be empty/);
  });
});
