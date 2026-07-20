/**
 * Pure helpers for installing the `muster` command on PATH: wrapper script
 * contents, candidate install directories, and PATH membership checks.
 * The vscode-facing command lives in src/installCli.ts.
 */
import * as path from 'path';

export function wrapperScript(launcherPath: string): string {
  return `#!/bin/sh\nexec node "${launcherPath}" "$@"\n`;
}

export function windowsWrapperScript(launcherPath: string): string {
  return `@echo off\r\nnode "${launcherPath}" %*\r\n`;
}

/**
 * Preferred install locations, best first. Joins with the separator for the
 * given `platform`, not the host running this code — path.join always uses
 * the host's separator, so it can't be used here (this function must return
 * Windows-style paths when called with 'win32' while running on Linux CI).
 */
export function preferredInstallDirs(platform: NodeJS.Platform, homedir: string): string[] {
  if (platform === 'win32') {
    return [`${homedir.replace(/\/+$/, '')}\\.muster\\bin`];
  }
  // /usr/local/bin is on the default PATH everywhere; ~/.local/bin is the
  // no-sudo fallback (often on PATH on Linux, usually not on macOS).
  return ['/usr/local/bin', `${homedir.replace(/\/+$/, '')}/.local/bin`];
}

export function isDirInPath(dir: string, pathEnv: string, platform: NodeJS.Platform): boolean {
  const sep = platform === 'win32' ? ';' : ':';
  const normalize = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '');
  return pathEnv
    .split(sep)
    .filter(Boolean)
    .map(normalize)
    .includes(normalize(dir));
}

export function pathExportLine(dir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `setx PATH "%PATH%;${dir}"`;
  }
  return `export PATH="${dir}:$PATH"`;
}

/**
 * Decide whether to surface the one-time "install the CLI" prompt.
 * Pure so the branching is unit-testable without spawning processes or
 * touching vscode.window: only prompt when the workspace actually uses
 * Muster (no point offering a CLI for groups that don't exist yet), the
 * command isn't already reachable, and we haven't asked before.
 */
export function shouldPromptForCliInstall(state: {
  alreadyPrompted: boolean;
  hasMusterConfig: boolean;
  cliAlreadyOnPath: boolean;
}): boolean {
  return !state.alreadyPrompted && state.hasMusterConfig && !state.cliAlreadyOnPath;
}
