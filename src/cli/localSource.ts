/**
 * DashboardSources over local Supervisors: the same TUI the remote
 * dashboard uses, fed from in-process state instead of the extension's
 * IPC API. LocalSource wraps the one group `muster up` is running;
 * MultiLocalSource serves bare `muster` with no VS Code — every group in
 * the config, each getting its own supervisor lazily on first run.
 */
import type { CliGroup, CliGroupStatus } from './client';
import { GroupConfig, effectiveCommand } from '../config/schema';
import { LogStore } from '../logs/store';
import { openGroupLogStore } from '../logs/forGroup';
import { Supervisor } from './supervisor';
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

  // `force` has no headless-specific behavior — see DashboardSource.stop.
  async stop(_groupId: string, serviceId?: string, _force?: boolean): Promise<void> {
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

/**
 * Every group in the config on one dashboard, no VS Code: groups start
 * idle, and a run creates (or reuses) a dedicated Supervisor for that
 * group. Quitting tears down whatever was started.
 */
export class MultiLocalSource implements DashboardSource {
  private readonly supervisors = new Map<string, Supervisor>();
  private readonly logStores = new Map<string, LogStore>();
  /** The supervisor that spoke last — its narrator feeds the status line. */
  private active: Supervisor | null = null;

  constructor(
    readonly root: string,
    /**
     * A fixed snapshot (the bare `muster` dashboard reads config once, same
     * as before) or a loader called on every lookup — the daemon passes one
     * that re-reads .vscode/muster.json, so a group created after the
     * daemon started is still runnable without a restart.
     */
    private readonly groupsSource: GroupConfig[] | (() => GroupConfig[]),
    private readonly detect = true,
    /** Persist logs to disk per group; omitted, logs live only in memory. */
    private readonly persistLogs = false
  ) {}

  private get allGroups(): GroupConfig[] {
    return typeof this.groupsSource === 'function' ? this.groupsSource() : this.groupsSource;
  }

  get workspace(): string {
    return this.root;
  }

  private groupConfig(groupId: string): GroupConfig {
    const group = this.allGroups.find((g) => g.id === groupId);
    if (!group) throw new Error(`Unknown group "${groupId}"`);
    return group;
  }

  private supervisorFor(groupId: string): Supervisor {
    const existing = this.supervisors.get(groupId);
    if (existing) return existing;
    const group = this.groupConfig(groupId);
    let logStore: LogStore | undefined;
    const supervisor: Supervisor = new Supervisor(
      group,
      this.root,
      () => {
        this.active = supervisor;
      },
      this.detect,
      this.persistLogs
        ? (logStore = openGroupLogStore(this.root, group, (w) => supervisor.note(`⚠ ${w}`)).store)
        : undefined
    );
    if (logStore) this.logStores.set(groupId, logStore);
    this.supervisors.set(groupId, supervisor);
    return supervisor;
  }

  async groups(): Promise<CliGroup[]> {
    return this.allGroups.map((g) => ({
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
    }));
  }

  async status(groupId: string): Promise<CliGroupStatus> {
    const supervisor = this.supervisors.get(groupId);
    if (supervisor) {
      return { groupId, ...supervisor.snapshot() };
    }
    const group = this.groupConfig(groupId);
    return {
      groupId,
      state: 'idle',
      services: Object.fromEntries(group.services.map((s) => [s.id, 'idle'])),
    };
  }

  async logs(groupId: string, serviceId: string, lines = 500): Promise<string[]> {
    return this.supervisors.get(groupId)?.logsOf(serviceId, lines) ?? [];
  }

  async run(groupId: string, serviceId?: string): Promise<void> {
    const supervisor = this.supervisorFor(groupId);
    if (serviceId) {
      await supervisor.startService(serviceId);
    } else {
      // Group starts can gate on ready patterns for minutes — stream
      // progress through statuses/narrator instead of blocking the UI.
      void supervisor.runGroup();
    }
  }

  // `force` has no headless-specific behavior — see DashboardSource.stop.
  async stop(groupId: string, serviceId?: string, _force?: boolean): Promise<void> {
    const supervisor = this.supervisors.get(groupId);
    if (!supervisor) return; // never started — nothing to stop
    if (serviceId) {
      await supervisor.stopService(serviceId);
    } else {
      await supervisor.stopGroup();
    }
  }

  async restart(groupId: string, serviceId?: string): Promise<void> {
    const supervisor = this.supervisors.get(groupId);
    if (!supervisor) {
      await this.run(groupId, serviceId);
      return;
    }
    if (serviceId) {
      await supervisor.restartService(serviceId);
    } else {
      await supervisor.stopGroup();
      void supervisor.runGroup();
    }
  }

  /** The latest narrator line across every started group. */
  get lastActivity(): string {
    return this.active?.lastActivity ?? '';
  }

  /** True while the group has a supervisor with anything still alive. */
  isRunning(groupId: string): boolean {
    return this.supervisors.get(groupId)?.alive ?? false;
  }

  /**
   * Stop a group and forget its supervisor entirely — mirrors
   * GroupRunner.disposeGroup, for the same reason: deleting a group from
   * config must not leave its processes running with nothing left to stop
   * them. Persisted logs are left alone; retention handles their cleanup.
   */
  async disposeGroup(groupId: string): Promise<void> {
    const supervisor = this.supervisors.get(groupId);
    if (supervisor) {
      await supervisor.down();
      this.supervisors.delete(groupId);
    }
    this.logStores.get(groupId)?.dispose();
    this.logStores.delete(groupId);
  }

  /** Tear down every supervisor this session started. */
  async downAll(): Promise<void> {
    await Promise.all([...this.supervisors.values()].map((s) => s.down()));
    for (const store of this.logStores.values()) store.dispose();
  }
}
