import * as cp from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import { buildServiceEnv } from '../../config/env';
import { GroupConfig, ServiceConfig } from '../../config/schema';
import { buildServiceCommand } from '../shell';
import { ProcessTracker } from '../processTracker';

class AggregatedPty implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<number | void>();
  onDidClose = this.closeEmitter.event;

  private readonly processes = new Map<string, cp.ChildProcess>();
  private openCallback?: () => void;

  constructor(
    private readonly group: GroupConfig,
    private readonly tracker: ProcessTracker,
    private readonly workspaceFolder: vscode.WorkspaceFolder | undefined
  ) {}

  open(): void {
    this.writeEmitter.fire(`\r\n\x1b[36m[devstack]\x1b[0m Starting aggregated group: ${this.group.label}\r\n`);
    for (const service of this.group.services) {
      this.spawnService(service);
    }
    this.openCallback?.();
  }

  close(): void {
    for (const [serviceId, proc] of this.processes) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
      this.tracker.setStatus(this.group.id, serviceId, 'stopped');
    }
    this.processes.clear();
    this.closeEmitter.fire(0);
  }

  handleInput(): void {
    // read-only aggregated view
  }

  setOpenCallback(cb: () => void): void {
    this.openCallback = cb;
  }

  private spawnService(service: ServiceConfig): void {
    this.tracker.setStatus(this.group.id, service.id, 'starting');

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const command = buildServiceCommand(service);
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-lc', command];

    const proc = cp.spawn(shell, shellArgs, {
      cwd: service.cwd ?? this.workspaceFolder?.uri.fsPath ?? os.homedir(),
      env: buildServiceEnv(service),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(service.id, proc);
    this.tracker.trackPseudoterminal(
      this.group.id,
      service.id,
      { dispose: () => { if (!proc.killed) proc.kill('SIGTERM'); } },
      proc,
      'starting'
    );

    const prefix = (line: string) =>
      `\r\n\x1b[33m[${service.id}]\x1b[0m ${line.replace(/\r?\n/g, '')}\r\n`;

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.tracker.appendOutput(this.group.id, service.id, text);
      for (const line of text.split(/\r?\n/)) {
        if (line) {
          this.writeEmitter.fire(prefix(line));
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.tracker.appendOutput(this.group.id, service.id, text);
      for (const line of text.split(/\r?\n/)) {
        if (line) {
          this.writeEmitter.fire(prefix(line));
        }
      }
    });

    proc.on('exit', (code) => {
      this.tracker.setStatus(this.group.id, service.id, code === 0 ? 'stopped' : 'failed');
      this.writeEmitter.fire(
        `\r\n\x1b[31m[${service.id}]\x1b[0m exited with code ${code ?? 'unknown'}\r\n`
      );
    });

    proc.on('spawn', () => {
      this.tracker.setStatus(this.group.id, service.id, 'running');
    });
  }
}

export function launchAggregatedGroup(
  group: GroupConfig,
  tracker: ProcessTracker,
  workspaceFolder: vscode.WorkspaceFolder | undefined
): vscode.Disposable {
  const pty = new AggregatedPty(group, tracker, workspaceFolder);
  const terminal = vscode.window.createTerminal({
    name: `DevStack: ${group.label}`,
    pty,
  });

  const disposable = vscode.Disposable.from(
    terminal,
    {
      dispose: () => pty.close(),
    }
  );

  pty.setOpenCallback(() => {
    terminal.show(true);
  });

  return disposable;
}
