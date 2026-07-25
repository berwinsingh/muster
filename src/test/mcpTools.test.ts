import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startDaemonServer, DaemonServer } from '../daemon/server';
import {
  addServiceToGroup,
  createServerGroup,
  getFilteredServiceLogs,
  listServerGroups,
  restartServerGroup,
  runServerGroup,
  stopServerGroup,
} from '../mcp/tools';

let stateDir: string;
let discoveryDir: string;
let daemon: DaemonServer;
let root: string;

function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-mcp-ws-'));
  fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.vscode', 'muster.json'),
    JSON.stringify({ version: '1.0.0', groups: [] }, null, 2)
  );
  return dir;
}

describe('MCP tools reach a standalone daemon (no VS Code involved)', () => {
  before(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-mcp-state-'));
    discoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-mcp-disco-'));
    process.env.MUSTER_HOME = stateDir;
    root = makeWorkspace();
    daemon = await startDaemonServer({ root, detect: false, discoveryDir, allowAgentActions: true });
    // tools.ts checks MUSTER_IPC_PORT before discovery — the same fast path
    // the extension's own vscode.lm MCP provider uses, and simplest here.
    process.env.MUSTER_IPC_PORT = String(daemon.port);
  });

  after(async () => {
    delete process.env.MUSTER_IPC_PORT;
    delete process.env.MUSTER_HOME;
    await daemon.dispose();
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(discoveryDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('create_server_group defines a new group with its first service', async () => {
    const result = (await createServerGroup({
      id: 'web',
      label: 'Web',
      service: { id: 'api', command: 'echo api-line' },
    })) as { ok: boolean; groups: string[] };
    assert.equal(result.ok, true);
    assert.deepEqual(result.groups, ['web']);

    const groups = (await listServerGroups()) as { groups: { id: string; services: { id: string }[] }[] };
    const web = groups.groups.find((g) => g.id === 'web');
    assert.ok(web, 'expected the "web" group to exist after create_server_group');
    assert.deepEqual(
      web!.services.map((s) => s.id),
      ['api']
    );
  });

  it('add_service_to_group adds a second service to the existing group', async () => {
    await addServiceToGroup('web', { id: 'worker', command: 'echo worker-line' });

    const groups = (await listServerGroups()) as { groups: { id: string; services: { id: string }[] }[] };
    const web = groups.groups.find((g) => g.id === 'web');
    assert.deepEqual(
      web!.services.map((s) => s.id).sort(),
      ['api', 'worker']
    );
  });

  it('create_server_group rejects a duplicate group id with a clear error', async () => {
    await assert.rejects(
      createServerGroup({ id: 'web', service: { id: 'x', command: 'echo x' } }),
      /already exists/i
    );
  });

  it('the LLM can run the group it just defined, then read its logs, then stop it', async () => {
    await runServerGroup('web');

    let lines: string[] = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const logs = (await getFilteredServiceLogs('web', undefined, 100, 'all')) as {
        lines: string[];
      };
      lines = logs.lines;
      if (lines.some((l) => l.includes('api-line')) && lines.some((l) => l.includes('worker-line'))) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      lines.some((l) => l.includes('[api] api-line')),
      `expected tagged api output, got ${JSON.stringify(lines)}`
    );
    assert.ok(
      lines.some((l) => l.includes('[worker] worker-line')),
      `expected tagged worker output, got ${JSON.stringify(lines)}`
    );

    await stopServerGroup('web');
  });

  it('restart_server_group works after a stop', async () => {
    const result = (await restartServerGroup('web')) as { ok: boolean };
    assert.equal(result.ok, true);
  });
});
