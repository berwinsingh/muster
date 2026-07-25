/**
 * The standalone daemon's IPC server. Same wire protocol as the VS Code
 * extension's (src/ipc/server.ts) — same routes, same request/response
 * shapes — so the existing CLI client and MCP tools work against either
 * one unmodified. The difference is entirely on the inside: this is backed
 * by MultiLocalSource (plain Supervisors, real child processes) instead of
 * GroupRunner/ProcessTracker (vscode.Terminal), so it runs with no editor
 * open at all.
 *
 * Deliberately not a copy-paste of ipc/server.ts with vscode calls ripped
 * out: workspace-trust and the modal agent-confirmation dialog are both
 * VS-Code-specific concepts with no headless equivalent. Agent-sourced
 * writes are instead gated by `allowAgentActions`, set once when the
 * daemon starts (see the CLI's `daemon start --allow-agent-actions`) —
 * the closest a background process can get to "the user must say yes".
 */
import * as http from 'http';
import { GroupConfig, effectiveCommand } from '../config/schema';
import {
  addService,
  createGroup,
  deleteGroup,
  deleteService,
  updateGroup,
  updateService,
} from '../config/mutate';
import { WritableWorkspaceConfig, getExampleConfig } from '../config/payload';
import { initLocalConfig, openLocalConfig, saveLocalConfig } from '../cli/localConfig';
import { loadHeadlessConfig } from '../cli/headlessConfig';
import { MultiLocalSource } from '../cli/localSource';
import { IpcServerKind, removeDiscoveryFile, writeDiscoveryFile } from '../ipc/discovery';

export type DaemonServer = {
  port: number;
  source: MultiLocalSource;
  /** Stop every running group, close the HTTP server, remove discovery. */
  dispose: () => Promise<void>;
};

export type DaemonServerOptions = {
  root: string;
  detect?: boolean;
  /**
   * Allow MCP/agent-sourced lifecycle writes (run/stop/restart) with no
   * human confirming each one — the headless equivalent of the extension's
   * muster.confirmAgentActions being turned off. Defaults to false: a
   * freshly started daemon refuses agent writes until the user opts in,
   * the same "off by default" posture the extension ships with.
   */
  allowAgentActions?: boolean;
  /** Overridden by tests to avoid touching ~/.config/muster/ipc. */
  discoveryDir?: string;
};

const DISCOVERY_KIND: IpcServerKind = 'daemon';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function toCliGroups(groups: GroupConfig[]): unknown[] {
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    layout: g.layout,
    order: g.order,
    services: g.services.map((s) => ({
      id: s.id,
      name: s.name,
      command: effectiveCommand(s),
      port: s.port,
    })),
  }));
}

/** Re-read groups from disk on every request — a config edit must be visible immediately. */
function currentGroups(root: string): GroupConfig[] {
  return loadHeadlessConfig(root).groups;
}

function findGroup(root: string, groupId: string): GroupConfig | undefined {
  return currentGroups(root).find((g) => g.id === groupId);
}

export function startDaemonServer(opts: DaemonServerOptions): Promise<DaemonServer> {
  const { root } = opts;
  const detect = opts.detect ?? true;
  const allowAgentActions = opts.allowAgentActions ?? false;

  // A loader, not a snapshot: config mutations happen through this same
  // server for as long as it runs, and a group created after startup must
  // be runnable without restarting the daemon.
  const source = new MultiLocalSource(root, () => currentGroups(root), detect, true);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        jsonResponse(res, 200, { ok: true, kind: 'daemon' });
        return;
      }

      if (method === 'GET' && url.pathname === '/groups') {
        const groups = currentGroups(root);
        jsonResponse(res, 200, {
          groups: toCliGroups(groups),
          sources: { userProfilesPath: null, workspaceConfigPath: root, extendedProfile: null },
        });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/status/')) {
        const groupId = decodeURIComponent(url.pathname.slice('/status/'.length));
        const group = findGroup(root, groupId);
        if (!group) {
          jsonResponse(res, 404, { error: `Unknown group: ${groupId}` });
          return;
        }
        jsonResponse(res, 200, await source.status(groupId));
        return;
      }

      if (method === 'GET' && url.pathname === '/describe') {
        jsonResponse(res, 200, {
          userProfilesPath: null,
          workspaceConfigPath: root,
          schemaPath: 'schemas/muster.schema.json',
          ipcPort: undefined,
          kind: 'daemon',
        });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/logs/')) {
        const parts = url.pathname.slice('/logs/'.length).split('/');
        const groupId = decodeURIComponent(parts[0] ?? '');
        const serviceId = decodeURIComponent(parts[1] ?? '');
        const lines = parseInt(url.searchParams.get('lines') ?? '50', 10);
        jsonResponse(res, 200, {
          groupId,
          serviceId,
          lines: await source.logs(groupId, serviceId, Number.isFinite(lines) ? lines : 50),
        });
        return;
      }

      if (method === 'POST') {
        const bodyRaw = await readBody(req);
        const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};

        if (url.pathname === '/shutdown') {
          jsonResponse(res, 200, { ok: true });
          // Give the response a tick to flush before tearing down.
          setImmediate(() => void dispose());
          return;
        }

        const force = body.force === true || body.force === 'true';
        const lifecycle: Record<string, (groupId: string, serviceId?: string) => Promise<void>> = {
          '/run': (groupId, serviceId) => source.run(groupId, serviceId),
          '/stop': (groupId, serviceId) => source.stop(groupId, serviceId, force),
          '/restart': (groupId, serviceId) => source.restart(groupId, serviceId),
        };

        const action = lifecycle[url.pathname];
        if (action) {
          const groupId = typeof body.groupId === 'string' ? body.groupId : '';
          if (!groupId) {
            jsonResponse(res, 400, { error: 'groupId required' });
            return;
          }
          if (!findGroup(root, groupId)) {
            jsonResponse(res, 404, { error: `Unknown group: ${groupId}` });
            return;
          }
          if (body.source === 'agent' && !allowAgentActions) {
            jsonResponse(res, 403, {
              error:
                'This daemon was started without agent actions enabled. Restart it with ' +
                '"muster daemon start --allow-agent-actions", or run the action yourself from the CLI.',
            });
            return;
          }
          const serviceId = typeof body.serviceId === 'string' ? body.serviceId : undefined;
          await action(groupId, serviceId);
          jsonResponse(res, 200, { ok: true, groupId, serviceId });
          return;
        }

        if (url.pathname.startsWith('/config/')) {
          try {
            const existing = openLocalConfig(root);
            const current: WritableWorkspaceConfig = existing?.config ?? {
              version: '1.0.0',
              groups: [],
            };
            let next: WritableWorkspaceConfig = current;
            const b = body as Record<string, unknown>;
            switch (url.pathname) {
              case '/config/create-group':
                next = createGroup(current, b as never) as WritableWorkspaceConfig;
                break;
              case '/config/add-service':
                next = addService(current, String(b.groupId), b.service as never) as WritableWorkspaceConfig;
                break;
              case '/config/update-group':
                next = updateGroup(current, String(b.groupId), b.patch as never) as WritableWorkspaceConfig;
                break;
              case '/config/update-service':
                next = updateService(
                  current,
                  String(b.groupId),
                  String(b.serviceId),
                  b.patch as never
                ) as WritableWorkspaceConfig;
                break;
              case '/config/delete-group': {
                const groupId = String(b.groupId);
                // Stop and forget the group's processes before the config
                // entry disappears — otherwise they keep running, holding
                // their ports, with nothing left to stop them.
                await source.disposeGroup(groupId);
                next = deleteGroup(current, groupId) as WritableWorkspaceConfig;
                break;
              }
              case '/config/delete-service': {
                const groupId = String(b.groupId);
                const serviceId = String(b.serviceId);
                if (source.isRunning(groupId)) {
                  await source.stop(groupId, serviceId, true);
                }
                next = deleteService(current, groupId, serviceId) as WritableWorkspaceConfig;
                break;
              }
              case '/config/init':
                if (current.groups.length > 0) {
                  jsonResponse(res, 400, {
                    error: 'Config already has groups — nothing to initialize',
                  });
                  return;
                }
                next = getExampleConfig();
                initLocalConfig(root);
                break;
              default:
                jsonResponse(res, 404, { error: 'Not found' });
                return;
            }
            if (url.pathname !== '/config/init') {
              saveLocalConfig(root, next);
            }
            jsonResponse(res, 200, { ok: true, groups: next.groups.map((g) => g.id) });
          } catch (err) {
            jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
      }

      jsonResponse(res, 404, { error: 'Not found' });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  const discoveryDir = opts.discoveryDir;

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await source.downAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    removeDiscoveryFile(root, discoveryDir, DISCOVERY_KIND);
  };

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      writeDiscoveryFile(
        { port, workspace: root, pid: process.pid, kind: DISCOVERY_KIND },
        discoveryDir
      );
      resolve({ port, source, dispose });
    });
  });
}
