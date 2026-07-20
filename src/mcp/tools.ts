import { defaultWorkspaceHint, findDiscovery } from '../ipc/discovery';

const NOT_RUNNING_MESSAGE =
  'Muster extension IPC not available. Is VS Code (or Cursor) open with the Muster extension activated? ' +
  'Terminal MCP clients need a running Muster extension to connect to.';

function resolveIpcPort(): number {
  // Spawned by the extension itself (vscode.lm MCP provider): env var is set.
  const fromEnv = parseInt(process.env.MUSTER_IPC_PORT ?? '', 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  // External client (Claude Code, Codex, …): find a live extension host via
  // the discovery file it writes on startup.
  const discovered = findDiscovery(defaultWorkspaceHint());
  if (discovered) {
    return discovered.port;
  }
  throw new Error(NOT_RUNNING_MESSAGE);
}

async function ipcFetch(path: string, method = 'GET', body?: Record<string, string>): Promise<unknown> {
  const port = resolveIpcPort();
  const url = `http://127.0.0.1:${port}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(NOT_RUNNING_MESSAGE);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error ?? res.statusText));
  }
  return data;
}

export async function listServerGroups(): Promise<unknown> {
  return ipcFetch('/groups');
}

export async function getGroupStatus(groupId: string): Promise<unknown> {
  return ipcFetch(`/status/${encodeURIComponent(groupId)}`);
}

// source: 'agent' marks these as agent-initiated so the extension prompts
// for confirmation before running. The CLI omits it (direct user intent).
export async function runServerGroup(groupId: string): Promise<unknown> {
  return ipcFetch('/run', 'POST', { groupId, source: 'agent' });
}

export async function stopServerGroup(groupId: string): Promise<unknown> {
  return ipcFetch('/stop', 'POST', { groupId, source: 'agent' });
}

export async function restartServerGroup(groupId: string): Promise<unknown> {
  return ipcFetch('/restart', 'POST', { groupId, source: 'agent' });
}

export async function describeConfig(): Promise<unknown> {
  return ipcFetch('/describe');
}

export async function getServiceLogs(
  groupId: string,
  serviceId: string,
  lines = 50
): Promise<unknown> {
  return ipcFetch(
    `/logs/${encodeURIComponent(groupId)}/${encodeURIComponent(serviceId)}?lines=${lines}`
  );
}
