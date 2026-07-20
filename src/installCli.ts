import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  isDirInPath,
  pathExportLine,
  preferredInstallDirs,
  shouldPromptForCliInstall,
  windowsWrapperScript,
  wrapperScript,
} from './cli/installPaths';

const CLI_PROMPTED_KEY = 'muster.cliInstallPrompted';

/** Resolve-only check: does invoking `muster` on PATH work at all? `help`
 * prints and exits immediately without touching the IPC connection, so
 * this never blocks on VS Code being open elsewhere. */
function isCliOnPath(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      // shell is only needed on Windows, to resolve the .cmd wrapper —
      // skip it on POSIX where the args are passed directly (avoids the
      // shell-arg-escaping deprecation warning for no benefit there).
      const child = cp.spawn('muster', ['help'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
      const timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        finish(false);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        // With shell:true, a missing command still fires 'exit' (the shell
        // itself ran fine and reported "not found") rather than 'error' —
        // only a clean code 0 from `muster help` counts as "found".
        finish(code === 0);
      });
    } catch {
      finish(false);
    }
  });
}

/**
 * Offer to install the CLI once, automatically, instead of requiring users
 * to discover the command in the palette — but only when it's actually
 * relevant (a Muster config already exists) and only if it isn't already
 * reachable. Fire-and-forget from activation; never blocks or throws.
 */
export async function maybePromptCliInstall(
  context: vscode.ExtensionContext,
  hasMusterConfig: boolean
): Promise<void> {
  const alreadyPrompted = context.globalState.get<boolean>(CLI_PROMPTED_KEY, false);
  // Cheap, synchronous gate first — skip the process spawn entirely when
  // there's nothing to offer or we've already asked.
  if (alreadyPrompted || !hasMusterConfig) {
    return;
  }

  const cliAlreadyOnPath = await isCliOnPath();
  if (!shouldPromptForCliInstall({ alreadyPrompted, hasMusterConfig, cliAlreadyOnPath })) {
    if (cliAlreadyOnPath) {
      // Nothing to offer — record it so we stop checking on every activation.
      await context.globalState.update(CLI_PROMPTED_KEY, true);
    }
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Muster: install the 'muster' command so you can run and stop your groups from any terminal?",
    'Install',
    "Don't ask again"
  );

  if (choice === 'Install') {
    await installCli(context);
    await context.globalState.update(CLI_PROMPTED_KEY, true);
  } else if (choice === "Don't ask again") {
    await context.globalState.update(CLI_PROMPTED_KEY, true);
  }
  // Dismissed without a choice: leave the flag unset so we ask again next
  // time — a stray Escape shouldn't permanently opt someone out.
}

function isWritableDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) {
      return false;
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install `muster` and `muster-mcp` wrapper scripts onto the user's PATH,
 * mirroring VS Code's own "Install 'code' command in PATH". Writes small
 * shell wrappers (not symlinks) so exec bits and version-suffixed extension
 * directories never matter. MUSTER_CLI_INSTALL_DIR overrides the target
 * (used by the integration tests).
 */
export async function installCli(context: vscode.ExtensionContext): Promise<void> {
  try {
    const launcher = context.asAbsolutePath(path.join('bin', 'muster.cjs'));
    const mcpLauncher = context.asAbsolutePath(path.join('bin', 'muster-mcp.cjs'));

    const override = process.env.MUSTER_CLI_INSTALL_DIR;
    const candidates = override
      ? [override]
      : preferredInstallDirs(process.platform, os.homedir());
    const target =
      candidates.find((dir) => (override ? true : isWritableDir(dir))) ??
      candidates[candidates.length - 1];

    fs.mkdirSync(target, { recursive: true });

    const isWin = process.platform === 'win32';
    const wrappers: Array<[string, string]> = [
      [isWin ? 'muster.cmd' : 'muster', isWin ? windowsWrapperScript(launcher) : wrapperScript(launcher)],
      [isWin ? 'muster-mcp.cmd' : 'muster-mcp', isWin ? windowsWrapperScript(mcpLauncher) : wrapperScript(mcpLauncher)],
    ];
    for (const [name, content] of wrappers) {
      const file = path.join(target, name);
      fs.writeFileSync(file, content);
      if (!isWin) {
        fs.chmodSync(file, 0o755);
      }
    }

    if (isDirInPath(target, process.env.PATH ?? '', process.platform)) {
      vscode.window.showInformationMessage(
        `Muster: installed 'muster' and 'muster-mcp' in ${target}. Open a new terminal and run 'muster'.`
      );
      return;
    }

    const line = pathExportLine(target, process.platform);
    const profile = process.platform === 'win32' ? 'a new terminal' : '~/.zshrc or ~/.bashrc';
    const choice = await vscode.window.showInformationMessage(
      `Muster: installed in ${target}, which is not on your PATH. Add this line to ${profile}: ${line}`,
      'Copy PATH line'
    );
    if (choice === 'Copy PATH line') {
      await vscode.env.clipboard.writeText(line);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Muster: could not install the CLI — ${String(err)}`);
  }
}
