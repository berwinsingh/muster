/**
 * Headless supervisor for `muster up`: runs a group's services as child
 * processes with the same semantics as the extension — dependency order,
 * delays, readyPattern/healthUrl gates, preRun/postStop hooks — but fully
 * standalone. Logs stream prefixed per service; Ctrl+C tears everything
 * down (postStop hooks included).
 */
import * as cp from 'child_process';
import { GroupConfig, ServiceConfig, effectiveCommand } from '../config/schema';
import { buildServiceEnv } from '../config/env';
import { buildPrependCommands } from '../config/runtimeDetect';
import { runHooks } from '../orchestration/hooks';
import { A } from './render';

const PALETTE = [A.green, A.blue, A.yellow, A.amber];

type Running = {
  service: ServiceConfig;
  proc: cp.ChildProcess;
  output: string[];
  status: 'starting' | 'running' | 'failed' | 'stopped';
};

function shellFor(): { shell: string; flag: string } {
  return process.platform === 'win32'
    ? { shell: 'cmd.exe', flag: '/c' }
    : { shell: '/bin/bash', flag: '-lc' };
}

export class Supervisor {
  private readonly running = new Map<string, Running>();
  private stopping = false;

  constructor(
    private readonly group: GroupConfig,
    private readonly root: string,
    private readonly log: (line: string) => void
  ) {}

  private prefix(serviceId: string): string {
    const ids = this.group.services.map((s) => s.id);
    const color = PALETTE[Math.max(0, ids.indexOf(serviceId)) % PALETTE.length];
    return `${color}[${serviceId}]${A.reset}`;
  }

  private muster(line: string): void {
    this.log(`${A.amber}[muster]${A.reset} ${line}`);
  }

  private spawnService(service: ServiceConfig): Running {
    const prepend = buildPrependCommands(service);
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

    const entry: Running = { service, proc, output: [], status: 'starting' };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8');
      entry.output.push(text);
      if (entry.output.length > 500) entry.output.splice(0, entry.output.length - 500);
      for (const line of text.split(/\r?\n/)) {
        if (line) this.log(`${this.prefix(service.id)} ${line}`);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', (code) => {
      if (this.stopping) {
        entry.status = 'stopped';
        return;
      }
      entry.status = code === 0 ? 'stopped' : 'failed';
      this.muster(
        code === 0
          ? `${service.id} exited`
          : `${A.red}✗ ${service.id} exited with code ${code}${A.reset}`
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
        if (regex.test(entry.output.join(''))) {
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
    entry.status = 'running';
  }

  async up(): Promise<void> {
    this.log(`${A.green}❯${A.reset} ${A.bold}muster up ${this.group.id}${A.reset}`);
    this.muster(
      `starting ${this.group.services.length} service${this.group.services.length === 1 ? '' : 's'} · layout: headless · order: ${this.group.order}`
    );

    if (this.group.hooks?.preRun?.length) {
      await runHooks('preRun', this.group.hooks.preRun, this.root, (line) =>
        this.muster(`${A.dim}⚙ ${line}${A.reset}`)
      );
    }

    const completed = new Set<string>();
    const pending = [...this.group.services];

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

    const up = [...this.running.values()].filter((r) => r.status === 'running' || r.status === 'starting').length;
    this.log(
      `${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} ${this.group.id} · ${A.green}${up}/${this.group.services.length} services running${A.reset} ${A.dim}(Ctrl+C to stop)${A.reset}`
    );
  }

  /** True while any child is still alive. */
  get alive(): boolean {
    return [...this.running.values()].some((r) => r.proc.exitCode === null && !r.proc.killed);
  }

  async down(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.muster(`⏹ stopping ${this.group.id}…`);
    const signalAll = (signal: NodeJS.Signals): void => {
      for (const { proc } of this.running.values()) {
        if (proc.exitCode !== null || !proc.pid) continue;
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
    };
    signalAll('SIGTERM');
    // Grace period, then force-kill stragglers.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && this.alive) {
      await new Promise((r) => setTimeout(r, 150));
    }
    signalAll('SIGKILL');
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
}
