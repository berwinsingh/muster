import { LogLevel, filterLog, stripAnsi } from '../cli/logFilter';
import { findConfigRoot } from '../cli/headlessConfig';
import { defaultWorkspaceHint, findDiscovery, servesElsewhere } from '../ipc/discovery';

const NOT_RUNNING_MESSAGE =
  'No Muster daemon or extension is reachable for this workspace. Start one with ' +
  '"muster daemon start --allow-agent-actions" (no editor needed), or open the workspace ' +
  'in VS Code (or Cursor) with the Muster extension activated.';

function resolveIpcPort(): number {
  // Spawned by the extension itself (vscode.lm MCP provider): env var is set.
  const fromEnv = parseInt(process.env.MUSTER_IPC_PORT ?? '', 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  // External client (Claude Code, Codex, …): find a live server via the
  // discovery file it writes on startup — a standalone daemon when one is
  // running for this workspace, else the extension. Same wire protocol
  // either way, so nothing below this line needs to know which it got.
  const here = defaultWorkspaceHint();
  const discovered = findDiscovery(here);
  if (!discovered) {
    throw new Error(NOT_RUNNING_MESSAGE);
  }
  // Same rule as the CLI, with a sharper consequence. These tools run and
  // stop real processes, and there is no local config to fall back on — so
  // when the reachable server belongs to someone else's workspace and this
  // one has a config of its own, refuse. Acting on the wrong workspace is
  // worse than doing nothing, and an agent cannot see a warning line.
  const localRoot = findConfigRoot(here);
  if (servesElsewhere(discovered.workspace, here, localRoot)) {
    throw new Error(
      `The reachable Muster ${discovered.kind ?? 'extension'} serves ${discovered.workspace}, ` +
        `not ${localRoot}. Start one for this workspace with "muster daemon start ` +
        '--allow-agent-actions", or set MUSTER_WORKSPACE to target another.'
    );
  }
  return discovered.port;
}

async function ipcFetch(path: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> {
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

/**
 * What is runnable in this workspace, detected from the files on disk.
 * An agent can read a repo itself, but that is guesswork it pays context
 * for; this returns the same list the CLI wizard offers, so create_server_group
 * can be called with a command and cwd that are known to exist.
 */
export async function suggestServices(): Promise<unknown> {
  return ipcFetch('/suggest-services');
}

export type NewServiceInput = {
  id: string;
  name?: string;
  command: string;
  cwd?: string;
  port?: number;
};

export type CreateGroupInput = {
  id: string;
  label?: string;
  layout?: 'dedicated' | 'aggregated' | 'split';
  order?: 'parallel' | 'sequence';
  service: NewServiceInput;
};

// Not agent-gated: like `/config/*` for the CLI, defining a group writes
// to muster.json but starts nothing — the thing that actually needs a
// human's say-so is run_server_group, gated separately.
export async function createServerGroup(input: CreateGroupInput): Promise<unknown> {
  return ipcFetch('/config/create-group', 'POST', input);
}

export async function addServiceToGroup(
  groupId: string,
  service: NewServiceInput
): Promise<unknown> {
  return ipcFetch('/config/add-service', 'POST', { groupId, service });
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

/**
 * Logs for one service — or, with no serviceId, every service in the
 * group tagged "[service] line" — filtered by severity and/or substring
 * so agents can ask for exactly "the errors from the api service".
 */
export async function getFilteredServiceLogs(
  groupId: string,
  serviceId: string | undefined,
  lines: number,
  level: LogLevel,
  contains?: string
): Promise<unknown> {
  const fetchOne = async (id: string): Promise<string[]> => {
    const data = (await getServiceLogs(groupId, id, lines)) as { lines?: string[] };
    return data.lines ?? [];
  };

  let raw: string[];
  if (serviceId) {
    raw = await fetchOne(serviceId);
  } else {
    const data = (await listServerGroups()) as {
      groups?: { id: string; services: { id: string }[] }[];
    };
    const group = data.groups?.find((g) => g.id === groupId);
    if (!group) {
      throw new Error(`Unknown group "${groupId}"`);
    }
    raw = [];
    for (const svc of group.services) {
      const serviceLines = await fetchOne(svc.id).catch(() => [] as string[]);
      raw.push(...serviceLines.map((line) => `[${svc.id}] ${line}`));
    }
  }

  const filtered = filterLog(raw, level, contains ?? '').map(stripAnsi);
  return {
    groupId,
    serviceId: serviceId ?? null,
    level,
    contains: contains ?? null,
    totalLines: raw.length,
    matchedLines: filtered.length,
    lines: filtered,
  };
}
