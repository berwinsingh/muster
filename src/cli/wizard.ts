/**
 * First-group wizard for bare `muster` with no config (or no groups):
 * a few readline questions build a validated group — with environment
 * detection running as each service is entered — then the caller drops
 * straight into the dashboard. Streams are injectable for tests.
 */
import * as path from 'path';
import * as readline from 'node:readline/promises';
import { DetectedService, detectRunnableServices } from '../config/commandSuggestions';
import { WorkspaceConfigLike, ServiceInput, addService, createGroup } from '../config/mutate';
import { slugifyId } from '../config/slugify';
import { detectServiceEnv } from './detect';
import { saveLocalConfig } from './localConfig';
import { A } from './render';

export type WizardIo = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

export type WizardResult = { groupId: string; start: boolean } | null;

function defaultServiceId(command: string, index: number): string {
  const firstWord = command.trim().split(/\s+/)[0] ?? '';
  return slugifyId(path.basename(firstWord), `service-${index}`);
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let n = 2; used.has(candidate); n++) {
    candidate = `${base}-${n}`;
  }
  used.add(candidate);
  return candidate;
}

/** Resolve a wizard cwd answer for the config, keeping ${workspaceFolder} style. */
function cwdForConfig(raw: string): string | undefined {
  if (!raw || raw === '.') return undefined;
  if (path.isAbsolute(raw)) return raw;
  return '${workspaceFolder}/' + raw.replace(/^\.\//, '');
}

/**
 * Parse a pick answer: "1 3", "1,3", "2-4", "all", or empty. Out-of-range
 * and non-numeric entries are reported rather than silently dropped —
 * quietly ignoring a typo'd "7" leaves someone with a group they didn't ask
 * for and no idea why.
 */
export function parseSelection(
  raw: string,
  count: number
): { picked: number[]; invalid: string[] } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { picked: [], invalid: [] };
  if (trimmed === 'all' || trimmed === '*') {
    return { picked: Array.from({ length: count }, (_, i) => i), invalid: [] };
  }

  const picked: number[] = [];
  const invalid: string[] = [];
  for (const token of trimmed.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      if (lo < 1 || hi > count || lo > hi) {
        invalid.push(token);
        continue;
      }
      for (let n = lo; n <= hi; n++) picked.push(n - 1);
      continue;
    }
    const n = parseInt(token, 10);
    if (!Number.isInteger(n) || String(n) !== token || n < 1 || n > count) {
      invalid.push(token);
      continue;
    }
    picked.push(n - 1);
  }
  // Preserve pick order but drop repeats, so "1 1 2" is not two copies.
  return { picked: [...new Set(picked)], invalid };
}

/** Render the detected list as aligned columns. */
export function renderDetected(services: DetectedService[]): string[] {
  const dirW = Math.max(...services.map((s) => s.dir.length), 3);
  const cmdW = Math.max(...services.map((s) => s.command.length), 7);
  return services.map((s, i) => {
    const n = String(i + 1).padStart(2);
    return (
      `  ${A.amber}${n}${A.reset}  ${s.dir.padEnd(dirW)}  ` +
      `${A.bold}${s.command.padEnd(cmdW)}${A.reset}  ${A.dim}${s.source}${A.reset}`
    );
  });
}

/**
 * Ctrl+C or a closed/ended input mid-question must abort, not hang: a
 * question on a closed interface never settles, so race it against the
 * interface's own close event and normalize every failure to null.
 */
function ask(rl: readline.Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = (): void => resolve(null);
    rl.once('close', onClose);
    rl.question(prompt).then(
      (answer) => {
        rl.removeListener('close', onClose);
        resolve(answer.trim());
      },
      () => {
        rl.removeListener('close', onClose);
        resolve(null);
      }
    );
  });
}

export async function runFirstGroupWizard(
  root: string,
  io: WizardIo = { input: process.stdin, output: process.stdout }
): Promise<WizardResult> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  const out = (line = ''): void => {
    io.output.write(line + '\n');
  };

  try {
    out();
    out(`${A.amber}${A.bold} MUSTER ${A.reset} no server groups in ${A.bold}${root}${A.reset} yet — let's set one up.`);
    out(`${A.dim}Enter accepts the [default]; Ctrl+C aborts. This writes .vscode/muster.json.${A.reset}`);
    out();

    // Services are gathered first and the group is built once at the end,
    // so the group name can be asked after we know what is actually in it
    // (and can default to something better than "dev").
    const services: ServiceInput[] = [];
    const usedIds = new Set<string>();

    const addPort = async (id: string, label: string): Promise<string | null> =>
      ask(rl, `  port for ${A.bold}${id}${A.reset} ${A.dim}[${label}]${A.reset}: `);

    const applyPort = (service: ServiceInput, portRaw: string): void => {
      if (!portRaw) return;
      const port = parseInt(portRaw, 10);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) service.port = port;
      else out(`  ${A.yellow}⚠${A.reset} "${portRaw}" is not a valid port — skipping it`);
    };

    const applyEnvDetection = (service: ServiceInput, dir: string): void => {
      const detectCwd = dir === '.' ? root : path.resolve(root, dir);
      const report = detectServiceEnv(service.command ?? '', detectCwd);
      if (report.apply.python) service.python = report.apply.python;
      if (report.apply.node) service.node = report.apply.node;
      for (const note of report.notes) out(`  ${note}`);
    };

    // Offer what is actually in the project before asking anyone to type a
    // path. In a monorepo, "working dir relative to the project" is an
    // impossible question to answer from a blank prompt.
    const detected = detectRunnableServices(root);
    if (detected.length > 0) {
      out(
        `${A.dim}Scanning for runnable services…${A.reset}  ` +
          `found ${A.bold}${detected.length}${A.reset}`
      );
      out();
      for (const line of renderDetected(detected)) out(line);
      out();
      out(
        `${A.dim}Pick services  ${A.reset}1 3${A.dim}  ·  ${A.reset}1-3${A.dim}  ·  ${A.reset}all` +
          `${A.dim}  ·  Enter to type one manually${A.reset}`
      );
      const pickRaw = await ask(rl, '> ');
      if (pickRaw === null) return null;
      const { picked, invalid } = parseSelection(pickRaw, detected.length);
      for (const bad of invalid) {
        out(`  ${A.yellow}⚠${A.reset} ignoring "${bad}" — pick a number from 1 to ${detected.length}`);
      }

      const chosen = picked.map((i) => detected[i]);
      if (chosen.length > 0) {
        out();
        for (const s of chosen) {
          out(
            `  ${A.green}✓${A.reset} ${A.bold}${s.id}${A.reset}  ` +
              `${A.dim}${s.dir === '.' ? './' : s.dir}${A.reset}  ${s.command}`
          );
        }
        out();

        // A picked service already knows its command, directory and id, so
        // the port is the only thing still worth asking about.
        for (const s of chosen) {
          const id = uniqueId(slugifyId(s.id, `service-${services.length + 1}`), usedIds);
          const portRaw = await addPort(id, 'none');
          if (portRaw === null) return null;

          const service: ServiceInput = { id, command: s.command };
          const cwd = cwdForConfig(s.dir);
          if (cwd) service.cwd = cwd;
          applyPort(service, portRaw);
          applyEnvDetection(service, s.dir);
          services.push(service);
        }
      }
    }

    // Manual entry: the only path when nothing was detected, and the way to
    // add anything the scan missed.
    for (;;) {
      const prompt =
        services.length === 0
          ? `Service command ${A.dim}(e.g. "npm run dev")${A.reset}: `
          : `Add another service ${A.dim}(empty to finish)${A.reset}: `;
      const command = await ask(rl, prompt);
      if (command === null) return null;
      if (!command) {
        if (services.length === 0) {
          out(`${A.dim}Nothing to create — a service needs a command. See: muster help${A.reset}`);
          return null;
        }
        break;
      }

      const nth = services.length + 1;
      const idDefault = uniqueId(defaultServiceId(command, nth), new Set(usedIds));
      const idRaw = await ask(rl, `  service id ${A.dim}[${idDefault}]${A.reset}: `);
      if (idRaw === null) return null;
      const id = uniqueId(slugifyId(idRaw || idDefault, `service-${nth}`), usedIds);

      const cwdRaw = await ask(rl, `  working dir, relative to the project ${A.dim}[.]${A.reset}: `);
      if (cwdRaw === null) return null;
      const portRaw = await addPort(id, 'none');
      if (portRaw === null) return null;

      const service: ServiceInput = { id, command };
      const cwd = cwdForConfig(cwdRaw);
      if (cwd) service.cwd = cwd;
      applyPort(service, portRaw);
      applyEnvDetection(service, cwdRaw || '.');
      services.push(service);
    }

    // Default the group to the project's own folder name — almost always
    // what someone means, and better than a generic "dev".
    const nameDefault = slugifyId(path.basename(root), 'dev');
    const labelRaw = await ask(rl, `Group name ${A.dim}[${nameDefault}]${A.reset}: `);
    if (labelRaw === null) return null;
    const label = labelRaw || nameDefault;
    const groupId = slugifyId(label, nameDefault);

    let config: WorkspaceConfigLike = { version: '1.0.0', groups: [] };
    config = createGroup(config, { id: groupId, label, service: services[0] });
    for (const service of services.slice(1)) {
      config = addService(config, groupId, service);
    }

    const file = saveLocalConfig(root, config);
    out();
    out(
      `${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} created ${A.bold}${groupId}${A.reset} with ${services.length} service${services.length === 1 ? '' : 's'} → ${file}`
    );

    const startRaw = await ask(rl, `Start it now? ${A.dim}[Y/n]${A.reset}: `);
    const start = startRaw !== null && startRaw.toLowerCase() !== 'n' && startRaw.toLowerCase() !== 'no';
    return { groupId, start };
  } finally {
    rl.close();
  }
}
