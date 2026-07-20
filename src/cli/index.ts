#!/usr/bin/env node
/**
 * muster — control your dev server groups from the terminal.
 *
 * A client of the Muster VS Code extension: VS Code (or Cursor) must be
 * open with the extension activated. Connects through the same discovery
 * mechanism as the MCP server.
 */
import { CliGroupStatus, IpcClient, NOT_RUNNING } from './client';
import { findConfigRoot, loadHeadlessConfig } from './headlessConfig';
import { A, plainGroupList, statusDot } from './render';
import { Supervisor } from './supervisor';
import { runTui } from './tui';

/** `muster up [group]` — run a group standalone, no VS Code required. */
async function runHeadless(rest: string[]): Promise<void> {
  const root = findConfigRoot(process.env.MUSTER_WORKSPACE ?? process.cwd());
  if (!root) {
    fail(
      'No .vscode/muster.json found here or in any parent directory. Run "muster init" (with VS Code open) or create one — see https://github.com/berwinsingh/muster'
    );
  }
  const { groups } = loadHeadlessConfig(root);
  if (groups.length === 0) {
    fail('The config has no groups.');
  }

  const groupId = rest[0] && !rest[0].startsWith('-') ? rest[0] : undefined;
  const group = groupId ? groups.find((g) => g.id === groupId) : groups[0];
  if (!group) {
    fail(`Unknown group "${groupId}". Available: ${groups.map((g) => g.id).join(', ')}`);
  }
  if (!groupId && groups.length > 1) {
    process.stdout.write(
      `${A.dim}Multiple groups found — running "${group.id}". Others: ${groups
        .filter((g) => g.id !== group.id)
        .map((g) => g.id)
        .join(', ')}${A.reset}\n`
    );
  }

  const supervisor = new Supervisor(group, root, (line) => process.stdout.write(line + '\n'));
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void supervisor.down().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await supervisor.up();
  } catch (err) {
    process.stderr.write(`${A.red}✗${A.reset} ${err instanceof Error ? err.message : err}\n`);
    await supervisor.down();
    process.exit(1);
  }

  // Stay in the foreground while services live; exit when they all stop.
  const watch = setInterval(() => {
    if (!supervisor.alive && !shuttingDown) {
      clearInterval(watch);
      process.stdout.write(`${A.amber}[muster]${A.reset} all services have exited\n`);
      process.exit(0);
    }
  }, 1000);
}

const HELP = `
${A.amber}${A.bold}muster${A.reset} — one click (or one command), full stack running

Usage:
  muster up [group]          Run a group RIGHT HERE — no VS Code needed.
                             Supervises the processes itself; Ctrl+C stops all.
  muster                     Interactive dashboard (TUI; drives the VS Code extension)
  muster ls [--json]         List groups, services, and live status
  muster run <group> [service]      Start a group (or one service) and wait
  muster stop <group> [service]     Stop a group or a single service
  muster restart <group> [service]  Restart a group or a single service
  muster status <group>      Show per-service status
  muster logs <group> <service> [-n N] [-f]   Show (or follow) service output

  muster init                Scaffold a starter .vscode/muster.json
  muster create <group> --command "<cmd>" [--label L] [--service ID]
                             [--name N] [--cwd DIR] [--port N] [--layout L]
  muster add <group> <service> --command "<cmd>" [--name N] [--cwd DIR] [--port N]
  muster delete <group> [service]   Remove a group (or one service)

  muster help                This message

Requires VS Code or Cursor to be open with the Muster extension active.
`;

function fail(message: string): never {
  process.stderr.write(`${A.red}✗${A.reset} ${message}\n`);
  process.exit(1);
}

/** Parse "--flag value" pairs and bare positionals out of an argv slice. */
function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = value;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function serviceFromFlags(id: string, flags: Record<string, string>): Record<string, unknown> {
  const command = flags.command;
  if (!command) fail('A --command is required.');
  const service: Record<string, unknown> = { id, command };
  if (flags.name) service.name = flags.name;
  if (flags.cwd) service.cwd = flags.cwd;
  if (flags.port) {
    const port = parseInt(flags.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid --port: ${flags.port}`);
    service.port = port;
  }
  return service;
}

async function waitForGroup(client: IpcClient, groupId: string, timeoutMs = 60_000): Promise<CliGroupStatus> {
  const start = Date.now();
  let last: CliGroupStatus | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await client.status(groupId);
    if (last.state === 'running' || last.state === 'failed' || last.state === 'partial') {
      return last;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return last ?? { groupId, state: 'unknown', services: {} };
}

function printStatus(status: CliGroupStatus): void {
  for (const [serviceId, serviceStatus] of Object.entries(status.services)) {
    process.stdout.write(`  ${statusDot(serviceStatus)} ${serviceId}  ${A.dim}${serviceStatus}${A.reset}\n`);
  }
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  // `muster up` is fully standalone — it reads the config and supervises
  // the processes itself, so it must run before any attempt to reach a
  // VS Code extension.
  if (command === 'up') {
    await runHeadless(rest);
    return;
  }

  let client: IpcClient;
  try {
    client = IpcClient.connect();
  } catch {
    fail(NOT_RUNNING);
  }

  switch (command) {
    case undefined:
    case 'ui': {
      if (!process.stdout.isTTY) {
        fail('The dashboard needs a TTY. Try "muster ls" for plain output.');
      }
      await runTui(client);
      return;
    }

    case 'ls': {
      const groups = await client.groups();
      const statuses = new Map<string, CliGroupStatus>();
      await Promise.all(
        groups.map(async (g) => {
          try {
            statuses.set(g.id, await client.status(g.id));
          } catch {
            // not yet run
          }
        })
      );
      if (rest.includes('--json')) {
        process.stdout.write(
          JSON.stringify({ groups, statuses: Object.fromEntries(statuses) }, null, 2) + '\n'
        );
      } else {
        process.stdout.write(plainGroupList(groups, statuses) + '\n');
      }
      return;
    }

    case 'run': {
      const groupId = rest[0] ?? fail('Usage: muster run <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      process.stdout.write(
        `${A.green}❯${A.reset} ${A.bold}muster run ${groupId}${serviceId ? ` ${serviceId}` : ''}${A.reset}\n`
      );
      await client.run(groupId, serviceId);
      const status = await waitForGroup(client, groupId);
      printStatus(status);
      const running = Object.values(status.services).filter((s) => s === 'running').length;
      const total = Object.keys(status.services).length;
      if (status.state === 'running') {
        process.stdout.write(`${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} ${groupId} · ${A.green}${running}/${total} services running${A.reset}\n`);
      } else {
        process.stdout.write(`${A.amber}[muster]${A.reset} ${groupId} · ${running}/${total} running (state: ${status.state})\n`);
        process.exitCode = status.state === 'failed' ? 1 : 0;
      }
      return;
    }

    case 'stop': {
      const groupId = rest[0] ?? fail('Usage: muster stop <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      await client.stop(groupId, serviceId);
      process.stdout.write(
        `${A.amber}[muster]${A.reset} stopped ${serviceId ? `${groupId}/${serviceId}` : groupId}\n`
      );
      return;
    }

    case 'restart': {
      const groupId = rest[0] ?? fail('Usage: muster restart <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      await client.restart(groupId, serviceId);
      const status = await waitForGroup(client, groupId);
      printStatus(status);
      return;
    }

    case 'status': {
      const groupId = rest[0] ?? fail('Usage: muster status <group>');
      const status = await client.status(groupId);
      process.stdout.write(`${A.bold}${groupId}${A.reset}  ${status.state}\n`);
      printStatus(status);
      return;
    }

    case 'logs': {
      const [groupId, serviceId] = rest;
      if (!groupId || !serviceId) fail('Usage: muster logs <group> <service> [-n N] [-f]');
      const nIdx = rest.indexOf('-n');
      const lines = nIdx >= 0 ? parseInt(rest[nIdx + 1] ?? '100', 10) : 100;
      const follow = rest.includes('-f') || rest.includes('--follow');

      let shown = await client.logs(groupId, serviceId, lines);
      process.stdout.write(shown.join('\n') + '\n');
      if (!follow) return;

      // Follow: poll and print only lines beyond what we've already shown.
      let count = shown.length;
      setInterval(async () => {
        try {
          const latest = await client.logs(groupId, serviceId, 500);
          if (latest.length > count) {
            process.stdout.write(latest.slice(count - latest.length).join('\n') + '\n');
          } else if (latest.length < count) {
            count = 0; // service restarted, buffer reset
          }
          count = latest.length;
        } catch {
          // keep polling; VS Code may be restarting
        }
      }, 1000);
      return;
    }

    case 'init': {
      await client.initConfig();
      process.stdout.write(`${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} scaffolded .vscode/muster.json — run ${A.bold}muster ls${A.reset} to see it\n`);
      return;
    }

    case 'create': {
      const { positionals, flags } = parseFlags(rest);
      const groupId = positionals[0] ?? fail('Usage: muster create <group> --command "<cmd>"');
      const serviceId = flags.service || 'main';
      const group: Record<string, unknown> = {
        id: groupId,
        service: serviceFromFlags(serviceId, flags),
      };
      if (flags.label) group.label = flags.label;
      if (flags.layout) group.layout = flags.layout;
      if (flags.order) group.order = flags.order;
      await client.createGroup(group);
      process.stdout.write(`${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} created group ${A.bold}${groupId}${A.reset} — start it with ${A.bold}muster run ${groupId}${A.reset}\n`);
      return;
    }

    case 'add': {
      const { positionals, flags } = parseFlags(rest);
      const groupId = positionals[0] ?? fail('Usage: muster add <group> <service> --command "<cmd>"');
      const serviceId = positionals[1] ?? fail('Usage: muster add <group> <service> --command "<cmd>"');
      await client.addService(groupId, serviceFromFlags(serviceId, flags));
      process.stdout.write(`${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} added ${A.bold}${serviceId}${A.reset} to ${groupId}\n`);
      return;
    }

    case 'delete':
    case 'rm': {
      const groupId = rest[0] ?? fail('Usage: muster delete <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      if (serviceId) {
        await client.deleteService(groupId, serviceId);
        process.stdout.write(`${A.amber}[muster]${A.reset} removed ${groupId}/${serviceId}\n`);
      } else {
        await client.deleteGroup(groupId);
        process.stdout.write(`${A.amber}[muster]${A.reset} removed group ${groupId}\n`);
      }
      return;
    }

    default:
      fail(`Unknown command: ${command}\n${HELP}`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
