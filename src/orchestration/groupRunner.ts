import * as net from 'net';
import * as vscode from 'vscode';
import { findGroup, loadMergedConfig } from '../config/loader';
import { GroupConfig, ServiceConfig } from '../config/schema';
import { runHooks } from './hooks';
import { launchAggregatedGroup } from './layouts/aggregated';
import { launchDedicatedService } from './layouts/dedicated';
import { launchSplitOrDedicated } from './layouts/split';
import { MusterNarrator } from './narrator';
import {
  formatAggregatedHandoff,
  formatAllRunning,
  formatDelay,
  formatFailure,
  formatHealthOk,
  formatHook,
  formatPartial,
  formatPortWarning,
  formatReadyMatched,
  formatRunHeader,
  formatServiceLaunch,
  formatStarting,
  formatStopped,
  formatStopping,
  formatWaitingReady,
} from './narratorFormat';
import { ProcessTracker } from './processTracker';
import { buildServiceCommand } from './shell';
import { wait, waitForServiceReady } from './readiness';

export class GroupRunner {
  private readonly runningGroups = new Set<string>();

  constructor(
    private readonly tracker: ProcessTracker,
    private readonly narrator?: MusterNarrator
  ) {}

  getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  private getConfig() {
    return loadMergedConfig(this.getWorkspaceFolder());
  }

  async runGroup(groupId: string): Promise<void> {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      throw new Error(`Unknown group: ${groupId}`);
    }

    if (this.runningGroups.has(groupId)) {
      vscode.window.showWarningMessage(`Group "${group.label}" is already running.`);
      return;
    }

    this.runningGroups.add(groupId);

    this.narrator?.writeGap();
    this.narrator?.writeLine(formatRunHeader(groupId));
    this.narrator?.writeLine(
      formatStarting(group.services.length, group.layout, group.order)
    );
    this.narrator?.reveal();

    try {
      const keepExisting = group.keepExistingTerminals ??
        vscode.workspace.getConfiguration('muster').get<boolean>('keepExistingTerminals', true);

      if (!keepExisting) {
        // Only dispose terminals tracked by this group, not all workspace terminals
        await this.stopGroup(groupId, false);
      }

      if (group.hooks?.preRun?.length) {
        await runHooks(
          'preRun',
          group.hooks.preRun,
          this.getWorkspaceFolder()?.uri.fsPath,
          (line) => this.narrator?.writeLine(formatHook(line))
        );
      }

      if (group.layout === 'aggregated') {
        launchAggregatedGroup(group, this.tracker, this.getWorkspaceFolder());
        this.narrator?.writeLine(formatAggregatedHandoff(groupId, group.label));
        return;
      }

      if (group.layout === 'split') {
        await launchSplitOrDedicated(
          group,
          this.tracker,
          this.getWorkspaceFolder(),
          (svc) => this.runSingleService(group, svc)
        );
      } else {
        await this.runServicesInOrder(group);
      }

      this.narrateFinalStatus(group);
    } catch (err) {
      this.runningGroups.delete(groupId);
      this.narrator?.writeLine(formatFailure(groupId, String(err)));
      throw err;
    }
  }

  private narrateFinalStatus(group: GroupConfig): void {
    if (!this.narrator) {
      return;
    }
    const status = this.tracker.getGroupStatus(
      group.id,
      group.services.map((s) => s.id)
    );
    const total = group.services.length;
    const running = Object.values(status.services).filter((s) => s === 'running').length;
    this.narrator.writeLine(
      running === total
        ? formatAllRunning(group.id, running, total)
        : formatPartial(group.id, running, total)
    );
  }

  private async runServicesInOrder(group: GroupConfig): Promise<void> {
    const completed = new Set<string>();

    const canRun = (service: ServiceConfig): boolean => {
      if (!service.dependsOn?.length) {
        return true;
      }
      return service.dependsOn.every((dep) => completed.has(dep));
    };

    const pending = [...group.services];

    if (group.order === 'parallel') {
      await Promise.all(
        pending.map(async (service) => {
          if (service.delayMs) {
            this.narrator?.writeLine(formatDelay(service.id, service.delayMs));
            await wait(service.delayMs);
          }
          await this.runSingleService(group, service);
          completed.add(service.id);
        })
      );
      return;
    }

    while (pending.length > 0) {
      const runnable = pending.filter(canRun);
      if (runnable.length === 0) {
        throw new Error(`Circular or unsatisfied dependencies in group ${group.id}`);
      }

      for (const service of runnable) {
        const idx = pending.indexOf(service);
        pending.splice(idx, 1);
        await this.runSingleService(group, service);
        completed.add(service.id);
      }
    }
  }

  async runService(groupId: string, serviceId: string): Promise<void> {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      throw new Error(`Unknown group: ${groupId}`);
    }
    const service = group.services.find((s) => s.id === serviceId);
    if (!service) {
      throw new Error(`Unknown service: ${serviceId}`);
    }
    await this.runSingleService(group, service);
  }

  private async runSingleService(group: GroupConfig, service: ServiceConfig): Promise<void> {
    if (service.port !== undefined && (await isPortInUse(service.port))) {
      this.narrator?.writeLine(formatPortWarning(service.id, service.port));
    }
    this.narrator?.writeLine(formatServiceLaunch(service.id, buildServiceCommand(service)));
    await launchDedicatedService(group, service, this.tracker, this.getWorkspaceFolder());

    const waitingFor = [
      service.readyPattern ? 'ready pattern' : null,
      service.healthUrl ? 'health check' : null,
    ]
      .filter(Boolean)
      .join(' + ');
    if (waitingFor) {
      this.narrator?.writeLine(formatWaitingReady(service.id, waitingFor));
    }

    try {
      const healthUrl =
        service.healthUrl && service.port !== undefined
          ? service.healthUrl.replace(/\$\{port\}/g, String(service.port))
          : service.healthUrl;
      await waitForServiceReady(
        this.tracker,
        group.id,
        service.id,
        service.readyPattern,
        healthUrl,
        group.order === 'sequence' ? service.delayMs : undefined
      );
      const hasDependents = group.services.some((s) => s.dependsOn?.includes(service.id));
      if (service.readyPattern) {
        this.narrator?.writeLine(formatReadyMatched(service.id, hasDependents));
      }
      if (service.healthUrl) {
        this.narrator?.writeLine(formatHealthOk(service.id));
      }
    } catch (err) {
      this.narrator?.writeLine(formatFailure(service.id, String(err)));
      vscode.window.showErrorMessage(String(err));
    }
  }

  async stopService(groupId: string, serviceId: string): Promise<void> {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      throw new Error(`Unknown group: ${groupId}`);
    }
    if (!group.services.some((s) => s.id === serviceId)) {
      throw new Error(`Unknown service: ${serviceId}`);
    }
    this.narrator?.writeLine(formatStopping(`${groupId}/${serviceId}`));
    await this.tracker.stopGroup(groupId, [serviceId]);
    this.narrator?.writeLine(formatStopped(`${groupId}/${serviceId}`));
  }

  async restartService(groupId: string, serviceId: string): Promise<void> {
    await this.stopService(groupId, serviceId);
    await this.runService(groupId, serviceId);
  }

  async stopGroup(groupId: string, removeFromRunning = true): Promise<void> {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      throw new Error(`Unknown group: ${groupId}`);
    }

    const serviceIds = group.services.map((s) => s.id);
    this.narrator?.writeLine(formatStopping(groupId));
    await this.tracker.stopGroup(groupId, serviceIds);
    this.narrator?.writeLine(formatStopped(groupId));

    if (group.hooks?.postStop?.length) {
      try {
        await runHooks(
          'postStop',
          group.hooks.postStop,
          this.getWorkspaceFolder()?.uri.fsPath,
          (line) => this.narrator?.writeLine(formatHook(line))
        );
      } catch (err) {
        // postStop is best-effort: the group is already down, so surface
        // the failure without turning a successful stop into an error.
        this.narrator?.writeLine(formatFailure(groupId, String(err)));
      }
    }

    if (removeFromRunning) {
      this.runningGroups.delete(groupId);
    }
  }

  async restartGroup(groupId: string): Promise<void> {
    await this.stopGroup(groupId);
    await this.runGroup(groupId);
  }

  getGroupStatus(groupId: string) {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      return null;
    }
    return this.tracker.getGroupStatus(
      groupId,
      group.services.map((s) => s.id)
    );
  }

  isGroupRunning(groupId: string): boolean {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      return false;
    }
    return this.tracker.isGroupRunning(
      groupId,
      group.services.map((s) => s.id)
    );
  }
}

/** True when something is already listening on 127.0.0.1:port. */
function isPortInUse(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (inUse: boolean): void => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}
