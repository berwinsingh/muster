/**
 * The MCP tools refuse to act on someone else's workspace.
 *
 * Its own file, not part of mcpTools.test.ts, because that suite sets
 * MUSTER_IPC_PORT for every test in it — the fast path that skips discovery
 * entirely, which is exactly the code under test here. Separate file,
 * separate process, no env cross-talk.
 */
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeDiscoveryFile } from '../ipc/discovery';
import { listServerGroups } from '../mcp/tools';

let home: string;
let savedHome: string | undefined;
let savedPort: string | undefined;
let savedWorkspace: string | undefined;

/** A directory with a .vscode/muster.json in it. */
function workspaceWithConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-guard-ws-'));
  fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.vscode', 'muster.json'),
    JSON.stringify({ version: '1.0.0', groups: [] })
  );
  return dir;
}

describe('MCP tools and an unrelated workspace', () => {
  before(() => {
    savedHome = process.env.HOME;
    savedPort = process.env.MUSTER_IPC_PORT;
    savedWorkspace = process.env.MUSTER_WORKSPACE;
    // getDiscoveryDir() is derived from the home directory, so this points
    // discovery at a scratch dir instead of the real one.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-guard-home-'));
    process.env.HOME = home;
    // The env fast path would skip discovery — the thing being tested.
    delete process.env.MUSTER_IPC_PORT;
  });

  after(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedPort === undefined) delete process.env.MUSTER_IPC_PORT;
    else process.env.MUSTER_IPC_PORT = savedPort;
    if (savedWorkspace === undefined) delete process.env.MUSTER_WORKSPACE;
    else process.env.MUSTER_WORKSPACE = savedWorkspace;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('refuses a server on another workspace when this one has a config', async () => {
    const theirs = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-guard-theirs-'));
    const mine = workspaceWithConfig();
    // A live server (this test process's own pid) owning an unrelated dir.
    writeDiscoveryFile(
      { port: 59999, workspace: theirs, pid: process.pid },
      path.join(home, '.config', 'muster', 'ipc')
    );
    process.env.MUSTER_WORKSPACE = mine;

    // Port 59999 has nothing on it: if the guard failed to fire we would
    // get a connection error instead, so the message itself is the assertion.
    await assert.rejects(listServerGroups(), (err: Error) => {
      assert.match(err.message, /serves/);
      assert.ok(err.message.includes(theirs), 'names the workspace it found');
      assert.ok(err.message.includes(mine), 'names the workspace we are in');
      return true;
    });
  });

  test('still connects when this directory has no config of its own', async () => {
    const theirs = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-guard-theirs2-'));
    // Bare temp dir, no .vscode/muster.json anywhere above it.
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-guard-none-'));
    writeDiscoveryFile(
      { port: 59998, workspace: theirs, pid: process.pid },
      path.join(home, '.config', 'muster', 'ipc')
    );
    process.env.MUSTER_WORKSPACE = nowhere;

    // Nothing is listening on 59998, so this fails either way — what matters
    // is that it fails trying to reach the server, not refusing to.
    await assert.rejects(listServerGroups(), (err: Error) => {
      assert.doesNotMatch(err.message, /serves/);
      return true;
    });
  });
});
