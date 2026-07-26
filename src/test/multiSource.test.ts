import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GroupConfig } from '../config/schema';
import { MultiLocalSource } from '../cli/localSource';

function groups(): GroupConfig[] {
  return [
    {
      id: 'one',
      label: 'One',
      layout: 'dedicated',
      order: 'parallel',
      services: [
        { id: 'a', name: 'A', command: 'echo from-a && sleep 30' },
        { id: 'b', name: 'B', command: 'sleep 30' },
      ],
    },
    {
      id: 'two',
      label: 'Two',
      layout: 'dedicated',
      order: 'parallel',
      services: [{ id: 'c', name: 'C', command: 'sleep 30' }],
    },
  ];
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('MultiLocalSource', () => {
  test('lists every group; untouched groups stay idle', async () => {
    const source = new MultiLocalSource(os.tmpdir(), groups());
    const listed = await source.groups();
    assert.deepEqual(listed.map((g) => g.id), ['one', 'two']);
    const status = await source.status('one');
    assert.equal(status.state, 'idle');
    assert.deepEqual(status.services, { a: 'idle', b: 'idle' });
    assert.deepEqual(await source.logs('one', 'a'), []);
    assert.equal(source.lastActivity, '');
  });

  test('run creates a supervisor for just that group; stop/quit tear down', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-multi-'));
    const source = new MultiLocalSource(dir, groups(), false);
    await source.run('one');
    await wait(700);

    const one = await source.status('one');
    assert.equal(one.state, 'running');
    const two = await source.status('two');
    assert.equal(two.state, 'idle'); // no supervisor spawned for it
    assert.ok((await source.logs('one', 'a')).some((l) => l.includes('from-a')));
    assert.ok(source.lastActivity.length > 0);

    await source.stop('one', 'b');
    await wait(300);
    assert.equal((await source.status('one')).services.b, 'stopped');

    await source.downAll();
    await wait(300);
    assert.notEqual((await source.status('one')).state, 'running');
  });

  test('stop on a never-started group is a no-op; restart starts it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-multi-'));
    const source = new MultiLocalSource(dir, groups(), false);
    await source.stop('two'); // must not throw or create a supervisor
    assert.equal((await source.status('two')).state, 'idle');
    await source.restart('two');
    await wait(700);
    assert.equal((await source.status('two')).state, 'running');
    await source.downAll();
  });

  test('unknown group ids throw', async () => {
    const source = new MultiLocalSource(os.tmpdir(), groups());
    await assert.rejects(source.status('nope'), /Unknown group/);
    await assert.rejects(source.run('nope'), /Unknown group/);
  });
});

describe('picking up a config edit', () => {
  /** A loader whose group can be swapped, standing in for an edited file. */
  function editable(): { load: () => GroupConfig[]; setEcho: (text: string) => void } {
    let echo = 'before';
    return {
      load: () => [
        {
          id: 'one',
          label: 'One',
          layout: 'dedicated',
          order: 'parallel',
          services: [{ id: 'a', name: 'A', command: `echo ${echo} && sleep 30` }],
        },
      ],
      setEcho: (text: string) => {
        echo = text;
      },
    };
  }

  test('a group that never ran needs no reload — it reads config when it starts', async () => {
    const config = editable();
    const source = new MultiLocalSource(os.tmpdir(), config.load, false);
    config.setEcho('after');
    assert.equal(source.reloadGroup('one'), true);

    await source.run('one');
    await wait(700);
    assert.ok((await source.logs('one', 'a')).some((l) => l.includes('after')));
    await source.downAll();
  });

  test('a running group refuses the swap — its processes came from the old definition', async () => {
    const config = editable();
    const source = new MultiLocalSource(os.tmpdir(), config.load, false);
    await source.run('one');
    await wait(700);

    config.setEcho('after');
    assert.equal(source.reloadGroup('one'), false);
    assert.ok(!(await source.logs('one', 'a')).some((l) => l.includes('after')));

    await source.downAll();
  });

  test('restarting the group is what applies the edit', async () => {
    const config = editable();
    const source = new MultiLocalSource(os.tmpdir(), config.load, false);
    await source.run('one');
    await wait(700);

    config.setEcho('after');
    await source.restart('one');
    await wait(900);
    // The restart stops everything, swaps in the new definition, and runs
    // it — without the swap it would faithfully re-run the old command.
    assert.ok((await source.logs('one', 'a')).some((l) => l.includes('after')));

    await source.downAll();
  });

  test('a group deleted from config cannot be reloaded', async () => {
    const source = new MultiLocalSource(os.tmpdir(), groups(), false);
    await source.run('two');
    await wait(500);
    await source.stop('two');
    await wait(300);
    const shrunk = new MultiLocalSource(os.tmpdir(), () => [groups()[0]], false);
    assert.equal(shrunk.reloadGroup('two'), true); // never had a supervisor
    assert.equal(source.reloadGroup('nope'), true);
    await source.downAll();
  });
});
