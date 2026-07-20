#!/usr/bin/env node
/**
 * muster — control your dev server groups from the terminal.
 *
 * Lifecycle commands (run/stop/status/logs, and the default dashboard)
 * drive the Muster VS Code extension over IPC. Config commands (init/
 * create/add/edit/delete/detect) and `muster up` are fully standalone:
 * with no extension reachable they read and write .vscode/muster.json
 * directly, so the CLI is complete without VS Code ever being open.
 */
import * as path from 'path';
import { CliGroup, CliGroupStatus, IpcClient, NOT_RUNNING } from './client';
import { detectServiceEnv } from './detect';
import { findConfigRoot, loadHeadlessConfig, substitute } from './headlessConfig';
import { initLocalConfig, openLocalConfig, saveLocalConfig, LocalConfig } from './localConfig';
import {
  LogLevel,
  TaggedLine,
  appendNewLines,
  filterLog,
  parseLevel,
} from './logFilter';
import {
  GroupPatch,
  ServiceInput,
  ServicePatch,
  addService,
  createGroup,
  deleteGroup,
  deleteService,
  updateGroup,
  updateService,
} from '../config/mutate';
import { effectiveCommand } from '../config/schema';
import { LocalSource, MultiLocalSource, MUSTER_FEED } from './localSource';
import { A, plainGroupList, serviceColor, statusDot } from './render';
import { Supervisor } from './supervisor';
import { runTui } from './tui';
import { runFirstGroupWizard } from './wizard';

/**
 * `muster up [group]` — run a group standalone, no VS Code required.
 * In a terminal this opens the same dashboard as remote `muster`, fed by
 * the local supervisor; `--plain` (or a non-TTY) streams flat logs instead.
 */
async function runHeadless(rest: string[]): Promise<void> {
  const root = findConfigRoot(process.env.MUSTER_WORKSPACE ?? process.cwd());
  if (!root) {
    fail(
      'No .vscode/muster.json found here or in any parent directory. Run "muster init" to scaffold one — see https://github.com/berwinsingh/muster'
    );
  }
  const { groups } = loadHeadlessConfig(root);
  if (groups.length === 0) {
    fail('The config has no groups. Add one with: muster create <group> --command "<cmd>"');
  }

  const groupId = rest.find((a) => !a.startsWith('-'));
  const group = groupId ? groups.find((g) => g.id === groupId) : groups[0];
  if (!group) {
    fail(`Unknown group "${groupId}". Available: ${groups.map((g) => g.id).join(', ')}`);
  }
  const othersNote =
    !groupId && groups.length > 1
      ? `Multiple groups found — running "${group.id}". Others: ${groups
          .filter((g) => g.id !== group.id)
          .map((g) => g.id)
          .join(', ')}`
      : '';

  const detect = !rest.includes('--no-detect');
  const wantPlain =
    rest.includes('--plain') ||
    rest.includes('--no-tui') ||
    !process.stdout.isTTY ||
    !process.stdin.isTTY;

  if (!wantPlain) {
    // Dashboard mode: the supervisor holds status + log buffers; the TUI
    // renders them exactly like the remote dashboard. Quit tears down.
    const supervisor = new Supervisor(group, root, undefined, detect);
    if (othersNote) supervisor.note(`${A.dim}${othersNote}${A.reset}`);
    let teardown: Promise<void> | null = null;
    const shutdown = (): Promise<void> => (teardown ??= supervisor.down());
    process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
    process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

    void supervisor.runGroup(); // progress streams via statuses + narrator
    await runTui(new LocalSource(supervisor), {
      groupFeedId: MUSTER_FEED,
      quitLabel: 'quit (stops all)',
      statusLine: () => supervisor.lastActivity,
      onQuit: shutdown,
    });
    return;
  }

  if (othersNote) process.stdout.write(`${A.dim}${othersNote}${A.reset}\n`);
  const supervisor = new Supervisor(group, root, (line) => process.stdout.write(line + '\n'), detect);
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

Run (no VS Code needed):
  muster                     THE dashboard. With VS Code running it drives
                             the extension; without it, it runs your groups
                             right here — and with no config yet, it walks
                             you through creating your first group.
  muster up [group] [--no-detect]   Run one group immediately with the same
                             dashboard; q or Ctrl+C stops everything.
                             Environments (venvs, .nvmrc) are detected and
                             activated automatically; --no-detect opts out.
                             --plain streams flat logs instead (auto when piped).

Configure (no VS Code needed — edits .vscode/muster.json directly;
with VS Code open, changes go through the extension and refresh live):
  muster init                Scaffold a starter .vscode/muster.json
  muster create <group> --command "<cmd>" [--label L] [--service ID]
                [--name N] [--cwd DIR] [--port N] [--layout L] [--order O]
                [--no-detect]
  muster add <group> <service> --command "<cmd>" [--name N] [--cwd DIR]
                [--port N] [--no-detect]
  muster edit <group>           [--label L] [--layout L] [--order O]
  muster edit <group> <service> [--name N] [--command "<cmd>"] [--cwd DIR]
                [--port N | --no-port] [--venv PATH | --no-venv]
                [--node-version V | --no-node-version] [--detect]
  muster delete <group> [service]   Remove a group (or one service)
  muster detect [group]      Check each service's environment: is a venv /
                             node version needed, present, or missing?
  muster ls [--json]         List groups and services (+ live status if
                             VS Code is running)

Control a running VS Code extension:
  muster run <group> [service]      Start a group (or one service) and wait
  muster stop <group> [service]     Stop a group or a single service
  muster restart <group> [service]  Restart a group or a single service
  muster status <group>      Show per-service status
  muster logs <group> [service] [-n N] [-f] [--level error|warn|info]
                             Show (or follow) output. Without a service:
                             all services combined, tagged [service].

Dashboard hotkeys: r run · s stop · x restart · l logs · a all logs ·
                   / filter · : command palette · q quit
Logs view:  f follow · v cycle level (all→errors→warnings→info) ·
            tab cycle service (all-logs view) · / text filter · esc back

  muster help                This message
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

function serviceFromFlags(id: string, flags: Record<string, string>): ServiceInput {
  const command = flags.command;
  if (!command) fail('A --command is required.');
  const service: ServiceInput = { id, command };
  if (flags.name) service.name = flags.name;
  if (flags.cwd) service.cwd = flags.cwd;
  if (flags.port) {
    const port = parseInt(flags.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid --port: ${flags.port}`);
    service.port = port;
  }
  return service;
}

/** Resolve a service cwd value (may hold ${workspaceFolder}, may be relative). */
function resolveCwd(cwd: string | undefined, root: string): string {
  if (!cwd) return root;
  return path.resolve(root, substitute(cwd, root));
}

/**
 * Detect the environment for a new/updated service, print the notes, and
 * fold the applicable settings (venv, node pin) into it. Skipped with
 * --no-detect.
 */
function enrichWithDetection(service: ServiceInput, root: string, skip: boolean): void {
  if (skip) return;
  const command = service.command ?? (service.commands ?? []).join(' && ');
  const report = detectServiceEnv(substitute(command, root), resolveCwd(service.cwd, root), service);
  if (report.apply.python) service.python = report.apply.python;
  if (report.apply.node) service.node = report.apply.node;
  for (const note of report.notes) {
    process.stdout.write(`  ${note}\n`);
  }
}

/** Connect to a running extension, or null to work standalone. */
function connectOrNull(): IpcClient | null {
  try {
    return IpcClient.connect();
  } catch {
    return null;
  }
}

/** Load the local config (walking up from cwd), or fail with guidance. */
function requireLocalConfig(): LocalConfig {
  const local = openLocalConfig(process.env.MUSTER_WORKSPACE ?? process.cwd());
  if (!local) {
    fail(
      'No .vscode/muster.json found here or in any parent directory. Run "muster init" to scaffold one.'
    );
  }
  return local;
}

function groupsAsCli(root: string): CliGroup[] {
  return loadHeadlessConfig(root).groups.map((g) => ({
    id: g.id,
    label: g.label,
    layout: g.layout,
    order: g.order,
    services: g.services.map((s) => ({
      id: s.id,
      name: s.name,
      command: effectiveCommand(s),
      port: s.port,
    })),
  }));
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

const ok = (text: string): string =>
  `${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} ${text}`;

/** Where a config change landed, for the confirmation line. */
function via(client: IpcClient | null): string {
  return client ? '' : ` ${A.dim}(wrote .vscode/muster.json directly — no VS Code needed)${A.reset}`;
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

  const client = connectOrNull();

  switch (command) {
    case undefined:
    case 'ui': {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        fail('The dashboard needs a TTY. Try "muster ls" for plain output, or "muster up --plain" to stream a group.');
      }
      if (client) {
        await runTui(client);
        return;
      }

      // No VS Code: run the dashboard on the local config. With no
      // config (or no groups) yet, walk through creating the first one.
      const start = process.env.MUSTER_WORKSPACE ?? process.cwd();
      let local = openLocalConfig(start);
      let autoRun: string | null = null;
      if (!local || local.config.groups.length === 0) {
        const created = await runFirstGroupWizard(local?.root ?? path.resolve(start));
        if (!created) return;
        if (created.start) autoRun = created.groupId;
        local = openLocalConfig(local?.root ?? start);
        if (!local) return;
      }

      const { groups } = loadHeadlessConfig(local.root);
      const source = new MultiLocalSource(local.root, groups, !rest.includes('--no-detect'));
      let teardown: Promise<void> | null = null;
      const shutdown = (): Promise<void> => (teardown ??= source.downAll());
      process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
      process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
      if (autoRun) void source.run(autoRun);
      await runTui(source, {
        groupFeedId: MUSTER_FEED,
        quitLabel: 'quit (stops all)',
        statusLine: () => source.lastActivity,
        onQuit: shutdown,
      });
      return;
    }

    case 'ls': {
      let groups: CliGroup[];
      const statuses = new Map<string, CliGroupStatus>();
      if (client) {
        groups = await client.groups();
        await Promise.all(
          groups.map(async (g) => {
            try {
              statuses.set(g.id, await client.status(g.id));
            } catch {
              // not yet run
            }
          })
        );
      } else {
        groups = groupsAsCli(requireLocalConfig().root);
      }
      if (rest.includes('--json')) {
        process.stdout.write(
          JSON.stringify(
            { groups, statuses: Object.fromEntries(statuses), source: client ? 'extension' : 'local' },
            null,
            2
          ) + '\n'
        );
      } else {
        process.stdout.write(plainGroupList(groups, statuses) + '\n');
        if (!client) {
          process.stdout.write(
            `${A.dim}VS Code not running — statuses unknown. "muster up <group>" runs one right here.${A.reset}\n`
          );
        }
      }
      return;
    }

    case 'run': {
      if (!client) fail(`${NOT_RUNNING} To run a group without VS Code, use "muster up <group>".`);
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
        process.stdout.write(`${ok(`${groupId} · ${A.green}${running}/${total} services running${A.reset}`)}\n`);
      } else {
        process.stdout.write(`${A.amber}[muster]${A.reset} ${groupId} · ${running}/${total} running (state: ${status.state})\n`);
        process.exitCode = status.state === 'failed' ? 1 : 0;
      }
      return;
    }

    case 'stop': {
      if (!client) fail(NOT_RUNNING);
      const groupId = rest[0] ?? fail('Usage: muster stop <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      await client.stop(groupId, serviceId);
      process.stdout.write(
        `${A.amber}[muster]${A.reset} stopped ${serviceId ? `${groupId}/${serviceId}` : groupId}\n`
      );
      return;
    }

    case 'restart': {
      if (!client) fail(NOT_RUNNING);
      const groupId = rest[0] ?? fail('Usage: muster restart <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      await client.restart(groupId, serviceId);
      const status = await waitForGroup(client, groupId);
      printStatus(status);
      return;
    }

    case 'status': {
      if (!client) fail(`${NOT_RUNNING} Without VS Code, "muster up <group>" shows live status in its dashboard.`);
      const groupId = rest[0] ?? fail('Usage: muster status <group>');
      const status = await client.status(groupId);
      process.stdout.write(`${A.bold}${groupId}${A.reset}  ${status.state}\n`);
      printStatus(status);
      return;
    }

    case 'logs': {
      if (!client) fail(`${NOT_RUNNING} Without VS Code, "muster up <group>" streams logs right here.`);
      // Flags may appear anywhere: strip each (with its value) off the
      // argv copy so positionals stay positional.
      const args = [...rest];
      const take = (flag: string, hasValue: boolean): string | undefined => {
        const i = args.indexOf(flag);
        if (i === -1) return undefined;
        const value = hasValue ? args[i + 1] : 'true';
        args.splice(i, hasValue ? 2 : 1);
        return value;
      };
      const nRaw = take('-n', true);
      const lines = nRaw !== undefined ? parseInt(nRaw, 10) : 100;
      if (!Number.isInteger(lines) || lines < 1) fail(`Invalid -n: ${nRaw}`);
      const levelRaw = take('--level', true);
      const level: LogLevel = levelRaw === undefined ? 'all' : parseLevel(levelRaw) ?? fail(`Invalid --level: ${levelRaw} (use error, warn, info, or all)`);
      const follow = [take('-f', false), take('--follow', false)].includes('true');
      const [groupId, serviceId] = args;
      if (!groupId) fail('Usage: muster logs <group> [service] [-n N] [-f] [--level error|warn|info]');

      if (serviceId) {
        // Single service: tail (filtered), then optionally follow.
        let shown = await client.logs(groupId, serviceId, lines);
        const filtered = filterLog(shown, level);
        process.stdout.write(filtered.join('\n') + (filtered.length ? '\n' : ''));
        if (!follow) return;

        let count = shown.length;
        setInterval(async () => {
          try {
            const latest = await client.logs(groupId, serviceId, 500);
            if (latest.length > count) {
              const fresh = filterLog(latest.slice(count - latest.length), level);
              if (fresh.length) process.stdout.write(fresh.join('\n') + '\n');
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

      // Whole group: every service, tagged [service], level-filtered.
      const group = (await client.groups()).find((g) => g.id === groupId);
      if (!group) fail(`Unknown group "${groupId}".`);
      const ids = group.services.map((s) => s.id);
      const prefix = (id: string): string => `${serviceColor(ids.indexOf(id))}[${id}]${A.reset}`;
      const combined: TaggedLine[] = [];
      const counts = new Map<string, number>();
      for (const id of ids) {
        const tail = await client.logs(groupId, id, lines).catch(() => []);
        appendNewLines(combined, counts, id, tail);
      }
      const initial = filterLog(
        combined.map((e) => `${prefix(e.serviceId)} ${e.line}`),
        level
      );
      process.stdout.write(initial.join('\n') + (initial.length ? '\n' : ''));
      if (!follow) return;

      setInterval(async () => {
        for (const id of ids) {
          try {
            const latest = await client.logs(groupId, id, 500);
            const before = combined.length;
            appendNewLines(combined, counts, id, latest);
            const fresh = filterLog(
              combined.slice(before).map((e) => `${prefix(e.serviceId)} ${e.line}`),
              level
            );
            if (fresh.length) process.stdout.write(fresh.join('\n') + '\n');
          } catch {
            // keep polling
          }
        }
      }, 1000);
      return;
    }

    case 'init': {
      if (client) {
        await client.initConfig();
        process.stdout.write(`${ok(`scaffolded .vscode/muster.json — run ${A.bold}muster ls${A.reset} to see it`)}\n`);
      } else {
        const file = initLocalConfig(process.env.MUSTER_WORKSPACE ?? process.cwd());
        process.stdout.write(`${ok(`scaffolded ${file} — run ${A.bold}muster ls${A.reset} to see it`)}\n`);
      }
      return;
    }

    case 'create': {
      const { positionals, flags } = parseFlags(rest);
      const groupId = positionals[0] ?? fail('Usage: muster create <group> --command "<cmd>"');
      const serviceId = flags.service || 'main';
      // Standalone create with no config yet starts a fresh one right here.
      const start = process.env.MUSTER_WORKSPACE ?? process.cwd();
      const local = openLocalConfig(client?.workspace ?? start);
      const root = local?.root ?? path.resolve(start);
      const service = serviceFromFlags(serviceId, flags);
      enrichWithDetection(service, root, flags['no-detect'] === 'true');
      const input = {
        id: groupId,
        service,
        ...(flags.label ? { label: flags.label } : {}),
        ...(flags.layout ? { layout: flags.layout } : {}),
        ...(flags.order ? { order: flags.order } : {}),
      };
      if (client) {
        await client.createGroup(input);
      } else {
        const base = local?.config ?? { version: '1.0.0', groups: [] };
        saveLocalConfig(root, createGroup(base, input as never));
      }
      process.stdout.write(
        `${ok(`created group ${A.bold}${groupId}${A.reset} — start it with ${A.bold}muster ${client ? 'run' : 'up'} ${groupId}${A.reset}`)}${via(client)}\n`
      );
      return;
    }

    case 'add': {
      const { positionals, flags } = parseFlags(rest);
      const groupId = positionals[0] ?? fail('Usage: muster add <group> <service> --command "<cmd>"');
      const serviceId = positionals[1] ?? fail('Usage: muster add <group> <service> --command "<cmd>"');
      const local = client ? openLocalConfig(client.workspace) : requireLocalConfig();
      const root = local?.root ?? process.cwd();
      const service = serviceFromFlags(serviceId, flags);
      enrichWithDetection(service, root, flags['no-detect'] === 'true');
      if (client) {
        await client.addService(groupId, service);
      } else {
        saveLocalConfig(local!.root, addService(local!.config, groupId, service));
      }
      process.stdout.write(`${ok(`added ${A.bold}${serviceId}${A.reset} to ${groupId}`)}${via(client)}\n`);
      return;
    }

    case 'edit': {
      const { positionals, flags } = parseFlags(rest);
      const groupId = positionals[0] ?? fail('Usage: muster edit <group> [service] --<field> <value>');
      const serviceId = positionals[1];
      const local = client ? openLocalConfig(client.workspace) : requireLocalConfig();

      if (!serviceId) {
        const patch: GroupPatch = {};
        if (flags.label) patch.label = flags.label;
        if (flags.layout) patch.layout = flags.layout as GroupPatch['layout'];
        if (flags.order) patch.order = flags.order as GroupPatch['order'];
        if (Object.keys(patch).length === 0) {
          fail('Nothing to change — pass --label, --layout, or --order (service fields need: muster edit <group> <service> …).');
        }
        if (client) await client.updateGroup(groupId, patch);
        else saveLocalConfig(local!.root, updateGroup(local!.config, groupId, patch));
        process.stdout.write(`${ok(`updated group ${A.bold}${groupId}${A.reset}`)}${via(client)}\n`);
        return;
      }

      const patch: ServicePatch = {};
      if (flags.name) patch.name = flags.name;
      if (flags.command) patch.command = flags.command;
      if (flags.cwd) patch.cwd = flags.cwd;
      if (flags.port) {
        const port = parseInt(flags.port, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid --port: ${flags.port}`);
        patch.port = port;
      }
      if (flags['no-port'] === 'true') patch.port = null;
      if (flags.venv) patch.python = { venv: flags.venv };
      if (flags['no-venv'] === 'true') patch.python = null;
      if (flags['node-version']) patch.node = { version: flags['node-version'] };
      if (flags['no-node-version'] === 'true') patch.node = null;

      const wantDetect = flags.detect === 'true';
      if (Object.keys(patch).length === 0 && !wantDetect) {
        fail(
          'Nothing to change — pass one of --name, --command, --cwd, --port/--no-port, --venv/--no-venv, --node-version/--no-node-version, or --detect.'
        );
      }

      if (wantDetect) {
        if (!local) fail('Could not find .vscode/muster.json to run detection against.');
        const group = local.config.groups.find((g) => g.id === groupId) ?? fail(`Unknown group "${groupId}"`);
        const existing = group.services.find((s) => s.id === serviceId) ?? fail(`Unknown service "${serviceId}" in "${groupId}"`);
        const command = patch.command ?? effectiveCommand(existing);
        const cwd = patch.cwd ?? existing.cwd ?? undefined;
        const service: ServiceInput = { id: serviceId, command, cwd: cwd ?? undefined };
        enrichWithDetection(service, local.root, false);
        if (service.python && patch.python === undefined) patch.python = service.python;
        if (service.node && patch.node === undefined) patch.node = service.node;
      }

      if (client) await client.updateService(groupId, serviceId, patch);
      else saveLocalConfig(local!.root, updateService(local!.config, groupId, serviceId, patch));
      process.stdout.write(`${ok(`updated ${A.bold}${groupId}/${serviceId}${A.reset}`)}${via(client)}\n`);
      return;
    }

    case 'delete':
    case 'rm': {
      const groupId = rest[0] ?? fail('Usage: muster delete <group> [service]');
      const serviceId = rest[1] && !rest[1].startsWith('-') ? rest[1] : undefined;
      if (client) {
        if (serviceId) await client.deleteService(groupId, serviceId);
        else await client.deleteGroup(groupId);
      } else {
        const local = requireLocalConfig();
        const next = serviceId
          ? deleteService(local.config, groupId, serviceId)
          : deleteGroup(local.config, groupId);
        saveLocalConfig(local.root, next);
      }
      process.stdout.write(
        `${A.amber}[muster]${A.reset} removed ${serviceId ? `${groupId}/${serviceId}` : `group ${groupId}`}${via(client)}\n`
      );
      return;
    }

    case 'detect': {
      // Detection is filesystem analysis, so it always reads the local
      // config — even when an extension is running, the files are here.
      const local = client ? openLocalConfig(client.workspace) : requireLocalConfig();
      if (!local) fail('Could not find .vscode/muster.json to inspect.');
      const filterGroup = rest.find((a) => !a.startsWith('-'));
      const groups = local.config.groups.filter((g) => !filterGroup || g.id === filterGroup);
      if (filterGroup && groups.length === 0) {
        fail(`Unknown group "${filterGroup}". Available: ${local.config.groups.map((g) => g.id).join(', ')}`);
      }
      if (groups.length === 0) fail('The config has no groups.');
      let warnings = 0;
      for (const group of groups) {
        process.stdout.write(`${A.bold}${group.label}${A.reset} ${A.dim}(${group.id})${A.reset}\n`);
        for (const svc of group.services) {
          const command = substitute(effectiveCommand(svc), local.root);
          const cwd = resolveCwd(svc.cwd, local.root);
          const report = detectServiceEnv(command, cwd, svc);
          warnings += report.warnings.length;
          const cmd = command.length > 60 ? `${command.slice(0, 57)}…` : command;
          process.stdout.write(`  ${A.bold}${svc.id}${A.reset} ${A.dim}— ${cmd}${A.reset}\n`);
          for (const note of report.notes) {
            process.stdout.write(`    ${note}\n`);
          }
        }
      }
      process.stdout.write(
        warnings === 0
          ? `${ok('environments look good')}\n`
          : `${A.yellow}⚠${A.reset} ${A.amber}[muster]${A.reset} ${warnings} environment issue${warnings === 1 ? '' : 's'} found — fix them or set overrides with ${A.bold}muster edit${A.reset}\n`
      );
      if (warnings > 0) process.exitCode = 1;
      return;
    }

    default:
      fail(`Unknown command: ${command}\n${HELP}`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
