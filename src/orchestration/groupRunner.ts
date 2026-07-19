import * as vscode from 'vscode';
import { findGroup, loadMergedConfig } from '../config/loader';
import { GroupConfig, ServiceConfig } from '../config/schema';
import { launchAggregatedGroup } from './layouts/aggregated';
import { launchDedicatedService } from './layouts/dedicated';
import { launchSplitOrDedicated } from './layouts/split';
import { ProcessTracker } from './processTracker';
import { wait, waitForServiceReady } from './readiness';

export class GroupRunner {
  private readonly runningGroups = new Set<string>();

  constructor(private readonly tracker: ProcessTracker) {}

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

    try {
      const keepExisting = group.keepExistingTerminals ??
        vscode.workspace.getConfiguration('muster').get<boolean>('keepExistingTerminals', true);

      if (!keepExisting) {
        // Only dispose terminals tracked by this group, not all workspace terminals
        await this.stopGroup(groupId, false);
      }

      if (group.layout === 'aggregated') {
        launchAggregatedGroup(group, this.tracker, this.getWorkspaceFolder());
        return;
      }

      if (group.layout === 'split') {
        await launchSplitOrDedicated(
          group,
          this.tracker,
          this.getWorkspaceFolder(),
          (svc) => this.runSingleService(group, svc)
        );
        return;
      }

      await this.runServicesInOrder(group);
    } catch (err) {
      this.runningGroups.delete(groupId);
      throw err;
    }
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
    await launchDedicatedService(group, service, this.tracker, this.getWorkspaceFolder());

    try {
      await waitForServiceReady(
        this.tracker,
        group.id,
        service.id,
        service.readyPattern,
        service.healthUrl,
        group.order === 'sequence' ? service.delayMs : undefined
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  }

  async stopGroup(groupId: string, removeFromRunning = true): Promise<void> {
    const config = this.getConfig();
    const group = findGroup(config, groupId);
    if (!group) {
      throw new Error(`Unknown group: ${groupId}`);
    }

    const serviceIds = group.services.map((s) => s.id);
    await this.tracker.stopGroup(groupId, serviceIds);

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
