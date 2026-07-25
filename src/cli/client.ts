import { IpcServerKind, defaultWorkspaceHint, findDiscovery } from '../ipc/discovery';

export type CliService = { id: string; name: string; command: string; port?: number };
export type CliGroup = {
  id: string;
  label: string;
  layout: string;
  order: string;
  services: CliService[];
};
export type CliGroupStatus = {
  groupId: string;
  state: string;
  services: Record<string, string>;
};

export const NOT_RUNNING =
  'Could not reach a Muster daemon or extension. Start one with "muster daemon start", ' +
  'or open the workspace in VS Code (or Cursor) with the Muster extension installed, then retry.';

export class IpcClient {
  private constructor(
    readonly port: number,
    readonly workspace: string,
    /**
     * Which server is on the other end. Only known for real when resolved
     * via discovery; a connection forced through MUSTER_IPC_PORT (the
     * extension's own env-var fast path) can't tell, so it assumes
     * 'extension' — the one thing that env var has always meant.
     */
    readonly kind: IpcServerKind = 'extension'
  ) {}

  static connect(): IpcClient {
    const fromEnv = parseInt(process.env.MUSTER_IPC_PORT ?? '', 10);
    if (Number.isInteger(fromEnv) && fromEnv > 0) {
      return new IpcClient(fromEnv, process.cwd());
    }
    const found = findDiscovery(defaultWorkspaceHint());
    if (!found) {
      throw new Error(NOT_RUNNING);
    }
    return new IpcClient(found.port, found.workspace, found.kind ?? 'extension');
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(NOT_RUNNING);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.error ?? res.statusText));
    }
    return data;
  }

  async groups(): Promise<CliGroup[]> {
    const data = (await this.request('/groups')) as { groups: CliGroup[] };
    return data.groups;
  }

  async status(groupId: string): Promise<CliGroupStatus> {
    return (await this.request(`/status/${encodeURIComponent(groupId)}`)) as CliGroupStatus;
  }

  async logs(groupId: string, serviceId: string, lines = 100): Promise<string[]> {
    const data = (await this.request(
      `/logs/${encodeURIComponent(groupId)}/${encodeURIComponent(serviceId)}?lines=${lines}`
    )) as { lines: string[] };
    return data.lines;
  }

  run(groupId: string, serviceId?: string): Promise<unknown> {
    return this.request('/run', 'POST', { groupId, ...(serviceId ? { serviceId } : {}) });
  }

  stop(groupId: string, serviceId?: string, force = false): Promise<unknown> {
    return this.request('/stop', 'POST', {
      groupId,
      ...(serviceId ? { serviceId } : {}),
      ...(force ? { force: true } : {}),
    });
  }

  restart(groupId: string, serviceId?: string): Promise<unknown> {
    return this.request('/restart', 'POST', { groupId, ...(serviceId ? { serviceId } : {}) });
  }

  createGroup(input: unknown): Promise<unknown> {
    return this.request('/config/create-group', 'POST', input);
  }

  addService(groupId: string, service: unknown): Promise<unknown> {
    return this.request('/config/add-service', 'POST', { groupId, service });
  }

  updateGroup(groupId: string, patch: unknown): Promise<unknown> {
    return this.request('/config/update-group', 'POST', { groupId, patch });
  }

  updateService(groupId: string, serviceId: string, patch: unknown): Promise<unknown> {
    return this.request('/config/update-service', 'POST', { groupId, serviceId, patch });
  }

  deleteGroup(groupId: string): Promise<unknown> {
    return this.request('/config/delete-group', 'POST', { groupId });
  }

  deleteService(groupId: string, serviceId: string): Promise<unknown> {
    return this.request('/config/delete-service', 'POST', { groupId, serviceId });
  }

  initConfig(): Promise<unknown> {
    return this.request('/config/init', 'POST', {});
  }
}
