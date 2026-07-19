import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoveryFilePath,
  findDiscovery,
  isPidAlive,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from '../ipc/discovery';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muster-discovery-'));
}

describe('ipc discovery', () => {
  test('write/read roundtrip finds the live entry by exact workspace', () => {
    const dir = tmpDir();
    const workspace = '/home/dev/project-a';
    writeDiscoveryFile({ port: 43210, workspace, pid: process.pid }, dir);

    const found = findDiscovery(workspace, dir);
    assert.ok(found);
    assert.equal(found.port, 43210);
    assert.equal(found.workspace, workspace);
  });

  test('matches when the hint is a subdirectory of the workspace', () => {
    const dir = tmpDir();
    const workspace = '/home/dev/project-a';
    writeDiscoveryFile({ port: 43211, workspace, pid: process.pid }, dir);

    const found = findDiscovery(path.join(workspace, 'backend', 'src'), dir);
    assert.ok(found);
    assert.equal(found.port, 43211);
  });

  test('removes stale entries with dead pids and returns null when none live', () => {
    const dir = tmpDir();
    // PID 2^30 is far above any real pid ceiling.
    writeDiscoveryFile({ port: 43212, workspace: '/dead/ws', pid: 2 ** 30 }, dir);

    const found = findDiscovery('/dead/ws', dir);
    assert.equal(found, null);
    assert.equal(fs.existsSync(discoveryFilePath('/dead/ws', dir)), false);
  });

  test('ignores unparsable and invalid files', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'garbage.json'), 'not json', 'utf-8');
    fs.writeFileSync(path.join(dir, 'badport.json'), JSON.stringify({ port: 0, workspace: '/x', pid: process.pid }), 'utf-8');

    assert.equal(findDiscovery('/x', dir), null);
  });

  test('falls back to the only live entry when workspace does not match', () => {
    const dir = tmpDir();
    writeDiscoveryFile({ port: 43213, workspace: '/home/dev/other', pid: process.pid }, dir);

    const found = findDiscovery('/somewhere/else', dir);
    assert.ok(found);
    assert.equal(found.port, 43213);
  });

  test('removeDiscoveryFile deletes the entry and tolerates repeats', () => {
    const dir = tmpDir();
    const workspace = '/home/dev/project-b';
    writeDiscoveryFile({ port: 43214, workspace, pid: process.pid }, dir);

    removeDiscoveryFile(workspace, dir);
    assert.equal(findDiscovery(workspace, dir), null);
    removeDiscoveryFile(workspace, dir); // second call must not throw
  });

  test('returns null when the discovery directory does not exist', () => {
    assert.equal(findDiscovery('/any', path.join(os.tmpdir(), 'muster-none-such')), null);
  });

  test('isPidAlive is true for the current process and false for junk', () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(2 ** 30), false);
  });
});
