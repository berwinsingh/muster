/**
 * Opening .vscode/muster.json from the dashboard. The TUI can start, stop
 * and read services but never had a way to *change* one — you had to quit,
 * run `muster edit`, and come back. This hands the file to $EDITOR at the
 * line the selected service is defined on, then re-validates whatever came
 * back so a typo surfaces immediately instead of at the next run.
 *
 * Editor choice and line targeting are pure functions so the interesting
 * parts are testable without spawning anything.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { openLocalConfig } from './localConfig';

/** Editors that take `+LINE` before the filename. */
const PLUS_LINE = new Set([
  'vi', 'vim', 'nvim', 'view', 'nano', 'pico', 'emacs', 'emacsclient',
  'micro', 'joe', 'kak', 'helix', 'hx', 'gedit', 'kate', 'mousepad',
]);

/** VS Code and its forks: need --wait, or the editor returns instantly. */
const CODE_LIKE = new Set([
  'code', 'code-insiders', 'codium', 'vscodium', 'cursor', 'windsurf', 'positron',
]);

/**
 * 1-based line where a service (or the group itself) is defined.
 *
 * A scan rather than a parse: we need a position in the user's file,
 * including its comments and formatting, which JSON.parse throws away.
 * Groups and services both key on "id", so a group whose id matches an
 * earlier group's *service* can land a few lines off — harmless for a
 * cursor hint, and the alternative is a full position-tracking parser.
 */
export function findServiceLine(source: string, groupId: string, serviceId?: string): number {
  const lines = source.split('\n');
  const idOn = (i: number): string | undefined => /"id"\s*:\s*"([^"]*)"/.exec(lines[i])?.[1];

  let groupLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (idOn(i) === groupId) {
      groupLine = i;
      break;
    }
  }
  if (groupLine === -1) return 1;
  if (!serviceId) return groupLine + 1;

  for (let i = groupLine + 1; i < lines.length; i++) {
    if (idOn(i) === serviceId) return i + 1;
  }
  return groupLine + 1;
}

/**
 * Split an $EDITOR spec ("code --wait", "vim") into a command plus the
 * arguments that open `file` at `line`. Unknown editors just get the path —
 * a wrong flag would be worse than landing on line 1.
 */
export function editorCommand(
  spec: string,
  file: string,
  line: number
): { cmd: string; args: string[] } {
  const parts = spec.trim().split(/\s+/);
  const cmd = parts[0];
  const extra = parts.slice(1);
  const base = path.basename(cmd).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();

  if (CODE_LIKE.has(base)) {
    const args = [...extra];
    // Without --wait the editor forks and we redraw over the user's edit.
    if (!args.includes('--wait') && !args.includes('-w')) args.push('--wait');
    args.push('--goto', line > 0 ? `${file}:${line}` : file);
    return { cmd, args };
  }
  if (PLUS_LINE.has(base) && line > 0) return { cmd, args: [...extra, `+${line}`, file] };
  return { cmd, args: [...extra, file] };
}

function onPath(cmd: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? '').split(path.delimiter).some((dir) => {
    if (!dir) return false;
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * $VISUAL, then $EDITOR, then whatever is actually installed. Returns null
 * when there is nothing to open — the caller says so rather than spawning
 * a command that doesn't exist and leaving the screen in pieces.
 */
export function resolveEditor(
  env: NodeJS.ProcessEnv = process.env,
  exists: (cmd: string) => boolean = (cmd) => onPath(cmd, env)
): string | null {
  const explicit = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (explicit) return explicit;
  return ['nano', 'vim', 'vi'].find(exists) ?? null;
}

export type EditOutcome = {
  /** One line for the dashboard's flash area. */
  message: string;
  /** True when the file on disk differs from before the editor ran. */
  changed: boolean;
  /** False when what was saved no longer parses — callers must not reload it. */
  valid: boolean;
};

/**
 * Open the workspace config at a service and report what happened. Never
 * throws: the dashboard is mid-redraw and an exception here would take the
 * terminal down with it, so every failure comes back as a message.
 */
export function editConfigTarget(
  root: string,
  groupId: string,
  serviceId?: string,
  env: NodeJS.ProcessEnv = process.env
): EditOutcome {
  const file = path.join(root, '.vscode', 'muster.json');
  const label = serviceId ? `${groupId}/${serviceId}` : groupId;

  let before: string;
  try {
    before = fs.readFileSync(file, 'utf-8');
  } catch {
    return {
      message: `no ${path.join('.vscode', 'muster.json')} to edit`,
      changed: false,
      valid: false,
    };
  }

  const spec = resolveEditor(env);
  if (!spec) {
    return {
      message: 'no editor found — set $EDITOR (or use: muster edit)',
      changed: false,
      valid: true,
    };
  }

  const { cmd, args } = editorCommand(spec, file, findServiceLine(before, groupId, serviceId));
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) {
    return { message: `could not run ${cmd}: ${result.error.message}`, changed: false, valid: true };
  }

  let after: string;
  try {
    after = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    return { message: `could not re-read config: ${String(err)}`, changed: true, valid: false };
  }
  if (after === before) return { message: `${label} unchanged`, changed: false, valid: true };

  // The file is the user's to keep either way — we report the problem
  // rather than reverting work they just did.
  try {
    openLocalConfig(root);
  } catch (err) {
    return {
      message: `⚠ ${err instanceof Error ? err.message : String(err)}`,
      changed: true,
      valid: false,
    };
  }
  return { message: `${label} saved`, changed: true, valid: true };
}
