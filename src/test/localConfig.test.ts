import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initLocalConfig, openLocalConfig, saveLocalConfig } from '../cli/localConfig';
import { addService, createGroup, deleteGroup, updateService } from '../config/mutate';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muster-local-'));
}

describe('local config store', () => {
  test('openLocalConfig returns null with no config anywhere', () => {
    assert.equal(openLocalConfig(os.tmpdir()), null);
  });

  test('initLocalConfig scaffolds the example config', () => {
    const dir = tempDir();
    const file = initLocalConfig(dir);
    assert.equal(file, path.join(dir, '.vscode', 'muster.json'));
    const local = openLocalConfig(dir);
    assert.ok(local);
    assert.equal(local.root, dir);
    assert.ok(local.config.groups.length > 0);
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(raw.$schema, '../schemas/muster.schema.json');
  });

  test('initLocalConfig refuses to clobber existing groups', () => {
    const dir = tempDir();
    initLocalConfig(dir);
    assert.throws(() => initLocalConfig(dir), /already has groups/);
  });

  test('create → add → edit → delete round-trip preserves raw values', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, '.vscode'));
    fs.writeFileSync(
      path.join(dir, '.vscode', 'muster.json'),
      JSON.stringify({ version: '1.0.0', groups: [] })
    );

    let local = openLocalConfig(dir)!;
    saveLocalConfig(
      local.root,
      createGroup(local.config, {
        id: 'dev',
        service: { id: 'api', command: 'npm run dev', cwd: '${workspaceFolder}/backend' },
      })
    );

    local = openLocalConfig(dir)!;
    saveLocalConfig(local.root, addService(local.config, 'dev', { id: 'web', command: 'pnpm dev' }));

    local = openLocalConfig(dir)!;
    saveLocalConfig(
      local.root,
      updateService(local.config, 'dev', 'api', { port: 8000, python: { venv: '.venv' } })
    );

    local = openLocalConfig(dir)!;
    const api = local.config.groups[0].services.find((s) => s.id === 'api')!;
    // ${workspaceFolder} must survive the round-trip un-substituted
    assert.equal(api.cwd, '${workspaceFolder}/backend');
    assert.equal(api.port, 8000);
    assert.deepEqual(api.python, { venv: '.venv' });
    assert.equal(local.config.groups[0].services.length, 2);

    saveLocalConfig(local.root, deleteGroup(local.config, 'dev'));
    assert.equal(openLocalConfig(dir)!.config.groups.length, 0);
  });

  test('openLocalConfig surfaces schema errors readably', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, '.vscode'));
    fs.writeFileSync(
      path.join(dir, '.vscode', 'muster.json'),
      JSON.stringify({ version: '1.0.0', groups: [{ id: 'broken' }] })
    );
    assert.throws(() => openLocalConfig(dir), /Invalid .*muster\.json/);
  });

  test('walks up from a nested directory to the config root', () => {
    const dir = tempDir();
    initLocalConfig(dir);
    const nested = path.join(dir, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(openLocalConfig(nested)?.root, dir);
  });
});
