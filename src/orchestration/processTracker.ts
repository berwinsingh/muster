import * as vscode from 'vscode';
import { GroupStatus, ServiceStatus } from '../config/schema';

export type TrackedService = {
  groupId: string;
  serviceId: string;
  terminal?: vscode.Terminal;
  pseudoterminal?: vscode.Disposable;
  childProcess?: import('child_process').ChildProcess;
  status: ServiceStatus;
  outputBuffer: string[];
  partialLine: string;
  startedAt?: number;
};

const MAX_OUTPUT_LINES = 500;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

export class ProcessTracker implements vscode.Disposable {
  private readonly services = new Map<string, TrackedService>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly onDidAppendOutputEmitter = new vscode.EventEmitter<{
    groupId: string;
    serviceId: string;
    line: string;
  }>();
  readonly onDidAppendOutput = this.onDidAppendOutputEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        void this.consumeShellExecution(event);
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const tracked = this.findByTerminal(event.terminal);
        if (!tracked) {
          return;
        }
        this.flushPartialLine(tracked);
        tracked.status = event.exitCode === undefined || event.exitCode === 0 ? 'stopped' : 'failed';
        this.onDidChangeEmitter.fire();
      })
    );
  }

  private async consumeShellExecution(
    event: vscode.TerminalShellExecutionStartEvent
  ): Promise<void> {
    const tracked = this.findByTerminal(event.terminal);
    if (!tracked) {
      return;
    }

    try {
      for await (const data of event.execution.read()) {
        this.appendOutput(tracked.groupId, tracked.serviceId, data);
      }
    } catch (err) {
      console.warn('[DevStack] Unable to read terminal shell execution output:', err);
    }
  }

  private key(groupId: string, serviceId: string): string {
    return `${groupId}:${serviceId}`;
  }

  getService(groupId: string, serviceId: string): TrackedService | undefined {
    return this.services.get(this.key(groupId, serviceId));
  }

  findByTerminal(terminal: vscode.Terminal): TrackedService | undefined {
    for (const tracked of this.services.values()) {
      if (tracked.terminal === terminal) {
        return tracked;
      }
    }
    return undefined;
  }

  setStatus(groupId: string, serviceId: string, status: ServiceStatus): void {
    const existing = this.services.get(this.key(groupId, serviceId));
    if (existing) {
      existing.status = status;
    } else {
      this.services.set(this.key(groupId, serviceId), {
        groupId,
        serviceId,
        status,
        outputBuffer: [],
        partialLine: '',
      });
    }
    this.onDidChangeEmitter.fire();
  }

  trackTerminal(
    groupId: string,
    serviceId: string,
    terminal: vscode.Terminal,
    status: ServiceStatus = 'starting'
  ): TrackedService {
    const tracked: TrackedService = {
      groupId,
      serviceId,
      terminal,
      status,
      outputBuffer: [],
      partialLine: '',
      startedAt: Date.now(),
    };
    this.services.set(this.key(groupId, serviceId), tracked);
    this.onDidChangeEmitter.fire();
    return tracked;
  }

  trackPseudoterminal(
    groupId: string,
    serviceId: string,
    disposable: vscode.Disposable,
    childProcess: import('child_process').ChildProcess,
    status: ServiceStatus = 'starting'
  ): TrackedService {
    const tracked: TrackedService = {
      groupId,
      serviceId,
      pseudoterminal: disposable,
      childProcess,
      status,
      outputBuffer: [],
      partialLine: '',
      startedAt: Date.now(),
    };
    this.services.set(this.key(groupId, serviceId), tracked);
    this.onDidChangeEmitter.fire();
    return tracked;
  }

  getAllTracked(): TrackedService[] {
    return Array.from(this.services.values());
  }

  private emitLine(tracked: TrackedService, line: string): void {
    if (!line) {
      return;
    }
    tracked.outputBuffer.push(line);
    this.onDidAppendOutputEmitter.fire({
      groupId: tracked.groupId,
      serviceId: tracked.serviceId,
      line,
    });
  }

  private flushPartialLine(tracked: TrackedService): void {
    const line = tracked.partialLine.trimEnd();
    tracked.partialLine = '';
    this.emitLine(tracked, line);
    this.trimOutputBuffer(tracked);
  }

  private trimOutputBuffer(tracked: TrackedService): void {
    if (tracked.outputBuffer.length > MAX_OUTPUT_LINES) {
      tracked.outputBuffer.splice(0, tracked.outputBuffer.length - MAX_OUTPUT_LINES);
    }
  }

  appendOutput(groupId: string, serviceId: string, data: string): void {
    const tracked = this.services.get(this.key(groupId, serviceId));
    if (!tracked) {
      return;
    }

    const cleaned = stripAnsi(data);
    tracked.partialLine += cleaned;
    const parts = tracked.partialLine.split('\n');
    tracked.partialLine = parts.pop() ?? '';

    for (const rawLine of parts) {
      this.emitLine(tracked, rawLine.trimEnd());
    }

    this.trimOutputBuffer(tracked);
  }

  getGroupStatus(groupId: string, serviceIds: string[]): GroupStatus {
    const services: Record<string, ServiceStatus> = {};
    let running = 0;
    let starting = 0;
    let failed = 0;

    for (const id of serviceIds) {
      const tracked = this.services.get(this.key(groupId, id));
      const status = tracked?.status ?? 'idle';
      services[id] = status;
      if (status === 'running') {
        running++;
      } else if (status === 'starting') {
        starting++;
      } else if (status === 'failed') {
        failed++;
      }
    }

    let state: GroupStatus['state'] = 'idle';
    if (failed > 0) {
      state = 'failed';
    } else if (running === serviceIds.length && serviceIds.length > 0) {
      state = 'running';
    } else if (starting > 0) {
      state = 'starting';
    } else if (running > 0) {
      state = 'partial';
    } else if (Object.values(services).some((status) => status === 'stopped')) {
      state = 'stopped';
    }

    return { groupId, state, services };
  }

  getRecentOutput(groupId: string, serviceId: string, lines = 50): string[] {
    const tracked = this.services.get(this.key(groupId, serviceId));
    if (!tracked) {
      return [];
    }
    return tracked.outputBuffer.slice(-lines);
  }

  async stopGroup(groupId: string, serviceIds: string[]): Promise<void> {
    for (const serviceId of serviceIds) {
      await this.stopService(groupId, serviceId);
    }
  }

  async stopService(groupId: string, serviceId: string): Promise<void> {
    const tracked = this.services.get(this.key(groupId, serviceId));
    if (!tracked) {
      return;
    }

    this.flushPartialLine(tracked);
    if (tracked.childProcess && !tracked.childProcess.killed) {
      tracked.childProcess.kill('SIGTERM');
    }
    tracked.pseudoterminal?.dispose();
    tracked.terminal?.dispose();

    tracked.status = 'stopped';
    this.onDidChangeEmitter.fire();
  }

  clearGroup(groupId: string, serviceIds: string[]): void {
    for (const serviceId of serviceIds) {
      this.services.delete(this.key(groupId, serviceId));
    }
    this.onDidChangeEmitter.fire();
  }

  isGroupRunning(groupId: string, serviceIds: string[]): boolean {
    return serviceIds.some((id) => {
      const service = this.services.get(this.key(groupId, id));
      return service?.status === 'running' || service?.status === 'starting';
    });
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeEmitter.dispose();
    this.onDidAppendOutputEmitter.dispose();
  }
}
