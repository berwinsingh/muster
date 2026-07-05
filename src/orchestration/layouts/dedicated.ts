import * as vscode from 'vscode';
import { buildServiceEnv } from '../../config/env';
import { GroupConfig, ServiceConfig } from '../../config/schema';
import { buildServiceCommand } from '../shell';
import { ProcessTracker } from '../processTracker';

export async function launchDedicatedService(
  group: GroupConfig,
  service: ServiceConfig,
  tracker: ProcessTracker,
  workspaceFolder: vscode.WorkspaceFolder | undefined
): Promise<void> {
  tracker.setStatus(group.id, service.id, 'starting');

  const env = buildServiceEnv(service);
  const terminalOptions: vscode.TerminalOptions = {
    name: `DevStack: ${service.name}`,
    cwd: service.cwd ?? workspaceFolder?.uri.fsPath,
    env,
  };

  if (service.presentation?.group) {
    terminalOptions.location = { viewColumn: vscode.ViewColumn.Active, preserveFocus: !service.presentation.focus };
  }

  const terminal = vscode.window.createTerminal(terminalOptions);
  tracker.trackTerminal(group.id, service.id, terminal, 'starting');

  if (service.presentation?.reveal !== false) {
    terminal.show(service.presentation?.focus ?? false);
  }

  const command = buildServiceCommand(service);
  const executed = await tryShellIntegrationExecute(terminal, command, group.id, service.id, tracker);
  if (!executed) {
    terminal.sendText(command, true);
  }

  tracker.appendOutput(group.id, service.id, `$ ${command}\n`);
  tracker.setStatus(group.id, service.id, 'running');
}

async function tryShellIntegrationExecute(
  terminal: vscode.Terminal,
  command: string,
  groupId: string,
  serviceId: string,
  tracker: ProcessTracker
): Promise<boolean> {
  const shellIntegration = (terminal as vscode.Terminal & {
    shellIntegration?: { executeCommand?: (cmd: string) => { read?: () => AsyncIterable<string> } };
  }).shellIntegration;

  if (!shellIntegration?.executeCommand) {
    return false;
  }

  try {
    const execution = shellIntegration.executeCommand(command);
    if (execution?.read) {
      for await (const chunk of execution.read()) {
        tracker.appendOutput(groupId, serviceId, chunk);
      }
    }
    return true;
  } catch {
    return false;
  }
}
