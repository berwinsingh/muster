/**
 * First-group wizard for bare `muster` with no config (or no groups):
 * a few readline questions build a validated group — with environment
 * detection running as each service is entered — then the caller drops
 * straight into the dashboard. Streams are injectable for tests.
 */
import * as path from 'path';
import * as readline from 'node:readline/promises';
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

    const labelRaw = await ask(rl, `Group name ${A.dim}[dev]${A.reset}: `);
    if (labelRaw === null) return null;
    const label = labelRaw || 'dev';
    const groupId = slugifyId(label, 'dev');

    let config: WorkspaceConfigLike = { version: '1.0.0', groups: [] };
    const usedIds = new Set<string>();
    let count = 0;

    for (;;) {
      const prompt =
        count === 0
          ? `Service command ${A.dim}(e.g. "npm run dev")${A.reset}: `
          : `Another service command ${A.dim}(empty to finish)${A.reset}: `;
      const command = await ask(rl, prompt);
      if (command === null) return null;
      if (!command) {
        if (count === 0) {
          out(`${A.dim}Nothing to create — a service needs a command. See: muster help${A.reset}`);
          return null;
        }
        break;
      }

      count += 1;
      const idDefault = uniqueId(defaultServiceId(command, count), new Set(usedIds));
      const idRaw = await ask(rl, `  service id ${A.dim}[${idDefault}]${A.reset}: `);
      if (idRaw === null) return null;
      const id = uniqueId(slugifyId(idRaw || idDefault, `service-${count}`), usedIds);

      const cwdRaw = await ask(rl, `  working dir, relative to the project ${A.dim}[.]${A.reset}: `);
      if (cwdRaw === null) return null;
      const portRaw = await ask(rl, `  port ${A.dim}[none]${A.reset}: `);
      if (portRaw === null) return null;

      const service: ServiceInput = { id, command };
      const cwd = cwdForConfig(cwdRaw);
      if (cwd) service.cwd = cwd;
      if (portRaw) {
        const port = parseInt(portRaw, 10);
        if (Number.isInteger(port) && port >= 1 && port <= 65535) service.port = port;
        else out(`  ${A.yellow}⚠${A.reset} "${portRaw}" is not a valid port — skipping it`);
      }

      // Detection runs against the real directory the service will use.
      const detectCwd = cwdRaw && cwdRaw !== '.' ? path.resolve(root, cwdRaw) : root;
      const report = detectServiceEnv(command, detectCwd);
      if (report.apply.python) service.python = report.apply.python;
      if (report.apply.node) service.node = report.apply.node;
      for (const note of report.notes) out(`  ${note}`);

      config =
        count === 1
          ? createGroup(config, { id: groupId, label, service })
          : addService(config, groupId, service);
    }

    const file = saveLocalConfig(root, config);
    out();
    out(
      `${A.green}✓${A.reset} ${A.amber}[muster]${A.reset} created ${A.bold}${groupId}${A.reset} with ${count} service${count === 1 ? '' : 's'} → ${file}`
    );

    const startRaw = await ask(rl, `Start it now? ${A.dim}[Y/n]${A.reset}: `);
    const start = startRaw !== null && startRaw.toLowerCase() !== 'n' && startRaw.toLowerCase() !== 'no';
    return { groupId, start };
  } finally {
    rl.close();
  }
}
