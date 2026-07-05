import * as vscode from 'vscode';
import { GroupConfig, ServiceConfig } from '../../config/schema';
import { buildServiceCommand } from '../shell';
import { ProcessTracker } from '../processTracker';
import { launchDedicatedService } from './dedicated';

/**
 * Split layout: creates terminals sequentially, attempting to place them
 * in adjacent columns. Falls back to dedicated tabs when split is unavailable.
 */
export async function launchSplitGroup(
  group: GroupConfig,
  tracker: ProcessTracker,
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  runService: (service: ServiceConfig) => Promise<void>
): Promise<void> {
  const columns: vscode.ViewColumn[] = [
    vscode.ViewColumn.One,
    vscode.ViewColumn.Two,
    vscode.ViewColumn.Three,
    vscode.ViewColumn.Four,
    vscode.ViewColumn.Five,
  ];

  for (let i = 0; i < group.services.length; i++) {
    const service = group.services[i];
    const column = columns[i % columns.length];

    tracker.setStatus(group.id, service.id, 'starting');

    const terminal = vscode.window.createTerminal({
      name: `DevStack: ${service.name}`,
      cwd: service.cwd ?? workspaceFolder?.uri.fsPath,
      location: { viewColumn: column, preserveFocus: false },
    });

    tracker.trackTerminal(group.id, service.id, terminal, 'starting');
    terminal.show(i === 0);

    try {
      const command = buildServiceCommand(service);
      terminal.sendText(command, true);
      tracker.setStatus(group.id, service.id, 'running');
    } catch {
      await runService(service);
    }
  }
}

export async function launchSplitOrDedicated(
  group: GroupConfig,
  tracker: ProcessTracker,
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  runService: (service: ServiceConfig) => Promise<void>
): Promise<void> {
  try {
    await launchSplitGroup(group, tracker, workspaceFolder, runService);
  } catch {
    for (const service of group.services) {
      await launchDedicatedService(group, service, tracker, workspaceFolder);
    }
  }
}
