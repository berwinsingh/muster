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
  workspaceContains,
  writeDiscoveryFile,
} from '../ipc/discovery';
import { reconcileWorkspace } from '../cli/client';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muster-discovery-'));
}

/**
 * A workspace that exists on disk. findDiscovery treats a vanished
 * workspace as stale, so entries in these tests need a real directory.
 */
function tmpWorkspace(name: string): string {
  const ws = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'muster-ws-')), name);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

describe('ipc discovery', () => {
  test('write/read roundtrip finds the live entry by exact workspace', () => {
    const dir = tmpDir();
    const workspace = tmpWorkspace('project-a');
    writeDiscoveryFile({ port: 43210, workspace, pid: process.pid }, dir);

    const found = findDiscovery(workspace, dir);
    assert.ok(found);
    assert.equal(found.port, 43210);
    assert.equal(found.workspace, workspace);
  });

  test('matches when the hint is a subdirectory of the workspace', () => {
    const dir = tmpDir();
    const workspace = tmpWorkspace('project-a');
    writeDiscoveryFile({ port: 43211, workspace, pid: process.pid }, dir);

    const found = findDiscovery(path.join(workspace, 'backend', 'src'), dir);
    assert.ok(found);
    assert.equal(found.port, 43211);
  });

  test('removes stale entries with dead pids and returns null when none live', () => {
    const dir = tmpDir();
    const workspace = tmpWorkspace('dead-ws');
    // PID 2^30 is far above any real pid ceiling.
    writeDiscoveryFile({ port: 43212, workspace, pid: 2 ** 30 }, dir);

    const found = findDiscovery(workspace, dir);
    assert.equal(found, null);
    assert.equal(fs.existsSync(discoveryFilePath(workspace, dir)), false);
  });

  test('ignores and prunes an entry whose workspace directory is gone', () => {
    const dir = tmpDir();
    // The reproduced case: a live VS Code extension host still holding a
    // discovery file for a scratch workspace that has since been deleted.
    const gone = tmpWorkspace('deleted-later');
    writeDiscoveryFile({ port: 43215, workspace: gone, pid: process.pid }, dir);
    fs.rmSync(gone, { recursive: true });

    // Not even for its own workspace, let alone as a fallback for another.
    assert.equal(findDiscovery(gone, dir), null);
    assert.equal(findDiscovery('/somewhere/else', dir), null);
    assert.equal(fs.existsSync(discoveryFilePath(gone, dir)), false);
  });

  test('a live entry still wins when a vanished one sits beside it', () => {
    const dir = tmpDir();
    const gone = tmpWorkspace('gone');
    const real = tmpWorkspace('real');
    writeDiscoveryFile({ port: 43216, workspace: gone, pid: process.pid }, dir);
    writeDiscoveryFile({ port: 43217, workspace: real, pid: process.pid }, dir);
    fs.rmSync(gone, { recursive: true });

    const found = findDiscovery(real, dir);
    assert.ok(found);
    assert.equal(found.port, 43217);
  });

  test('ignores unparsable and invalid files', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'garbage.json'), 'not json', 'utf-8');
    fs.writeFileSync(path.join(dir, 'badport.json'), JSON.stringify({ port: 0, workspace: '/x', pid: process.pid }), 'utf-8');

    assert.equal(findDiscovery('/x', dir), null);
  });

  test('falls back to the only live entry when workspace does not match', () => {
    const dir = tmpDir();
    writeDiscoveryFile({ port: 43213, workspace: tmpWorkspace('other'), pid: process.pid }, dir);

    const found = findDiscovery('/somewhere/else', dir);
    assert.ok(found);
    assert.equal(found.port, 43213);
  });

  test('removeDiscoveryFile deletes the entry and tolerates repeats', () => {
    const dir = tmpDir();
    const workspace = tmpWorkspace('project-b');
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

  test('workspaceContains covers self and descendants, not siblings', () => {
    assert.equal(workspaceContains('/home/dev/app', '/home/dev/app'), true);
    assert.equal(workspaceContains('/home/dev/app', '/home/dev/app/src/api'), true);
    assert.equal(workspaceContains('/home/dev/app', '/home/dev/other'), false);
    // A shared name prefix is not containment.
    assert.equal(workspaceContains('/home/dev/app', '/home/dev/app-two'), false);
    // The parent of a workspace is not inside it.
    assert.equal(workspaceContains('/home/dev/app', '/home/dev'), false);
    assert.equal(workspaceContains('', '/home/dev'), false);
  });
});

describe('reconcileWorkspace', () => {
  test('uses the server silently when it serves this directory', () => {
    const r = reconcileWorkspace('/home/dev/app', 'daemon', '/home/dev/app/src', '/home/dev/app');
    assert.equal(r.useServer, true);
    assert.equal(r.notice, null);
  });

  test('prefers the local config when the server serves an unrelated workspace', () => {
    const r = reconcileWorkspace('/tmp/scratch/qa-workspace', 'extension', '/home/dev/app', '/home/dev/app');
    assert.equal(r.useServer, false);
    assert.ok(r.notice);
    // Both paths named, so the mismatch is obvious without guessing.
    assert.ok(r.notice.includes('/tmp/scratch/qa-workspace'));
    assert.ok(r.notice.includes('/home/dev/app'));
  });

  test('keeps the server but says so when this directory has no config', () => {
    const r = reconcileWorkspace('/home/dev/app', 'daemon', '/home/dev', null);
    assert.equal(r.useServer, true);
    assert.ok(r.notice);
    assert.ok(r.notice.includes('/home/dev/app'));
    assert.ok(r.notice.includes('/home/dev'));
  });

  test('a config in a parent of the served workspace does not count as serving it', () => {
    // The server is deeper than the config root — cwd is outside it.
    const r = reconcileWorkspace('/home/dev/app/packages/api', 'daemon', '/home/dev/app', '/home/dev/app');
    assert.equal(r.useServer, false);
  });
});
