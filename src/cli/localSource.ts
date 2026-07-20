/**
 * DashboardSource over a local Supervisor: the same TUI the remote
 * dashboard uses, fed from in-process state instead of the extension's
 * IPC API. One group per session — the one `muster up` is running.
 */
import type { CliGroup, CliGroupStatus } from './client';
import { effectiveCommand } from '../config/schema';
import type { Supervisor } from './supervisor';
import type { DashboardSource } from './tui';

/** Virtual service id for the supervisor's own narrator feed. */
export const MUSTER_FEED = '@muster';

export class LocalSource implements DashboardSource {
  constructor(private readonly supervisor: Supervisor) {}

  get workspace(): string {
    return this.supervisor.root;
  }

  async groups(): Promise<CliGroup[]> {
    const g = this.supervisor.group;
    return [
      {
        id: g.id,
        label: g.label,
        layout: 'headless',
        order: g.order,
        services: g.services.map((s) => ({
          id: s.id,
          name: s.name,
          command: effectiveCommand(s),
          port: s.port,
        })),
      },
    ];
  }

  async status(groupId: string): Promise<CliGroupStatus> {
    return { groupId, ...this.supervisor.snapshot() };
  }

  async logs(_groupId: string, serviceId: string, lines = 500): Promise<string[]> {
    return this.supervisor.logsOf(serviceId, lines);
  }

  async run(_groupId: string, serviceId?: string): Promise<void> {
    if (serviceId) {
      await this.supervisor.startService(serviceId);
    } else {
      // Group starts can gate on ready patterns for minutes — stream
      // progress through statuses/narrator instead of blocking the UI.
      void this.supervisor.runGroup();
    }
  }

  async stop(_groupId: string, serviceId?: string): Promise<void> {
    if (serviceId) {
      await this.supervisor.stopService(serviceId);
    } else {
      await this.supervisor.stopGroup();
    }
  }

  async restart(_groupId: string, serviceId?: string): Promise<void> {
    if (serviceId) {
      await this.supervisor.restartService(serviceId);
    } else {
      await this.supervisor.stopGroup();
      void this.supervisor.runGroup();
    }
  }
}
