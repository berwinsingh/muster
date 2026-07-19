import * as os from 'os';
import * as path from 'path';

export function getUserConfigDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'muster');
  }
  return path.join(home, '.config', 'muster');
}

export function getUserProfilesPath(): string {
  return path.join(getUserConfigDir(), 'profiles.json');
}

export function getWorkspaceConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.vscode', 'muster.json');
}

export const SCHEMA_RELATIVE_PATH = 'schemas/muster.schema.json';
