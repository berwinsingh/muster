import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { getMusterWorkspaceFolder, hasWorkspaceConfigFile } from '../config/workspaceFolder';
import { GroupConfig, ServiceStatus } from '../config/schema';
import { EventTracker } from '../monitoring/eventTracker';
import { GroupRunner } from '../orchestration/groupRunner';
import { ProcessTracker } from '../orchestration/processTracker';

/** Must match package.json contributes.views id exactly. */
export const TREE_VIEW_ID = 'muster.groups';

type TreeItemContext = 'group' | 'service' | 'welcome' | 'error';

export class MusterTreeItem extends vscode.TreeItem {
  constructor(
    public readonly nodeId: string,
    public readonly nodeType: TreeItemContext,
    public readonly groupId: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly serviceStatus?: ServiceStatus,
    description?: string
  ) {
    super(label, collapsibleState);
    this.contextValue = nodeType;
    if (description) {
      this.description = description;
    }

    if (nodeType === 'group') {
      this.iconPath = new vscode.ThemeIcon('server-process');
      this.tooltip = `Group: ${label}`;
    } else if (nodeType === 'welcome') {
      this.iconPath = new vscode.ThemeIcon('info');
      this.tooltip = label;
    } else if (nodeType === 'error') {
      this.iconPath = new vscode.ThemeIcon('warning');
      this.tooltip = label;
    } else {
      this.iconPath = statusIcon(serviceStatus ?? 'idle');
      this.tooltip = `Service: ${label} (${serviceStatus ?? 'idle'})`;
    }
  }
}

function statusIcon(status: ServiceStatus): vscode.ThemeIcon {
  switch (status) {
    case 'running':
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    case 'starting':
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    case 'failed':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'stopped':
      return new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('descriptionForeground'));
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

export class MusterTreeProvider implements vscode.TreeDataProvider<MusterTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly runner: GroupRunner,
    private readonly tracker: ProcessTracker,
    private readonly eventTracker?: EventTracker
  ) {
    tracker.onDidChange(() => this.refresh());
    eventTracker?.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: MusterTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MusterTreeItem): MusterTreeItem[] {
    const folder = getMusterWorkspaceFolder();
    let config;
    try {
      config = loadMergedConfig(folder);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Invalid Muster config — open Visual Editor to fix';
      const item = new MusterTreeItem(
        'error',
        'error',
        '',
        'Invalid Muster config — click to fix',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        message
      );
      item.command = {
        command: 'muster.openVisualEditor',
        title: 'Open Visual Editor',
      };
      return [item];
    }

    if (!element) {
      if (config.groups.length === 0) {
        if (hasWorkspaceConfigFile(folder)) {
          const item = new MusterTreeItem(
            'error',
            'error',
            '',
            'Muster config has no groups — click to configure',
            vscode.TreeItemCollapsibleState.None,
            undefined,
            'Open the visual editor to add server groups.'
          );
          item.command = {
            command: 'muster.openVisualEditor',
            title: 'Open Visual Editor',
          };
          return [item];
        }
        return [];
      }
      return config.groups.map((group) => {
        const status = this.runner.getGroupStatus(group.id);
        const suffix = status ? ` (${status.state})` : '';
        return new MusterTreeItem(
          group.id,
          'group',
          group.id,
          `${group.label}${suffix}`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
      });
    }

    if (element.nodeType === 'group') {
      const group = config.groups.find((g) => g.id === element.groupId);
      if (!group) {
        return [];
      }
      return group.services.map((svc) => {
        const status = this.tracker.getService(element.groupId, svc.id)?.status ?? 'idle';
        const errorCount =
          this.eventTracker?.getServiceEventCount(element.groupId, svc.id, 'error') ?? 0;
        const warningCount =
          this.eventTracker?.getServiceEventCount(element.groupId, svc.id, 'warning') ?? 0;

        let description: string = status;
        if (errorCount > 0) {
          description = `${status} · ${errorCount} error${errorCount > 1 ? 's' : ''}`;
        } else if (warningCount > 0) {
          description = `${status} · ${warningCount} warn`;
        }

        const item = new MusterTreeItem(
          `${element.groupId}:${svc.id}`,
          'service',
          element.groupId,
          svc.name,
          vscode.TreeItemCollapsibleState.None,
          status,
          description
        );

        if (errorCount > 0) {
          item.iconPath = new vscode.ThemeIcon(
            'error',
            new vscode.ThemeColor('testing.iconFailed')
          );
        }

        return item;
      });
    }

    return [];
  }
}

export function registerTreeView(
  context: vscode.ExtensionContext,
  runner: GroupRunner,
  tracker: ProcessTracker,
  eventTracker?: EventTracker
): MusterTreeProvider {
  const provider = new MusterTreeProvider(runner, tracker, eventTracker);
  const treeView = vscode.window.createTreeView(TREE_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  return provider;
}

export function getGroupFromTreeItem(item: MusterTreeItem): GroupConfig | undefined {
  const folder = getMusterWorkspaceFolder();
  const config = loadMergedConfig(folder);
  return config.groups.find((g) => g.id === item.groupId);
}

export function musterHasGroups(): boolean {
  try {
    const folder = getMusterWorkspaceFolder();
    if (!folder) {
      return false;
    }
    return loadMergedConfig(folder).groups.length > 0;
  } catch {
    return false;
  }
}
