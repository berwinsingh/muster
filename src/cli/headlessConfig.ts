/**
 * Standalone config loading for headless `muster up` — no vscode APIs.
 * Reads .vscode/muster.json from a directory, validates with the same
 * schema as the extension, and applies the same ${workspaceFolder} /
 * ${workspaceFolderBasename} / ${env:VAR} substitution.
 */
import * as fs from 'fs';
import * as path from 'path';
import { GroupConfig, WorkspaceConfigSchema } from '../config/schema';

export function substitute(value: string, root: string): string {
  return value
    .replace(/\$\{workspaceFolder\}/g, root)
    .replace(/\$\{workspaceFolderBasename\}/g, path.basename(root))
    .replace(/\$\{env:([^}]+)\}/g, (_m, name: string) => process.env[name] ?? '');
}

function resolveService<T extends GroupConfig['services'][number]>(svc: T, root: string): T {
  return {
    ...svc,
    cwd: svc.cwd ? substitute(svc.cwd, root) : root,
    envFile: svc.envFile ? substitute(svc.envFile, root) : undefined,
    command: svc.command ? substitute(svc.command, root) : undefined,
    commands: svc.commands?.map((c) => substitute(c, root)),
    env: svc.env
      ? Object.fromEntries(Object.entries(svc.env).map(([k, v]) => [k, substitute(v, root)]))
      : undefined,
    shell: svc.shell
      ? { prepend: svc.shell.prepend?.map((p) => substitute(p, root)) }
      : undefined,
    python: svc.python?.venv ? { venv: substitute(svc.python.venv, root) } : svc.python,
  };
}

/** Walk up from startDir to find the directory containing .vscode/muster.json. */
export function findConfigRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.vscode', 'muster.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadHeadlessConfig(root: string): { root: string; groups: GroupConfig[] } {
  const file = path.join(root, '.vscode', 'muster.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
  const parsed = WorkspaceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Invalid ${path.relative(process.cwd(), file)}: ${first?.path.join('.')} ${first?.message}`
    );
  }
  return {
    root,
    groups: parsed.data.groups.map((g) => ({
      ...g,
      services: g.services.map((s) => resolveService(s, root)),
    })),
  };
}
