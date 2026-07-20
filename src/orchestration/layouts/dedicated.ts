import * as vscode from 'vscode';
import { buildServiceEnv } from '../../config/env';
import { GroupConfig, ServiceConfig } from '../../config/schema';
import { buildServiceCommand } from '../shell';
import { ProcessTracker } from '../processTracker';

type ShellIntegration = {
  executeCommand(command: string): unknown;
};

type TerminalWithShellIntegration = vscode.Terminal & {
  shellIntegration?: ShellIntegration;
};

type ShellIntegrationChangeEvent = {
  terminal: vscode.Terminal;
  shellIntegration: ShellIntegration;
};

type WindowWithShellIntegration = typeof vscode.window & {
  onDidChangeTerminalShellIntegration?: (
    listener: (event: ShellIntegrationChangeEvent) => void
  ) => vscode.Disposable;
};

async function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs = 2000
): Promise<ShellIntegration | undefined> {
  const current = (terminal as TerminalWithShellIntegration).shellIntegration;
  if (current) {
    return current;
  }

  const windowApi = vscode.window as WindowWithShellIntegration;
  if (typeof windowApi.onDidChangeTerminalShellIntegration !== 'function') {
    return undefined;
  }

  return new Promise((resolve) => {
    let disposable: vscode.Disposable | undefined;
    const finish = (integration?: ShellIntegration): void => {
      clearTimeout(timer);
      disposable?.dispose();
      resolve(integration);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    disposable = windowApi.onDidChangeTerminalShellIntegration?.((event) => {
      if (event.terminal === terminal) {
        finish(event.shellIntegration);
      }
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeTerminalCommand(
  terminal: vscode.Terminal,
  command: string
): Promise<void> {
  const shellIntegration = await waitForShellIntegration(terminal);
  if (shellIntegration) {
    shellIntegration.executeCommand(command);
    return;
  }
  // Without shell integration, sendText goes straight through xterm's
  // scrollToBottom, which reads the renderer's computed dimensions — on a
  // terminal whose view hasn't finished its first layout pass yet (freshly
  // created, or created while another terminal is being torn down during a
  // fast restart), those dimensions are still unset and VS Code throws.
  // One tick is enough for the layout pass to complete; it's not a fixed
  // wait for anything slower, so it doesn't add meaningful launch latency.
  await wait(120);
  terminal.sendText(command, true);
}

export async function launchDedicatedService(
  group: GroupConfig,
  service: ServiceConfig,
  tracker: ProcessTracker,
  workspaceFolder: vscode.WorkspaceFolder | undefined
): Promise<void> {
  tracker.setStatus(group.id, service.id, 'starting');

  const terminalOptions: vscode.TerminalOptions = {
    name: `Muster: ${service.name}`,
    cwd: service.cwd ?? workspaceFolder?.uri.fsPath,
    env: buildServiceEnv(service),
  };

  if (service.presentation?.group) {
    terminalOptions.location = {
      viewColumn: vscode.ViewColumn.Active,
      preserveFocus: !service.presentation.focus,
    };
  }

  const terminal = vscode.window.createTerminal(terminalOptions);
  tracker.trackTerminal(group.id, service.id, terminal, 'starting');

  if (service.presentation?.reveal !== false) {
    terminal.show(service.presentation?.focus ?? false);
  }

  await executeTerminalCommand(terminal, buildServiceCommand(service));
  tracker.setStatus(group.id, service.id, 'running');
}
