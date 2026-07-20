import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConfigRoot, loadHeadlessConfig, substitute } from '../cli/headlessConfig';

function makeWorkspace(config: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-headless-'));
  fs.mkdirSync(path.join(dir, '.vscode'));
  fs.writeFileSync(path.join(dir, '.vscode', 'muster.json'), JSON.stringify(config));
  return dir;
}

describe('headless config', () => {
  test('substitute handles workspaceFolder, basename, and env vars', () => {
    process.env.MUSTER_TEST_VAR = 'hello';
    assert.equal(substitute('${workspaceFolder}/x', '/tmp/proj'), '/tmp/proj/x');
    assert.equal(substitute('${workspaceFolderBasename}', '/tmp/proj'), 'proj');
    assert.equal(substitute('${env:MUSTER_TEST_VAR}', '/x'), 'hello');
    delete process.env.MUSTER_TEST_VAR;
  });

  test('findConfigRoot walks up from a nested directory', () => {
    const root = makeWorkspace({ version: '1.0.0', groups: [] });
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(findConfigRoot(nested), root);
    assert.equal(findConfigRoot(os.tmpdir()), null);
  });

  test('loadHeadlessConfig validates and resolves service paths', () => {
    const root = makeWorkspace({
      version: '1.0.0',
      groups: [
        {
          id: 'g',
          label: 'G',
          services: [
            { id: 's', name: 'S', command: 'echo ${workspaceFolderBasename}', cwd: '${workspaceFolder}/sub' },
          ],
        },
      ],
    });
    const { groups } = loadHeadlessConfig(root);
    assert.equal(groups[0].services[0].cwd, path.join(root, 'sub'));
    assert.equal(groups[0].services[0].command, `echo ${path.basename(root)}`);
  });

  test('loadHeadlessConfig surfaces schema errors readably', () => {
    const root = makeWorkspace({ version: '1.0.0', groups: [{ id: 'g' }] });
    assert.throws(() => loadHeadlessConfig(root), /Invalid .*muster\.json/);
  });

  test('services default cwd to the workspace root', () => {
    const root = makeWorkspace({
      version: '1.0.0',
      groups: [{ id: 'g', label: 'G', services: [{ id: 's', name: 'S', command: 'echo hi' }] }],
    });
    const { groups } = loadHeadlessConfig(root);
    assert.equal(groups[0].services[0].cwd, root);
  });
});
