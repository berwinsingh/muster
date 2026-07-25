import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startDaemonServer } from '../daemon/server';
import { findDiscovery, readExactDiscovery } from '../ipc/discovery';

let stateDir: string;
let discoveryDir: string;

function makeWorkspace(config: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-daemon-ws-'));
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.vscode', 'muster.json'),
    JSON.stringify(config, null, 2)
  );
  return root;
}

function oneShotGroupConfig() {
  return {
    version: '1.0.0',
    groups: [
      {
        id: 'demo',
        label: 'Demo',
        layout: 'dedicated',
        order: 'parallel',
        services: [
          { id: 'echo', name: 'Echo', command: 'echo hello-from-daemon' },
        ],
      },
    ],
  };
}

async function getJson(port: number, path_: string): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}${path_}`);
  return { status: res.status, body: await res.json() };
}

async function postJson(port: number, path_: string, body: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}${path_}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}

describe('daemon HTTP server', () => {
  before(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-daemon-state-'));
    discoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-daemon-disco-'));
    process.env.MUSTER_HOME = stateDir;
  });

  after(() => {
    delete process.env.MUSTER_HOME;
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(discoveryDir, { recursive: true, force: true });
  });

  it('answers /health and registers discovery with kind "daemon"', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({ root, detect: false, discoveryDir });
    try {
      const { status, body } = await getJson(daemon.port, '/health');
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.kind, 'daemon');

      const found = readExactDiscovery(root, 'daemon', discoveryDir);
      assert.ok(found);
      assert.equal(found!.port, daemon.port);
      assert.equal(found!.pid, process.pid);
    } finally {
      await daemon.dispose();
    }
  });

  it('lists groups and reflects config edits made through /config/*', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({ root, detect: false, discoveryDir });
    try {
      const before_ = await getJson(daemon.port, '/groups');
      assert.equal(before_.body.groups.length, 1);
      assert.equal(before_.body.groups[0].id, 'demo');

      const created = await postJson(daemon.port, '/config/create-group', {
        id: 'second',
        label: 'Second',
        service: { id: 'svc', command: 'echo hi' },
      });
      assert.equal(created.status, 200);

      const after_ = await getJson(daemon.port, '/groups');
      assert.equal(after_.body.groups.length, 2);
      assert.ok(after_.body.groups.some((g: any) => g.id === 'second'));
    } finally {
      await daemon.dispose();
    }
  });

  it('runs a service and its output is retrievable via /logs', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({ root, detect: false, discoveryDir });
    try {
      const run = await postJson(daemon.port, '/run', { groupId: 'demo' });
      assert.equal(run.status, 200);

      // Poll the logs directly rather than status: `exit` can fire slightly
      // ahead of the last buffered stdout `data` event, so "state settled"
      // is not a reliable proxy for "output fully captured".
      let lines: string[] = [];
      await waitFor(async () => {
        const logs = await getJson(daemon.port, '/logs/demo/echo?lines=50');
        lines = logs.body.lines;
        return lines.some((l: string) => l.includes('hello-from-daemon'));
      });
      assert.ok(
        lines.some((l) => l.includes('hello-from-daemon')),
        `expected daemon output, got ${JSON.stringify(lines)}`
      );
    } finally {
      await daemon.dispose();
    }
  });

  it('rejects agent-sourced writes when allowAgentActions is off', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({
      root,
      detect: false,
      discoveryDir,
      allowAgentActions: false,
    });
    try {
      const run = await postJson(daemon.port, '/run', { groupId: 'demo', source: 'agent' });
      assert.equal(run.status, 403);
      assert.match(run.body.error, /allow-agent-actions/);
    } finally {
      await daemon.dispose();
    }
  });

  it('accepts agent-sourced writes when allowAgentActions is on', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({
      root,
      detect: false,
      discoveryDir,
      allowAgentActions: true,
    });
    try {
      const run = await postJson(daemon.port, '/run', { groupId: 'demo', source: 'agent' });
      assert.equal(run.status, 200);
    } finally {
      await daemon.dispose();
    }
  });

  it('a plain (non-agent) direct CLI write is never gated', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({
      root,
      detect: false,
      discoveryDir,
      allowAgentActions: false,
    });
    try {
      const run = await postJson(daemon.port, '/run', { groupId: 'demo' });
      assert.equal(run.status, 200);
    } finally {
      await daemon.dispose();
    }
  });

  it('deleting a running group kills its process before the config write', async () => {
    const root = makeWorkspace({
      version: '1.0.0',
      groups: [
        {
          id: 'longrun',
          label: 'Long Runner',
          layout: 'dedicated',
          order: 'parallel',
          services: [{ id: 'sleeper', name: 'Sleeper', command: 'sleep 30' }],
        },
      ],
    });
    const daemon = await startDaemonServer({ root, detect: false, discoveryDir });
    try {
      await postJson(daemon.port, '/run', { groupId: 'longrun' });
      await waitFor(async () => daemon.source.isRunning('longrun'));

      const del = await postJson(daemon.port, '/config/delete-group', { groupId: 'longrun' });
      assert.equal(del.status, 200);

      // The group is gone from config...
      const groups = await getJson(daemon.port, '/groups');
      assert.equal(groups.body.groups.length, 0);
      // ...and its process was actually stopped, not orphaned.
      assert.equal(daemon.source.isRunning('longrun'), false);
    } finally {
      await daemon.dispose();
    }
  });

  it('returns 404 for an unknown group on lifecycle routes', async () => {
    const root = makeWorkspace(oneShotGroupConfig());
    const daemon = await startDaemonServer({ root, detect: false, discoveryDir });
    try {
      const run = await postJson(daemon.port, '/run', { groupId: 'nope' });
      assert.equal(run.status, 404);
    } finally {
      await daemon.dispose();
    }
  });

  it('dispose stops every running service and removes the discovery file', async () => {
    const root = makeWorkspace({
      version: '1.0.0',
      groups: [
        {
          id: 'toclean',
          label: 'To Clean',
          layout: 'dedicated',
          order: 'parallel',
          services: [{ id: 'sleeper', name: 'Sleeper', command: 'sleep 30' }],
        },
      ],
    });
    const daemon = await startDaemonServer({ root, detect: false, discoveryDir });
    await postJson(daemon.port, '/run', { groupId: 'toclean' });
    await waitFor(async () => daemon.source.isRunning('toclean'));

    await daemon.dispose();

    assert.equal(daemon.source.isRunning('toclean'), false);
    assert.equal(readExactDiscovery(root, 'daemon', discoveryDir), null);
  });

  it('findDiscovery prefers a daemon entry over an extension entry for the same workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-daemon-prefer-'));
    const workspace = '/fake/shared-workspace';
    // Both "servers" claim to be alive by using this test process's own pid.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'aaaaaaaaaaaa.json'),
      JSON.stringify({ port: 11111, workspace, pid: process.pid, kind: 'extension' })
    );
    fs.writeFileSync(
      path.join(dir, 'bbbbbbbbbbbb.daemon.json'),
      JSON.stringify({ port: 22222, workspace, pid: process.pid, kind: 'daemon' })
    );
    // Real files are named by workspace hash, but findDiscovery only reads
    // the directory and inspects contents, so arbitrary names still work
    // for this comparison-only test.
    const found = findDiscovery(workspace, dir);
    assert.ok(found);
    assert.equal(found!.kind, 'daemon');
    assert.equal(found!.port, 22222);
  });
});
