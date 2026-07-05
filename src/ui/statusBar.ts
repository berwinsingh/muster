import * as vscode from 'vscode';
import { GroupRunner } from '../orchestration/groupRunner';

export class DevStackStatusBar {
  private readonly item: vscode.StatusBarItem;
  private lastGroupId: string | undefined;

  constructor(private readonly runner: GroupRunner) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'devstack.toggleGroup';
    this.item.tooltip = 'DevStack: click to run/stop default group';
    this.update();
  }

  setLastGroup(groupId: string): void {
    this.lastGroupId = groupId;
    this.update();
  }

  update(): void {
    const config = vscode.workspace.getConfiguration('devstack');
    const defaultGroup = config.get<string>('defaultGroup') || this.lastGroupId;

    if (!defaultGroup) {
      this.item.text = '$(server-process) DevStack';
      this.item.show();
      return;
    }

    const status = this.runner.getGroupStatus(defaultGroup);
    const running = this.runner.isGroupRunning(defaultGroup);
    const icon = running ? '$(debug-stop)' : '$(play)';
    const state = status?.state ?? 'idle';
    this.item.text = `${icon} DevStack: ${defaultGroup} (${state})`;
    this.item.show();
  }

  getActiveGroupId(): string | undefined {
    const config = vscode.workspace.getConfiguration('devstack');
    return config.get<string>('defaultGroup') || this.lastGroupId;
  }

  dispose(): void {
    this.item.dispose();
  }
}

export function registerStatusBar(
  context: vscode.ExtensionContext,
  runner: GroupRunner
): DevStackStatusBar {
  const statusBar = new DevStackStatusBar(runner);
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand('devstack.toggleGroup', async () => {
      const groupId = statusBar.getActiveGroupId();
      if (!groupId) {
        await vscode.commands.executeCommand('devstack.runGroup');
        return;
      }
      if (runner.isGroupRunning(groupId)) {
        await runner.stopGroup(groupId);
      } else {
        await runner.runGroup(groupId);
      }
      statusBar.update();
    })
  );

  return statusBar;
}
