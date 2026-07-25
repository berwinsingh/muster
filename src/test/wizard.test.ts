import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'node:stream';
import { openLocalConfig } from '../cli/localConfig';
import { runFirstGroupWizard } from '../cli/wizard';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muster-wizard-'));
}

/** Run the wizard feeding one answer per question, capturing output. */
async function drive(root: string, answers: string[]): Promise<{ result: Awaited<ReturnType<typeof runFirstGroupWizard>>; output: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (c) => {
    captured += c.toString();
  });
  const done = runFirstGroupWizard(root, { input, output });
  // readline/promises drops lines that arrive while no question is
  // pending, so pace the answers: one per event-loop turn keeps each
  // line paired with its question.
  for (const answer of answers) {
    input.write(answer + '\n');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }
  input.end();
  const result = await done;
  return { result, output: captured };
}

function strip(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('first-group wizard', () => {
  test('creates a group with two services, defaults, and detection', async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'v20\n');
    const { result, output } = await drive(root, [
      'My App',        // group name
      'npm run dev',   // service 1 command
      '',              // id -> default (npm)
      '',              // cwd -> .
      '3000',          // port
      'sleep 5',       // service 2 command
      'worker',        // id
      '',              // cwd
      '',              // port
      '',              // no more services
      'n',             // don't start
    ]);
    assert.deepEqual(result, { groupId: 'my-app', start: false });
    const config = openLocalConfig(root)!.config;
    assert.equal(config.groups.length, 1);
    const [group] = config.groups;
    assert.equal(group.label, 'My App');
    assert.deepEqual(group.services.map((s) => s.id), ['npm', 'worker']);
    assert.equal(group.services[0].port, 3000);
    assert.deepEqual(group.services[0].node, { version: '20' }); // .nvmrc detected
    assert.ok(strip(output).includes('.nvmrc pins v20'));
  });

  test('empty first command aborts without writing anything', async () => {
    const root = tempDir();
    const { result } = await drive(root, ['dev', '']);
    assert.equal(result, null);
    assert.equal(openLocalConfig(root), null);
  });

  test('duplicate default ids are deduped, invalid port skipped', async () => {
    const root = tempDir();
    const { result, output } = await drive(root, [
      '',              // group name -> dev
      'npm run api',   // service 1
      '', '', 'abc',   // id npm, cwd ., invalid port
      'npm run web',   // service 2 -> defaults to npm again
      '', '', '',      // id (deduped), cwd, port
      '',              // finish
      'no',            // don't start
    ]);
    assert.deepEqual(result, { groupId: 'dev', start: false });
    const [group] = openLocalConfig(root)!.config.groups;
    assert.deepEqual(group.services.map((s) => s.id), ['npm', 'npm-2']);
    assert.equal(group.services[0].port, undefined);
    assert.ok(strip(output).includes('not a valid port'));
  });

  test('closed input mid-wizard aborts cleanly', async () => {
    const root = tempDir();
    const { result } = await drive(root, ['dev', 'npm run dev', 'api']);
    assert.equal(result, null);
    assert.equal(openLocalConfig(root), null);
  });

  test('relative cwd is stored as ${workspaceFolder}/…', async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'server'));
    const { result } = await drive(root, [
      'dev', 'python app.py', 'api', 'server', '', '', 'y',
    ]);
    assert.deepEqual(result, { groupId: 'dev', start: true });
    const [group] = openLocalConfig(root)!.config.groups;
    assert.equal(group.services[0].cwd, '${workspaceFolder}/server');
  });
});
