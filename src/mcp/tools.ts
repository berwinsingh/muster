const IPC_PORT = process.env.DEVSTACK_IPC_PORT ?? '';

async function ipcFetch(path: string, method = 'GET', body?: Record<string, string>): Promise<unknown> {
  if (!IPC_PORT) {
    throw new Error(
      'DevStack extension IPC not available. Ensure the DevStack extension is activated in VS Code.'
    );
  }

  const url = `http://127.0.0.1:${IPC_PORT}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

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

export async function runServerGroup(groupId: string): Promise<unknown> {
  return ipcFetch('/run', 'POST', { groupId });
}

export async function stopServerGroup(groupId: string): Promise<unknown> {
  return ipcFetch('/stop', 'POST', { groupId });
}

export async function restartServerGroup(groupId: string): Promise<unknown> {
  return ipcFetch('/restart', 'POST', { groupId });
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
