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
  startedAt?: number;
};

const MAX_OUTPUT_LINES = 500;

export class ProcessTracker {
  private readonly services = new Map<string, TrackedService>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly onDidAppendOutputEmitter = new vscode.EventEmitter<{
    groupId: string;
    serviceId: string;
    line: string;
  }>();
  readonly onDidAppendOutput = this.onDidAppendOutputEmitter.event;

  private key(groupId: string, serviceId: string): string {
    return `${groupId}:${serviceId}`;
  }

  getService(groupId: string, serviceId: string): TrackedService | undefined {
    return this.services.get(this.key(groupId, serviceId));
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
      startedAt: Date.now(),
    };
    this.services.set(this.key(groupId, serviceId), tracked);
    this.onDidChangeEmitter.fire();
    return tracked;
  }

  getAllTracked(): TrackedService[] {
    return Array.from(this.services.values());
  }

  appendOutput(groupId: string, serviceId: string, data: string): void {
    const tracked = this.services.get(this.key(groupId, serviceId));
    if (!tracked) {
      return;
    }
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (line.length > 0) {
        tracked.outputBuffer.push(line);
        this.onDidAppendOutputEmitter.fire({ groupId, serviceId, line });
      }
    }
    if (tracked.outputBuffer.length > MAX_OUTPUT_LINES) {
      tracked.outputBuffer.splice(0, tracked.outputBuffer.length - MAX_OUTPUT_LINES);
    }
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
    } else if (Object.values(services).some((s) => s === 'stopped')) {
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

    if (tracked.childProcess && !tracked.childProcess.killed) {
      tracked.childProcess.kill('SIGTERM');
    }
    if (tracked.pseudoterminal) {
      tracked.pseudoterminal.dispose();
    }
    if (tracked.terminal) {
      tracked.terminal.dispose();
    }

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
      const s = this.services.get(this.key(groupId, id));
      return s?.status === 'running' || s?.status === 'starting';
    });
  }
}
