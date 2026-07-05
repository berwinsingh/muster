import * as http from 'http';
import * as vscode from 'vscode';
import { loadMergedConfig, loadMergedConfigFromPaths } from '../config/loader';
import { GroupRunner } from '../orchestration/groupRunner';
import { ProcessTracker } from '../orchestration/processTracker';
import { getUserProfilesPath, getWorkspaceConfigPath } from '../config/paths';

export type IpcServer = {
  port: number;
  dispose: () => void;
};

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

export function startIpcServer(
  runner: GroupRunner,
  tracker: ProcessTracker
): IpcServer {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && url.pathname === '/groups') {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
        const config = workspaceRoot
          ? loadMergedConfig(vscode.workspace.workspaceFolders![0])
          : loadMergedConfigFromPaths(null);
        jsonResponse(res, 200, {
          groups: config.groups.map((g) => ({
            id: g.id,
            label: g.label,
            layout: g.layout,
            order: g.order,
            services: g.services.map((s) => ({ id: s.id, name: s.name, command: s.command })),
          })),
          sources: config.sources,
        });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/status/')) {
        const groupId = decodeURIComponent(url.pathname.slice('/status/'.length));
        const status = runner.getGroupStatus(groupId);
        if (!status) {
          jsonResponse(res, 404, { error: `Unknown group: ${groupId}` });
          return;
        }
        jsonResponse(res, 200, status);
        return;
      }

      if (method === 'GET' && url.pathname === '/describe') {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
        jsonResponse(res, 200, {
          userProfilesPath: getUserProfilesPath(),
          workspaceConfigPath: workspaceRoot ? getWorkspaceConfigPath(workspaceRoot) : null,
          schemaPath: 'schemas/devstack.schema.json',
          ipcPort: process.env.DEVSTACK_IPC_PORT,
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
          lines: tracker.getRecentOutput(groupId, serviceId, lines),
        });
        return;
      }

      if (method === 'POST') {
        const bodyRaw = await readBody(req);
        const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, string>) : {};

        if (url.pathname === '/run') {
          if (!vscode.workspace.isTrusted) {
            jsonResponse(res, 403, { error: 'Workspace is not trusted' });
            return;
          }
          const groupId = body.groupId;
          if (!groupId) {
            jsonResponse(res, 400, { error: 'groupId required' });
            return;
          }
          await runner.runGroup(groupId);
          jsonResponse(res, 200, { ok: true, groupId });
          return;
        }

        if (url.pathname === '/stop') {
          if (!vscode.workspace.isTrusted) {
            jsonResponse(res, 403, { error: 'Workspace is not trusted' });
            return;
          }
          const groupId = body.groupId;
          if (!groupId) {
            jsonResponse(res, 400, { error: 'groupId required' });
            return;
          }
          await runner.stopGroup(groupId);
          jsonResponse(res, 200, { ok: true, groupId });
          return;
        }

        if (url.pathname === '/restart') {
          if (!vscode.workspace.isTrusted) {
            jsonResponse(res, 403, { error: 'Workspace is not trusted' });
            return;
          }
          const groupId = body.groupId;
          if (!groupId) {
            jsonResponse(res, 400, { error: 'groupId required' });
            return;
          }
          await runner.restartGroup(groupId);
          jsonResponse(res, 200, { ok: true, groupId });
          return;
        }
      }

      jsonResponse(res, 404, { error: 'Not found' });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  server.listen(0, '127.0.0.1');
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  process.env.DEVSTACK_IPC_PORT = String(port);

  return {
    port,
    dispose: () => {
      server.close();
      delete process.env.DEVSTACK_IPC_PORT;
    },
  };
}
