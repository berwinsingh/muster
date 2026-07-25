/**
 * `muster daemon start|stop|status` — a background process that owns a
 * workspace's groups independent of any editor, so `muster run/stop/logs`
 * and every MCP tool keep working after the terminal (or VS Code) that
 * started them closes. This module is the CLI-facing half; the actual
 * server lives in src/daemon/server.ts.
 *
 * `start` without --foreground re-execs the current CLI entry point as a
 * detached child (so it survives this process exiting) and polls the
 * discovery file to confirm it came up; --foreground runs the server
 * in-process and blocks, which is what that child actually does, and is
 * also the right mode for anyone who'd rather manage detachment themselves
 * (systemd, tmux, docker).
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getStateDir, workspaceKey } from '../config/paths';
import { isPidAlive, readExactDiscovery, removeDiscoveryFile } from '../ipc/discovery';
import { startDaemonServer } from '../daemon/server';
import { findConfigRoot } from './headlessConfig';
import { A } from './render';

function fail(message: string): never {
  process.stderr.write(`${A.red}✗${A.reset} ${message}\n`);
  process.exit(1);
}

function ok(message: string): void {
  process.stdout.write(`${A.green}✓${A.reset} ${A.amber}[muster daemon]${A.reset} ${message}\n`);
}

function requireRoot(): string {
  const root = findConfigRoot(process.env.MUSTER_WORKSPACE ?? process.cwd());
  if (!root) {
    fail(
      'No .vscode/muster.json found here or in any parent directory. Run "muster init" to scaffold one.'
    );
  }
  return root;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function daemonLogFile(root: string): string {
  return path.join(getStateDir(), 'daemon-logs', `${workspaceKey(root)}.log`);
}

/** Runs the server in-process and never returns until it's told to stop. */
export async function runDaemonForeground(
  root: string,
  detect: boolean,
  allowAgentActions: boolean
): Promise<void> {
  const daemon = await startDaemonServer({ root, detect, allowAgentActions });
  process.stdout.write(
    `[muster daemon] listening on 127.0.0.1:${daemon.port} for ${root}` +
      `${allowAgentActions ? ' (agent actions allowed)' : ''}\n`
  );
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void daemon.dispose().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // No further action needed to stay alive — the listening HTTP server
  // holds the event loop open on its own.
}

export async function daemonStart(rest: string[]): Promise<{ port: number; pid: number }> {
  const root = requireRoot();
  const detect = !rest.includes('--no-detect');
  const allowAgentActions = rest.includes('--allow-agent-actions');
  const foreground = rest.includes('--foreground');

  const existing = readExactDiscovery(root, 'daemon');
  if (existing) {
    if (!foreground) {
      ok(`already running (pid ${existing.pid}, port ${existing.port}) for ${root}`);
    }
    return existing;
  }

  if (foreground) {
    await runDaemonForeground(root, detect, allowAgentActions);
    // runDaemonForeground never returns in practice (the server keeps the
    // event loop alive until a signal); this satisfies the return type for
    // the rare case it does.
    const found = readExactDiscovery(root, 'daemon');
    return found ?? { port: 0, pid: process.pid };
  }

  const logFile = daemonLogFile(root);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const args = [
    process.argv[1],
    'daemon',
    'start',
    '--foreground',
    ...(detect ? [] : ['--no-detect']),
    ...(allowAgentActions ? ['--allow-agent-actions'] : []),
  ];
  const child = cp.spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, MUSTER_WORKSPACE: root },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();

  const deadline = Date.now() + 5000;
  let found = null;
  while (Date.now() < deadline) {
    found = readExactDiscovery(root, 'daemon');
    if (found) break;
    await sleep(150);
  }
  if (!found) {
    fail(`daemon did not start within 5s — check ${logFile}`);
  }
  ok(`started (pid ${found.pid}, port ${found.port}) for ${root} — logs: ${logFile}`);
  return found;
}

export async function daemonStop(): Promise<void> {
  const root = requireRoot();
  const existing = readExactDiscovery(root, 'daemon');
  if (!existing) {
    process.stdout.write(`${A.dim}[muster daemon] not running for ${root}${A.reset}\n`);
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${existing.port}/shutdown`, { method: 'POST' });
  } catch {
    // Already gone, or refusing connections — fall through to the pid wait
    // below, which will time out and we clean up the stale file ourselves.
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isPidAlive(existing.pid)) {
    await sleep(150);
  }
  if (isPidAlive(existing.pid)) {
    fail(`daemon (pid ${existing.pid}) did not stop within 5s`);
  }
  removeDiscoveryFile(root, undefined, 'daemon');
  ok(`stopped for ${root}`);
}

export async function daemonStatus(): Promise<void> {
  const root = requireRoot();
  const existing = readExactDiscovery(root, 'daemon');
  if (!existing) {
    process.stdout.write(`${A.dim}[muster daemon] not running for ${root}${A.reset}\n`);
    return;
  }

  let healthy = false;
  try {
    const res = await fetch(`http://127.0.0.1:${existing.port}/health`);
    healthy = res.ok;
  } catch {
    healthy = false;
  }

  if (!healthy) {
    process.stdout.write(
      `${A.yellow}⚠${A.reset} [muster daemon] pid ${existing.pid} is alive but not responding on port ${existing.port}\n`
    );
    return;
  }

  ok(`running (pid ${existing.pid}, port ${existing.port}) for ${root}`);
}
