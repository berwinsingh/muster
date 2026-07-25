import * as vscode from 'vscode';
import { GroupStatus, ServiceStatus } from '../config/schema';
import { LogStore } from '../logs/store';

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
  /**
   * Set when the user (or agent) stopped the service on purpose, so the
   * terminal's exit event reports 'stopped' rather than 'failed' — a
   * Ctrl-C'd process exits non-zero (130) but that is not a crash.
   */
  expectStop?: boolean;
};

export type StopOptions = {
  /**
   * Dispose the terminal and forget the service entirely — clears its
   * history and reclaims the terminal. Default (false) interrupts the
   * process but keeps the terminal and its scrollback, so a failed run
   * stays on screen to read.
   */
  force?: boolean;
  /**
   * Dispose the terminal but keep the tracked entry (and its output
   * buffer), so a freshly created terminal inherits the scrollback with a
   * divider. Used by restart, which replaces the terminal rather than
   * leaving the old one behind next to the new one.
   */
  replaceTerminal?: boolean;
};

const MAX_OUTPUT_LINES = 500;

/** The scrollback divider a restart drops in, shared with headless mode. */
export const RESTART_DIVIDER = '— restarted —';

/** ETX — what pressing Ctrl-C sends, to interrupt a terminal's foreground command. */
const CTRL_C = String.fromCharCode(3);

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

export class ProcessTracker implements vscode.Disposable {
  private readonly services = new Map<string, TrackedService>();
  /**
   * Group-level resources that outlive any single service — the aggregated
   * layout's one shared terminal. Kept here so restart and delete can
   * dispose it; without this the aggregated terminal's disposable was
   * dropped on the floor and every restart leaked a duplicate terminal.
   */
  private readonly groupTerminals = new Map<string, vscode.Disposable>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly onDidAppendOutputEmitter = new vscode.EventEmitter<{
    groupId: string;
    serviceId: string;
    line: string;
  }>();
  readonly onDidAppendOutput = this.onDidAppendOutputEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];

  /**
   * Persists captured lines so history survives a stop, a restart, and the
   * extension host itself exiting. Set by the extension once the workspace
   * root is known; absent in tests, where logs stay in memory only.
   */
  private logStore: LogStore | undefined;

  setLogStore(store: LogStore | undefined): void {
    this.logStore = store;
  }

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
        // A deliberate stop (Ctrl-C) exits non-zero but is not a crash.
        tracked.status =
          tracked.expectStop || event.exitCode === undefined || event.exitCode === 0
            ? 'stopped'
            : 'failed';
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
      console.warn('[Muster] Unable to read terminal shell execution output:', err);
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
      outputBuffer: this.carryOverBuffer(groupId, serviceId),
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
      outputBuffer: this.carryOverBuffer(groupId, serviceId),
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
    this.logStore?.append(tracked.groupId, tracked.serviceId, [line]);
    this.onDidAppendOutputEmitter.fire({
      groupId: tracked.groupId,
      serviceId: tracked.serviceId,
      line,
    });
  }

  /**
   * Carry a prior run's scrollback into a fresh terminal/pty for the same
   * service, with a divider — so a restart reads as one continuous history
   * instead of wiping the output the user was mid-debug on. Mirrors the
   * headless supervisor. A force-stop deletes the entry, so this only
   * preserves history when the user actually restarted.
   */
  private carryOverBuffer(groupId: string, serviceId: string): string[] {
    const prev = this.services.get(this.key(groupId, serviceId));
    if (!prev || prev.outputBuffer.length === 0) {
      return [];
    }
    const carried = [...prev.outputBuffer, RESTART_DIVIDER];
    this.logStore?.append(groupId, serviceId, [RESTART_DIVIDER]);
    return carried;
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

  /**
   * Logs for display: the live in-memory buffer when the service is tracked
   * this session, otherwise persisted history from disk — so `muster logs`
   * still works on a group that was stopped, or that only ran in a previous
   * session. `since` filters persisted history by timestamp.
   */
  readLogs(
    groupId: string,
    serviceId: string,
    opts: { lines?: number; since?: number } = {}
  ): string[] {
    const lines = opts.lines ?? 50;
    const tracked = this.services.get(this.key(groupId, serviceId));
    // A tracked service with output in memory is the freshest source. Fall
    // through to disk only when nothing is buffered (never ran this session,
    // or the buffer was cleared), so we never show a stale disk copy over
    // live output.
    if (tracked && tracked.outputBuffer.length > 0) {
      return tracked.outputBuffer.slice(-lines);
    }
    if (this.logStore) {
      return this.logStore
        .read(groupId, serviceId, { lines, since: opts.since })
        .map((entry) => entry.line);
    }
    return tracked ? tracked.outputBuffer.slice(-lines) : [];
  }

  async stopGroup(
    groupId: string,
    serviceIds: string[],
    opts: StopOptions = {}
  ): Promise<void> {
    for (const serviceId of serviceIds) {
      await this.stopService(groupId, serviceId, opts);
    }
  }

  /**
   * Stop a service. By default this interrupts the running process but
   * leaves the terminal — and everything scrolled into it — in place, so a
   * crash you were reading survives the stop. Pass `{ force: true }` to
   * dispose the terminal and forget the service (the way to clear history
   * and reclaim the terminal).
   */
  async stopService(
    groupId: string,
    serviceId: string,
    opts: StopOptions = {}
  ): Promise<void> {
    const tracked = this.services.get(this.key(groupId, serviceId));
    if (!tracked) {
      return;
    }
    const force = opts.force === true;
    // Both force and restart tear the terminal down; only force also forgets
    // the service (and thus its scrollback).
    const disposeTerminal = force || opts.replaceTerminal === true;

    this.flushPartialLine(tracked);
    tracked.expectStop = true;

    if (tracked.childProcess && !tracked.childProcess.killed) {
      // Aggregated layout: a real child process. SIGTERM the group; a
      // force/restart also disposes the shared terminal below.
      const child = tracked.childProcess;
      child.kill('SIGTERM');
      // Escalate to SIGKILL for a process that ignores SIGTERM, so a stop
      // never hangs forever waiting on a stubborn service.
      const killTimer = setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // already gone
          }
        }
      }, 5000);
      killTimer.unref?.();
      child.once('exit', () => clearTimeout(killTimer));
    } else if (tracked.terminal && !disposeTerminal) {
      // Dedicated/split layout: the process runs *inside* the terminal.
      // Ctrl-C (ETX) interrupts the foreground command while leaving the
      // terminal and its scrollback intact — exactly what the user would
      // press themselves.
      try {
        tracked.terminal.sendText(CTRL_C, false);
      } catch {
        // terminal already closed by the user
      }
    }

    if (disposeTerminal) {
      tracked.pseudoterminal?.dispose();
      tracked.terminal?.dispose();
      // Drop the handles so nothing later writes to a dead terminal; the
      // outputBuffer stays put so a restart can carry it into the new one.
      tracked.pseudoterminal = undefined;
      tracked.terminal = undefined;
    }
    if (force) {
      this.services.delete(this.key(groupId, serviceId));
    }

    tracked.status = 'stopped';
    this.onDidChangeEmitter.fire();
  }

  /**
   * Hand the tracker ownership of a group-wide terminal (the aggregated
   * layout's shared one). Any previously registered terminal for the group
   * is left in place — a plain stop keeps it on screen — so callers that
   * mean to replace it must dispose first via disposeGroupTerminal.
   */
  registerGroupTerminal(groupId: string, disposable: vscode.Disposable): void {
    this.groupTerminals.set(groupId, disposable);
  }

  disposeGroupTerminal(groupId: string): void {
    const disposable = this.groupTerminals.get(groupId);
    if (disposable) {
      try {
        disposable.dispose();
      } catch {
        // already disposed
      }
      this.groupTerminals.delete(groupId);
    }
  }

  clearGroup(groupId: string, serviceIds: string[]): void {
    for (const serviceId of serviceIds) {
      this.services.delete(this.key(groupId, serviceId));
    }
    this.disposeGroupTerminal(groupId);
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
    for (const groupId of [...this.groupTerminals.keys()]) {
      this.disposeGroupTerminal(groupId);
    }
    this.logStore?.dispose();
    this.onDidChangeEmitter.dispose();
    this.onDidAppendOutputEmitter.dispose();
  }
}
