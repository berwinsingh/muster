import * as http from 'http';
import * as vscode from 'vscode';
import { loadMergedConfig, loadMergedConfigFromPaths } from '../config/loader';
import { effectiveCommand } from '../config/schema';
import { addService, createGroup, deleteGroup, deleteService } from '../config/mutate';
import {
  getExampleConfig,
  readWritableWorkspaceConfig,
  saveWorkspaceConfig,
} from '../config/writer';
import { ActionSource, confirmationMessage, shouldConfirmAgentAction } from './confirm';
import { GroupRunner } from '../orchestration/groupRunner';
import { ProcessTracker } from '../orchestration/processTracker';
import { getUserProfilesPath, getWorkspaceConfigPath } from '../config/paths';
import { removeDiscoveryFile, writeDiscoveryFile } from './discovery';

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
            services: g.services.map((s) => ({
              id: s.id,
              name: s.name,
              command: effectiveCommand(s),
              port: s.port,
            })),
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
          schemaPath: 'schemas/muster.schema.json',
          ipcPort: process.env.MUSTER_IPC_PORT,
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

        const lifecycle: Record<string, (groupId: string, serviceId?: string) => Promise<void>> = {
          '/run': (groupId, serviceId) =>
            serviceId ? runner.runService(groupId, serviceId) : runner.runGroup(groupId),
          '/stop': (groupId, serviceId) =>
            serviceId ? runner.stopService(groupId, serviceId) : runner.stopGroup(groupId),
          '/restart': (groupId, serviceId) =>
            serviceId ? runner.restartService(groupId, serviceId) : runner.restartGroup(groupId),
        };

        const action = lifecycle[url.pathname];
        if (action) {
          if (!vscode.workspace.isTrusted) {
            jsonResponse(res, 403, { error: 'Workspace is not trusted' });
            return;
          }
          const groupId = body.groupId;
          if (!groupId) {
            jsonResponse(res, 400, { error: 'groupId required' });
            return;
          }

          // Agent-initiated writes wait for the human. Modal so it can't be
          // missed; "Allow" is the only affirmative — dismiss/Escape denies.
          const settingEnabled = vscode.workspace
            .getConfiguration('muster')
            .get<boolean>('confirmAgentActions', true);
          if (shouldConfirmAgentAction(body.source as ActionSource, settingEnabled)) {
            const choice = await vscode.window.showWarningMessage(
              confirmationMessage(url.pathname, groupId, body.serviceId || undefined),
              {
                modal: true,
                detail:
                  'Allow this action? Turn off agent confirmations in Settings → muster.confirmAgentActions.',
              },
              'Allow'
            );
            if (choice !== 'Allow') {
              jsonResponse(res, 403, { error: 'User denied the agent action' });
              return;
            }
          }

          await action(groupId, body.serviceId || undefined);
          jsonResponse(res, 200, { ok: true, groupId, serviceId: body.serviceId });
          return;
        }

        // Config mutations (create/add/delete/init). Direct user intent from
        // the CLI — routed through the extension so the write goes through
        // the same validating writer and the tree refreshes live via the
        // file watcher. Unknown groups/dupes throw and become a 400.
        if (url.pathname.startsWith('/config/')) {
          if (!vscode.workspace.isTrusted) {
            jsonResponse(res, 403, { error: 'Workspace is not trusted' });
            return;
          }
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (!folder) {
            jsonResponse(res, 400, { error: 'No workspace folder open' });
            return;
          }
          try {
            const current = await readWritableWorkspaceConfig(folder);
            let next = current;
            const b = body as Record<string, unknown>;
            switch (url.pathname) {
              case '/config/create-group':
                next = createGroup(current, b as never);
                break;
              case '/config/add-service':
                next = addService(current, String(b.groupId), b.service as never);
                break;
              case '/config/delete-group':
                next = deleteGroup(current, String(b.groupId));
                break;
              case '/config/delete-service':
                next = deleteService(current, String(b.groupId), String(b.serviceId));
                break;
              case '/config/init':
                if (current.groups.length > 0) {
                  jsonResponse(res, 400, {
                    error: 'Config already has groups — nothing to initialize',
                  });
                  return;
                }
                next = getExampleConfig();
                break;
              default:
                jsonResponse(res, 404, { error: 'Not found' });
                return;
            }
            await saveWorkspaceConfig(folder, next);
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

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const result: IpcServer = {
    port: 0,
    dispose: () => {
      server.close();
      delete process.env.MUSTER_IPC_PORT;
      try {
        removeDiscoveryFile(workspaceRoot);
      } catch {
        // best effort
      }
    },
  };

  // The port is only known once the 'listening' event fires; reading
  // server.address() synchronously after listen() returns null.
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    result.port = port;
    process.env.MUSTER_IPC_PORT = String(port);
    try {
      // Lets external MCP clients (Claude Code, Codex) find this endpoint.
      writeDiscoveryFile({ port, workspace: workspaceRoot, pid: process.pid });
    } catch {
      // discovery is optional; in-VS-Code clients still work via the env var
    }
  });

  return result;
}
