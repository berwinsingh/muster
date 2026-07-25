import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'node:stream';
import { openLocalConfig } from '../cli/localConfig';
import { runFirstGroupWizard } from '../cli/wizard';
import { slugifyId } from '../config/slugify';

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
  // These temp dirs contain no package.json/Makefile/etc, so detection finds
  // nothing and the wizard goes straight to manual entry — the path these
  // tests are about. Discovery has its own tests below.
  test('creates a group with two services, defaults, and detection', async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'v20\n');
    const { result, output } = await drive(root, [
      'npm run dev',   // service 1 command
      '',              // id -> default (npm)
      '',              // cwd -> .
      '3000',          // port
      'sleep 5',       // service 2 command
      'worker',        // id
      '',              // cwd
      '',              // port
      '',              // no more services
      'My App',        // group name (asked last, once services are known)
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
    const { result } = await drive(root, ['']);
    assert.equal(result, null);
    assert.equal(openLocalConfig(root), null);
  });

  test('the group name defaults to the project folder name', async () => {
    // "dev" told you nothing about which project it belonged to.
    const root = tempDir();
    const { result } = await drive(root, [
      'npm run dev', '', '', '',
      '',            // finish
      '',            // accept the default name
      'n',
    ]);
    assert.equal(result!.groupId, slugifyId(path.basename(root), 'dev'));
  });

  test('duplicate default ids are deduped, invalid port skipped', async () => {
    const root = tempDir();
    const { result, output } = await drive(root, [
      'npm run api',   // service 1
      '', '', 'abc',   // id npm, cwd ., invalid port
      'npm run web',   // service 2 -> defaults to npm again
      '', '', '',      // id (deduped), cwd, port
      '',              // finish
      'dev',           // group name
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
    const { result } = await drive(root, ['npm run dev', 'api']);
    assert.equal(result, null);
    assert.equal(openLocalConfig(root), null);
  });

  test('relative cwd is stored as ${workspaceFolder}/…', async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'server'));
    const { result } = await drive(root, [
      'python app.py', 'api', 'server', '', '', 'dev', 'y',
    ]);
    assert.deepEqual(result, { groupId: 'dev', start: true });
    const [group] = openLocalConfig(root)!.config.groups;
    assert.equal(group.services[0].cwd, '${workspaceFolder}/server');
  });
});

describe('first-group wizard: service discovery', () => {
  /** A monorepo-shaped project the scanner will find several services in. */
  function monorepo(): string {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web', scripts: { dev: 'next dev' } })
    );
    fs.writeFileSync(path.join(root, 'apps', 'web', 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(root, 'apps', 'api', 'pyproject.toml'), '[project]\nname="api"\n');
    return root;
  }

  test('lists what it found and creates the picked services', async () => {
    const root = monorepo();
    const { result, output } = await drive(root, [
      '1 2',   // pick both detected services
      '',      // port for the first
      '',      // port for the second
      '',      // no manual extras
      'stack', // group name
      'n',
    ]);
    const clean = strip(output);
    assert.ok(clean.includes('found 2'), clean);
    assert.ok(clean.includes('apps/web'), clean);
    assert.ok(clean.includes('apps/api'), clean);

    assert.equal(result!.groupId, 'stack');
    const [group] = openLocalConfig(root)!.config.groups;
    assert.deepEqual(group.services.map((s) => s.id).sort(), ['api', 'web']);
    // Directory and command come from the scan, so nobody types a path.
    const web = group.services.find((s) => s.id === 'web')!;
    assert.equal(web.cwd, '${workspaceFolder}/apps/web');
    assert.equal(web.command, 'pnpm run dev'); // pnpm-lock.yaml, not npm
  });

  test('a range picks several at once', async () => {
    const root = monorepo();
    const { result } = await drive(root, ['1-2', '', '', '', 'stack', 'n']);
    assert.equal(result!.groupId, 'stack');
    assert.equal(openLocalConfig(root)!.config.groups[0].services.length, 2);
  });

  test('"all" picks everything', async () => {
    const root = monorepo();
    const { result } = await drive(root, ['all', '', '', '', 'stack', 'n']);
    assert.equal(result!.groupId, 'stack');
    assert.equal(openLocalConfig(root)!.config.groups[0].services.length, 2);
  });

  test('an out-of-range pick is reported, not silently dropped', async () => {
    const root = monorepo();
    const { output } = await drive(root, [
      '1 9',        // 9 does not exist
      '',           // port for the one valid pick
      '',           // no manual extras
      'stack', 'n',
    ]);
    const clean = strip(output);
    assert.ok(clean.includes('ignoring "9"'), clean);
    assert.ok(clean.includes('1 to 2'), clean);
  });

  test('an empty pick falls through to typing a command manually', async () => {
    const root = monorepo();
    const { result } = await drive(root, [
      '',              // pick nothing
      'npm run solo',  // manual command
      'solo', '', '',  // id, cwd, port
      '',              // finish
      'stack', 'n',
    ]);
    const [group] = openLocalConfig(root)!.config.groups;
    assert.deepEqual(group.services.map((s) => s.id), ['solo']);
    assert.equal(result!.groupId, 'stack');
  });

  test('picked services can be topped up with a manual one', async () => {
    const root = monorepo();
    const { result } = await drive(root, [
      '1',              // one detected
      '',               // its port
      'redis-server',   // plus something the scan cannot know about
      'cache', '', '',
      '',               // finish
      'stack', 'n',
    ]);
    assert.equal(result!.groupId, 'stack');
    const [group] = openLocalConfig(root)!.config.groups;
    assert.equal(group.services.length, 2);
    assert.ok(group.services.some((s) => s.id === 'cache'));
  });
});
