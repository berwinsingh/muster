import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getUserConfigDir, workspaceKey } from '../config/paths';

/**
 * `kind` tells a client what is on the other end: the VS Code extension, or
 * a standalone `muster` daemon. Older entries predate the field, so it is
 * optional and treated as 'extension' when absent.
 */
export type IpcServerKind = 'extension' | 'daemon';

export type IpcDiscovery = {
  port: number;
  workspace: string;
  pid: number;
  kind?: IpcServerKind;
};

export function getDiscoveryDir(): string {
  return path.join(getUserConfigDir(), 'ipc');
}

/**
 * The extension keeps the original unsuffixed name so that a new CLI still
 * finds an older extension host (and vice versa); the daemon gets its own
 * file, letting both own the same workspace without clobbering each other.
 */
export function discoveryFilePath(
  workspaceRoot: string,
  dir = getDiscoveryDir(),
  kind: IpcServerKind = 'extension'
): string {
  const suffix = kind === 'daemon' ? '.daemon.json' : '.json';
  return path.join(dir, `${workspaceKey(workspaceRoot)}${suffix}`);
}

/** True when `dir` is `workspace` itself, or lives inside it. */
export function workspaceContains(workspace: string, dir: string): boolean {
  if (!workspace) return false;
  const root = path.resolve(workspace);
  const target = path.resolve(dir);
  return target === root || target.startsWith(root + path.sep);
}

/**
 * True when a discovered server should be ignored in favour of the config
 * in `dir`: it serves an unrelated workspace, and `dir` has one of its own.
 *
 * findDiscovery falls back to any live server when nothing matches the
 * current directory. That is right when you have no config of your own and
 * wrong when you do — it answers for a stranger's workspace while your
 * .vscode/muster.json sits right there. Both the CLI and the MCP server ask
 * this question; what they can do about it differs (the CLI has a local
 * config to fall back on, the MCP server can only refuse), so each phrases
 * its own message and only the rule is shared.
 */
export function servesElsewhere(
  serverWorkspace: string,
  dir: string,
  localRoot: string | null
): boolean {
  return localRoot !== null && !workspaceContains(serverWorkspace, dir);
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function writeDiscoveryFile(entry: IpcDiscovery, dir = getDiscoveryDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = discoveryFilePath(entry.workspace, dir, entry.kind ?? 'extension');
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf-8');
  return file;
}

export function removeDiscoveryFile(
  workspaceRoot: string,
  dir = getDiscoveryDir(),
  kind: IpcServerKind = 'extension'
): void {
  try {
    fs.unlinkSync(discoveryFilePath(workspaceRoot, dir, kind));
  } catch {
    // already gone
  }
}

function readEntry(file: string): IpcDiscovery | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<IpcDiscovery>;
    if (
      typeof raw.port !== 'number' ||
      raw.port <= 0 ||
      typeof raw.workspace !== 'string' ||
      typeof raw.pid !== 'number'
    ) {
      return null;
    }
    return { ...raw, kind: raw.kind === 'daemon' ? 'daemon' : 'extension' } as IpcDiscovery;
  } catch {
    return null;
  }
}

/**
 * Find a live IPC endpoint: a standalone `muster` daemon, or a running
 * Muster extension host.
 *
 * Preference order: exact workspace match, then a workspace that is a parent
 * of `workspaceHint`, then the only live entry, then the most recent one.
 * Within any of those tiers a daemon wins over an extension, because the
 * daemon owns processes that outlive any editor window — talking to the
 * extension instead would report a group as stopped while it is still up.
 * Set MUSTER_IPC_KIND=extension to invert that.
 *
 * Stale entries are deleted as they are seen: unparsable, dead pid, or a
 * workspace directory that no longer exists on disk.
 */
export function findDiscovery(
  workspaceHint: string | null,
  dir = getDiscoveryDir(),
  preferKind: IpcServerKind = process.env.MUSTER_IPC_KIND === 'extension'
    ? 'extension'
    : 'daemon'
): IpcDiscovery | null {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }

  const alive: { entry: IpcDiscovery; mtimeMs: number }[] = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const entry = readEntry(file);
    // A live pid is not enough: an extension host outlives the folder it
    // was opened on, and a server whose workspace has been deleted can
    // only serve config that no longer exists. Treat it as dead.
    if (!entry || !isPidAlive(entry.pid) || !fs.existsSync(entry.workspace)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // best effort cleanup
      }
      continue;
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      // keep 0
    }
    alive.push({ entry, mtimeMs });
  }

  if (alive.length === 0) return null;

  // Preferred kind first, so every lookup below picks it when a workspace
  // has both a daemon and an extension serving it.
  alive.sort((a, b) => {
    const aPreferred = (a.entry.kind ?? 'extension') === preferKind ? 0 : 1;
    const bPreferred = (b.entry.kind ?? 'extension') === preferKind ? 0 : 1;
    return aPreferred - bPreferred;
  });

  const hint = workspaceHint ? path.resolve(workspaceHint) : null;
  if (hint) {
    const exact = alive.find(({ entry }) => path.resolve(entry.workspace) === hint);
    if (exact) return exact.entry;
    const parent = alive.find(({ entry }) => workspaceContains(entry.workspace, hint));
    if (parent) return parent.entry;
  }

  if (alive.length === 1) return alive[0].entry;
  // Newest wins, but still only among the preferred kind when one exists —
  // an old daemon still owns its processes, a fresh extension host does not.
  const preferred = alive.filter(({ entry }) => (entry.kind ?? 'extension') === preferKind);
  const pool = preferred.length > 0 ? preferred : alive;
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return pool[0].entry;
}

export function defaultWorkspaceHint(): string {
  return process.env.MUSTER_WORKSPACE || process.cwd() || os.homedir();
}

/**
 * Look up exactly one kind for one workspace — no fuzzy hint-matching, no
 * cross-kind fallback. For `muster daemon start/stop/status`, which need to
 * know specifically "is a daemon (not an extension) already running for
 * this exact workspace", where findDiscovery's leniency would be wrong.
 * A stale (dead-pid) entry is deleted and treated as absent.
 */
export function readExactDiscovery(
  workspaceRoot: string,
  kind: IpcServerKind,
  dir = getDiscoveryDir()
): IpcDiscovery | null {
  const file = discoveryFilePath(workspaceRoot, dir, kind);
  const entry = readEntry(file);
  if (!entry) return null;
  if (!isPidAlive(entry.pid)) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
    return null;
  }
  return entry;
}
