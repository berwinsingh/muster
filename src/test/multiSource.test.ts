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
