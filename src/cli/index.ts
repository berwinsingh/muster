#!/usr/bin/env node
/**
 * muster — control your dev server groups from the terminal.
 *
 * A client of the Muster VS Code extension: VS Code (or Cursor) must be
 * open with the extension activated. Connects through the same discovery
 * mechanism as the MCP server.
 */
import { CliGroupStatus, IpcClient, NOT_RUNNING } from './client';
import { A, plainGroupList, statusDot } from './render';
import { runTui } from './tui';

const HELP = `
${A.amber}${A.bold}muster${A.reset} — one click (or one command), full stack running

Usage:
  muster                     Interactive dashboard (TUI)
  muster ls [--json]         List groups, services, and live status
  muster run <group>         Start a group and wait for it to come up
  muster stop <group>        Stop a group
  muster restart <group>     Restart a group
  muster status <group>      Show per-service status
  muster logs <group> <service> [-n N] [-f]   Show (or follow) service output
  muster help                This message

Requires VS Code or Cursor to be open with the Muster extension active.
`;

function fail(message: string): never {
  process.stderr.write(`${A.red}✗${A.reset} ${message}\n`);
  process.exit(1);
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
      const groupId = rest[0] ?? fail('Usage: muster run <group>');
      process.stdout.write(`${A.green}❯${A.reset} ${A.bold}muster run ${groupId}${A.reset}\n`);
      await client.run(groupId);
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
      const groupId = rest[0] ?? fail('Usage: muster stop <group>');
      await client.stop(groupId);
      process.stdout.write(`${A.amber}[muster]${A.reset} stopped ${groupId}\n`);
      return;
    }

    case 'restart': {
      const groupId = rest[0] ?? fail('Usage: muster restart <group>');
      await client.restart(groupId);
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

    default:
      fail(`Unknown command: ${command}\n${HELP}`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
