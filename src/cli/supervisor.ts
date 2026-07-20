/**
 * Headless supervisor for `muster up`: runs a group's services as child
 * processes with the same semantics as the extension — dependency order,
 * delays, readyPattern/healthUrl gates, preRun/postStop hooks — but fully
 * standalone. State (per-service status + line-buffered logs + a "muster"
 * narrator feed) is exposed for the local TUI dashboard; an optional echo
 * callback streams the same lines for plain-log mode.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GroupConfig, ServiceConfig, effectiveCommand } from '../config/schema';
import { buildServiceEnv } from '../config/env';
import { buildPrependCommands, suggestPrependForService } from '../config/runtimeDetect';
import { runHooks } from '../orchestration/hooks';
import {
  LineBuffer,
  ServiceState,
  appendChunk,
  bufferedText,
  deriveGroupState,
  newLineBuffer,
  tailLines,
} from './liveState';
import { A } from './render';

const PALETTE = [A.green, A.blue, A.yellow, A.amber];

type Running = {
  service: ServiceConfig;
  proc: cp.ChildProcess;
  buf: LineBuffer;
  status: ServiceState;
  expectStop: boolean;
  // Signal-killed processes keep exitCode === null (signalCode is set
  // instead), so liveness must come from the exit event, not exitCode.
  exited: boolean;
};

function shellFor(): { shell: string; flag: string } {
  return process.platform === 'win32'
    ? { shell: 'cmd.exe', flag: '/c' }
    : { shell: '/bin/bash', flag: '-lc' };
}

/**
 * nvm is a shell function, not a binary — and non-interactive `bash -lc`
 * skips the .bashrc lines that source it. Find nvm.sh so prepends can
 * source it explicitly; null when nvm simply isn't installed.
 */
function findNvmSh(): string | null {
  const candidates = [
    process.env.NVM_DIR ? path.join(process.env.NVM_DIR, 'nvm.sh') : null,
    path.join(os.homedir(), '.nvm', 'nvm.sh'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export class Supervisor {
  private readonly running = new Map<string, Running>();
  private readonly narratorBuf = newLineBuffer();
  private stopping = false;
  private upInFlight = false;

  constructor(
    readonly group: GroupConfig,
    readonly root: string,
    private readonly echo?: (line: string) => void,
    /** Auto-detect venvs / node pins in each service's cwd (off via --no-detect). */
    private readonly detect = true
  ) {}

  private prefix(serviceId: string): string {
    const ids = this.group.services.map((s) => s.id);
    const color = PALETTE[Math.max(0, ids.indexOf(serviceId)) % PALETTE.length];
    return `${color}[${serviceId}]${A.reset}`;
  }

  private muster(line: string): void {
    appendChunk(this.narratorBuf, line + '\n', 500);
    this.echo?.(`${A.amber}[muster]${A.reset} ${line}`);
  }

  /** Post a line on the narrator feed from outside (pre-dashboard notices). */
  note(line: string): void {
    this.muster(line);
  }

  private spawnService(service: ServiceConfig): Running {
    let prepend: string[];
    if (this.detect) {
      // Configured python/node settings win; detection fills the gaps from
      // what actually exists in the service's cwd (venv dirs, .nvmrc).
      const suggestion = suggestPrependForService(service, service.cwd ?? this.root);
      const explicit = new Set(buildPrependCommands(service));
      prepend = suggestion.prepend;
      for (const cmd of prepend) {
        if (!explicit.has(cmd)) {
          this.muster(`${A.dim}env: ${service.id} · auto-detected → ${cmd}${A.reset}`);
        }
      }
      if (suggestion.warning) {
        this.muster(`${A.yellow}⚠ ${service.id}: ${suggestion.warning}${A.reset}`);
      }
    } else {
      prepend = buildPrependCommands(service);
    }

    // `nvm` is a shell function that non-interactive shells don't have.
    // Source nvm.sh explicitly when it exists, and treat the version
    // switch as best-effort: a missing nvm install or an uninstalled
    // version falls back to the PATH node with a visible log line rather
    // than killing the service ("nvm: command not found", exit 127).
    if (process.platform !== 'win32') {
      prepend = prepend.flatMap((cmd) => {
        if (!/^nvm use\b/.test(cmd.trim())) return [cmd];
        const nvmSh = findNvmSh();
        if (!nvmSh) {
          this.muster(
            `${A.yellow}⚠ ${service.id}: nvm not installed — skipping "${cmd}", using the node on PATH${A.reset}`
          );
          return [];
        }
        return [
          `{ \\. "${nvmSh}" && ${cmd}; } >/dev/null 2>&1 || echo "[muster] ${cmd} failed - continuing with $(node --version 2>/dev/null || echo 'no') node from PATH"`,
        ];
      });
    }
    const main = effectiveCommand(service);
    const command = prepend.length ? [...prepend, main].join(' && ') : main;
    const { shell, flag } = shellFor();

    this.muster(`▶ ${A.bold}${service.id}${A.reset} ${A.dim}— ${main}${A.reset}`);
    const proc = cp.spawn(shell, [flag, command], {
      cwd: service.cwd ?? this.root,
      env: buildServiceEnv(service),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group per service (POSIX), so stopping kills the whole
      // tree — the shell AND everything it spawned — not just the shell.
      detached: process.platform !== 'win32',
    });

    // A restarted service keeps its previous log history, with a divider.
    const previous = this.running.get(service.id);
    const buf = previous?.buf ?? newLineBuffer();
    if (previous) appendChunk(buf, `${A.dim}— restarted —${A.reset}\n`);

    const entry: Running = {
      service,
      proc,
      buf,
      status: 'starting',
      expectStop: false,
      exited: false,
    };
    const onData = (chunk: Buffer): void => {
      for (const line of appendChunk(buf, chunk.toString('utf-8'))) {
        this.echo?.(`${this.prefix(service.id)} ${line}`);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (err) => {
      entry.exited = true;
      entry.status = 'failed';
      this.muster(`${A.red}✗ ${service.id} failed to spawn: ${err.message}${A.reset}`);
    });
    proc.on('exit', (code, signal) => {
      entry.exited = true;
      if (this.stopping || entry.expectStop) {
        entry.status = 'stopped';
        return;
      }
      entry.status = code === 0 ? 'stopped' : 'failed';
      this.muster(
        code === 0
          ? `${service.id} exited`
          : `${A.red}✗ ${service.id} ${signal ? `killed by ${signal}` : `exited with code ${code}`}${A.reset}`
      );
    });

    this.running.set(service.id, entry);
    return entry;
  }

  private async waitReady(entry: Running): Promise<void> {
    const { service } = entry;
    if (service.delayMs && this.group.order === 'sequence') {
      await new Promise((r) => setTimeout(r, service.delayMs));
    }
    if (service.readyPattern) {
      this.muster(`${A.dim}waiting for ready pattern on ${service.id}…${A.reset}`);
      const regex = new RegExp(service.readyPattern);
      const start = Date.now();
      while (Date.now() - start < 120_000) {
        if (regex.test(bufferedText(entry.buf))) {
          this.muster(`ready pattern matched on ${service.id}`);
          entry.status = 'running';
          break;
        }
        if (entry.status === 'failed') {
          throw new Error(`${service.id} exited before becoming ready`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (entry.status !== 'running') {
        throw new Error(`${service.id} did not match readyPattern within 120s`);
      }
    }
    const healthUrl =
      service.healthUrl && service.port !== undefined
        ? service.healthUrl.replace(/\$\{port\}/g, String(service.port))
        : service.healthUrl;
    if (healthUrl) {
      this.muster(`${A.dim}waiting for health check on ${service.id}…${A.reset}`);
      const start = Date.now();
      let ok = false;
      while (Date.now() - start < 60_000 && !ok) {
        try {
          const res = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
          ok = res.ok;
        } catch {
          // retry
        }
        if (!ok) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!ok) throw new Error(`${service.id} health check failed: ${healthUrl}`);
      this.muster(`health check passed on ${service.id}`);
    }
    if (entry.status === 'starting') entry.status = 'running';
  }

  async up(): Promise<void> {
    if (this.upInFlight) return;
    this.upInFlight = true;
    this.stopping = false;
    try {
      this.echo?.(`${A.green}❯${A.reset} ${A.bold}muster up ${this.group.id}${A.reset}`);
      this.muster(
        `starting ${this.group.services.length} service${this.group.services.length === 1 ? '' : 's'} · layout: headless · order: ${this.group.order}`
      );

      if (this.group.hooks?.preRun?.length) {
        await runHooks('preRun', this.group.hooks.preRun, this.root, (line) =>
          this.muster(`${A.dim}⚙ ${line}${A.reset}`)
        );
      }

      const completed = new Set<string>();
      const pending = this.group.services.filter((s) => !this.isAlive(s.id));
      for (const svc of this.group.services) {
        if (this.isAlive(svc.id)) completed.add(svc.id);
      }

      if (this.group.order === 'parallel') {
        await Promise.all(
          pending.map(async (service) => {
            if (service.delayMs) await new Promise((r) => setTimeout(r, service.delayMs));
            await this.waitReady(this.spawnService(service));
            completed.add(service.id);
          })
        );
      } else {
        while (pending.length > 0) {
          const runnable = pending.filter(
            (s) => !s.dependsOn?.length || s.dependsOn.every((d) => completed.has(d))
          );
          if (runnable.length === 0) {
            throw new Error(`Circular or unsatisfied dependencies in group ${this.group.id}`);
          }
          for (const service of runnable) {
            pending.splice(pending.indexOf(service), 1);
            await this.waitReady(this.spawnService(service));
            completed.add(service.id);
          }
        }
      }

      const up = [...this.running.values()].filter(
        (r) => r.status === 'running' || r.status === 'starting'
      ).length;
      this.muster(
        `${this.group.id} · ${A.green}${up}/${this.group.services.length} services running${A.reset} ${A.dim}(Ctrl+C to stop)${A.reset}`
      );
    } finally {
      this.upInFlight = false;
    }
  }

  private isAlive(serviceId: string): boolean {
    const entry = this.running.get(serviceId);
    return !!entry && !entry.exited;
  }

  /** True while any child is still alive. */
  get alive(): boolean {
    return [...this.running.values()].some((r) => !r.exited);
  }

  /** Per-service status + derived group state, for the dashboard. */
  snapshot(): { state: string; services: Record<string, string> } {
    const services: Record<string, string> = {};
    for (const [id, entry] of this.running) {
      services[id] = entry.status;
    }
    const state = deriveGroupState(
      [...this.running.values()].map((r) => r.status),
      this.group.services.length
    );
    return { state, services };
  }

  /** Tail of a service's output, or of the muster narrator feed. */
  logsOf(serviceId: string, count = 500): string[] {
    if (serviceId === '@muster') return tailLines(this.narratorBuf, count);
    const entry = this.running.get(serviceId);
    return entry ? tailLines(entry.buf, count) : [];
  }

  /** The latest narrator line — the dashboard's activity status line. */
  get lastActivity(): string {
    const lines = tailLines(this.narratorBuf, 1);
    return lines[0] ?? '';
  }

  private signalEntry(entry: Running, signal: NodeJS.Signals): void {
    const { proc } = entry;
    if (entry.exited || !proc.pid) return;
    try {
      if (process.platform !== 'win32') {
        // Negative pid → the whole process group (shell + its children).
        process.kill(-proc.pid, signal);
      } else {
        proc.kill(signal);
      }
    } catch {
      // already gone
    }
  }

  /** TERM the given services, wait up to 5s, then KILL stragglers. */
  private async stopEntries(entries: Running[]): Promise<void> {
    const live = entries.filter((e) => !e.exited);
    if (live.length === 0) return;
    for (const entry of live) {
      entry.expectStop = true;
      this.signalEntry(entry, 'SIGTERM');
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && live.some((e) => !e.exited)) {
      await new Promise((r) => setTimeout(r, 150));
    }
    for (const entry of live) {
      this.signalEntry(entry, 'SIGKILL');
      entry.status = 'stopped';
    }
  }

  async startService(serviceId: string): Promise<void> {
    const service = this.group.services.find((s) => s.id === serviceId);
    if (!service) throw new Error(`Unknown service "${serviceId}" in ${this.group.id}`);
    if (this.isAlive(serviceId)) {
      this.muster(`${serviceId} is already running`);
      return;
    }
    const entry = this.spawnService(service);
    // Readiness gates run in the background so the dashboard stays live;
    // status flips starting → running/failed as they resolve.
    void this.waitReady(entry).catch((err) => {
      entry.status = 'failed';
      this.muster(`${A.red}✗ ${err instanceof Error ? err.message : err}${A.reset}`);
    });
  }

  async stopService(serviceId: string): Promise<void> {
    const entry = this.running.get(serviceId);
    if (!entry || !this.isAlive(serviceId)) {
      this.muster(`${serviceId} is not running`);
      return;
    }
    this.muster(`⏹ stopping ${serviceId}…`);
    await this.stopEntries([entry]);
    this.muster(`stopped ${serviceId}`);
  }

  async restartService(serviceId: string): Promise<void> {
    const entry = this.running.get(serviceId);
    if (entry && this.isAlive(serviceId)) {
      this.muster(`⟳ restarting ${serviceId}…`);
      await this.stopEntries([entry]);
    }
    await this.startService(serviceId);
  }

  /**
   * Start every service that isn't running (initial run or after a stop).
   * Never throws — inside a dashboard session a failed start is reported
   * on the narrator feed and the user retries, unlike one-shot `up`.
   */
  async runGroup(): Promise<void> {
    if (this.group.services.every((s) => this.isAlive(s.id))) {
      this.muster(`${this.group.id} is already running`);
      return;
    }
    try {
      await this.up();
    } catch (err) {
      this.muster(`${A.red}✗ ${err instanceof Error ? err.message : err}${A.reset}`);
    }
  }

  /** Stop all services and run postStop hooks; the session stays open. */
  async stopGroup(): Promise<void> {
    this.muster(`⏹ stopping ${this.group.id}…`);
    await this.stopEntries([...this.running.values()]);
    if (this.group.hooks?.postStop?.length) {
      try {
        await runHooks('postStop', this.group.hooks.postStop, this.root, (line) =>
          this.muster(`${A.dim}⚙ ${line}${A.reset}`)
        );
      } catch (err) {
        this.muster(`${A.red}postStop: ${err instanceof Error ? err.message : err}${A.reset}`);
      }
    }
    this.muster(`stopped ${this.group.id}`);
  }

  /** Final teardown: stop everything, run postStop hooks, latch shut. */
  async down(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.stopGroup();
  }
}
