import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getUserConfigDir } from '../config/paths';

export type IpcDiscovery = {
  port: number;
  workspace: string;
  pid: number;
};

export function getDiscoveryDir(): string {
  return path.join(getUserConfigDir(), 'ipc');
}

function workspaceKey(workspaceRoot: string): string {
  const normalized = workspaceRoot || 'no-workspace';
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

export function discoveryFilePath(workspaceRoot: string, dir = getDiscoveryDir()): string {
  return path.join(dir, `${workspaceKey(workspaceRoot)}.json`);
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
  const file = discoveryFilePath(entry.workspace, dir);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf-8');
  return file;
}

export function removeDiscoveryFile(workspaceRoot: string, dir = getDiscoveryDir()): void {
  try {
    fs.unlinkSync(discoveryFilePath(workspaceRoot, dir));
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
    return raw as IpcDiscovery;
  } catch {
    return null;
  }
}

/**
 * Find a live IPC endpoint written by a running Muster extension host.
 * Preference order: exact workspace match, then a workspace that is a parent
 * of `workspaceHint`, then the only live entry, then the most recent one.
 * Stale entries (dead pid or unparsable) are deleted as they are seen.
 */
export function findDiscovery(
  workspaceHint: string | null,
  dir = getDiscoveryDir()
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
    if (!entry || !isPidAlive(entry.pid)) {
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

  const hint = workspaceHint ? path.resolve(workspaceHint) : null;
  if (hint) {
    const exact = alive.find(({ entry }) => path.resolve(entry.workspace) === hint);
    if (exact) return exact.entry;
    const parent = alive.find(
      ({ entry }) =>
        entry.workspace && hint.startsWith(path.resolve(entry.workspace) + path.sep)
    );
    if (parent) return parent.entry;
  }

  if (alive.length === 1) return alive[0].entry;
  alive.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return alive[0].entry;
}

export function defaultWorkspaceHint(): string {
  return process.env.MUSTER_WORKSPACE || process.cwd() || os.homedir();
}
