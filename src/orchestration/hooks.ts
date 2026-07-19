import * as cp from 'child_process';

export type HookNarrator = (line: string) => void;

const HOOK_TIMEOUT_MS = 120_000;

function runOne(command: string, cwd: string | undefined): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32' ? ['/c', command] : ['-lc', command];
    const child = cp.spawn(shell, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: -1, stderr: `timed out after ${HOOK_TIMEOUT_MS / 1000}s` });
    }, HOOK_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: String(err) });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/**
 * Run lifecycle hook commands sequentially (VPN connect, docker compose up,
 * database migrations, …). Each command runs in a login shell in `cwd`;
 * a non-zero exit or timeout throws, identifying the failed command.
 * Hooks are user-authored config — they never come from agents, whose MCP
 * surface stays limited to the scoped group tools.
 */
export async function runHooks(
  kind: 'preRun' | 'postStop',
  commands: string[],
  cwd: string | undefined,
  narrate: HookNarrator
): Promise<void> {
  for (const command of commands) {
    narrate(`${kind}: ${command}`);
    const { code, stderr } = await runOne(command, cwd);
    if (code !== 0) {
      const detail = stderr.trim().split('\n').slice(-3).join(' · ');
      throw new Error(
        `${kind} hook failed (exit ${code}): ${command}${detail ? ` — ${detail}` : ''}`
      );
    }
  }
}
