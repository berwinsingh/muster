import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export function getUserConfigDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'muster');
  }
  return path.join(home, '.config', 'muster');
}

/**
 * Where Muster keeps mutable state that is not configuration: log history,
 * daemon bookkeeping. Deliberately separate from the config dir so that
 * blowing away state never takes a user's groups with it.
 *
 * MUSTER_HOME overrides it — used by the tests, and an escape hatch for
 * anyone who keeps $HOME on a small or network-mounted volume.
 */
export function getStateDir(): string {
  const override = process.env.MUSTER_HOME;
  if (override) {
    return override;
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
      'muster'
    );
  }
  return path.join(home, '.muster');
}

export function getLogsDir(): string {
  return path.join(getStateDir(), 'logs');
}

/**
 * Short stable id for a workspace path, used to namespace both the IPC
 * discovery files and the log tree so two projects never collide.
 */
export function workspaceKey(workspaceRoot: string): string {
  const normalized = workspaceRoot || 'no-workspace';
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

export function getUserProfilesPath(): string {
  return path.join(getUserConfigDir(), 'profiles.json');
}

export function getWorkspaceConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.vscode', 'muster.json');
}

export const SCHEMA_RELATIVE_PATH = 'schemas/muster.schema.json';
