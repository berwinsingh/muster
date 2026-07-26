import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

const REPO = path.join(__dirname, '..', '..');
const LAUNCHER = path.join(REPO, 'bin', 'muster.cjs');

/**
 * A checkout-shaped directory with its own bin/, dist/ and package.json.
 * Tests must not lean on the repo's own dist/ — CI runs `npm test` before
 * `npm run compile`, so it isn't built yet and the launcher would (rightly)
 * refuse to resolve anything.
 */
function fakeInstall(opts: { withSrc?: boolean; version?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-launcher-'));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.copyFileSync(LAUNCHER, path.join(dir, 'bin', 'muster.cjs'));
  fs.writeFileSync(path.join(dir, 'dist', 'cli.js'), 'process.exit(0);\n');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'muster', version: opts.version ?? '9.9.9' })
  );
  if (opts.withSrc) fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

function runIn(dir: string, args: string[] = []): { stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [path.join(dir, 'bin', 'muster.cjs'), ...args], {
    encoding: 'utf-8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('muster launcher', () => {
  test('--version reports the version and the exact file it resolved', () => {
    // "Which copy am I running?" is the question a stale build makes urgent,
    // so the path matters as much as the number.
    const dir = fakeInstall({ version: '1.2.3' });
    try {
      const { stdout } = runIn(dir, ['--version']);
      assert.match(stdout, /^muster 1\.2\.3$/m);
      assert.match(stdout, /dist[/\\]cli\.js/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports a clear error when no compiled CLI can be found', () => {
    // The state CI is actually in before `npm run compile` runs.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-nodist-'));
    try {
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      fs.copyFileSync(LAUNCHER, path.join(dir, 'bin', 'muster.cjs'));
      // HOME is redirected so a real extension install on the machine
      // running the tests can't satisfy the lookup and mask this.
      const r = spawnSync(process.execPath, [path.join(dir, 'bin', 'muster.cjs')], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: dir, USERPROFILE: dir },
      });
      assert.match(r.stderr ?? '', /could not find the compiled CLI/);
      assert.notEqual(r.status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('searches the remote/WSL extension directories too', () => {
    // On WSL, Remote-SSH, devcontainers and Codespaces the editor installs
    // into ~/.vscode-server/extensions; omitting it made the CLI unfindable
    // in exactly the setups where a terminal-first tool matters most.
    const source = fs.readFileSync(LAUNCHER, 'utf-8');
    for (const dir of [
      '.vscode',
      '.vscode-server',
      '.vscode-insiders',
      '.vscode-server-insiders',
      '.cursor',
      '.cursor-server',
      '.windsurf',
      '.windsurf-server',
    ]) {
      assert.ok(source.includes(`'${dir}'`), `launcher should search ~/${dir}/extensions`);
    }
  });

  test('the MCP launcher searches the same directories', () => {
    const source = fs.readFileSync(path.join(REPO, 'bin', 'muster-mcp.cjs'), 'utf-8');
    assert.ok(source.includes("'.vscode-server'"));
    assert.ok(source.includes("'.cursor-server'"));
  });

  test('warns when the built CLI is older than the source', () => {
    // dist/ is git-ignored, so `git pull` refreshes source and leaves the
    // binary stale — silently running old code. Reproduced by backdating a
    // copy of the build in a throwaway checkout-shaped directory.
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-stale-'));
    try {
      fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(fake, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(fake, 'src'), { recursive: true });
      fs.copyFileSync(LAUNCHER, path.join(fake, 'bin', 'muster.cjs'));
      // A CLI that exits immediately, so the test asserts on the warning only.
      fs.writeFileSync(path.join(fake, 'dist', 'cli.js'), 'process.exit(0);\n');
      fs.writeFileSync(path.join(fake, 'src', 'thing.ts'), 'export const x = 1;\n');

      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(path.join(fake, 'dist', 'cli.js'), old, old);

      const stderr = spawnSync(process.execPath, [path.join(fake, 'bin', 'muster.cjs')], {
        encoding: 'utf-8',
      }).stderr;
      assert.match(stderr, /stale code/);
      assert.match(stderr, /npm run compile/);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  test('stays quiet when the build is newer than the source', () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-fresh-'));
    try {
      fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(fake, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(fake, 'src'), { recursive: true });
      fs.copyFileSync(LAUNCHER, path.join(fake, 'bin', 'muster.cjs'));
      fs.writeFileSync(path.join(fake, 'src', 'thing.ts'), 'export const x = 1;\n');
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(path.join(fake, 'src', 'thing.ts'), old, old);
      fs.writeFileSync(path.join(fake, 'dist', 'cli.js'), 'process.exit(0);\n');

      const stderr = spawnSync(process.execPath, [path.join(fake, 'bin', 'muster.cjs')], {
        encoding: 'utf-8',
      }).stderr;
      assert.doesNotMatch(stderr, /stale/);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  test('a packaged install with no src/ never warns about staleness', () => {
    // An npm/extension install has no source tree to compare against; the
    // check must not fire (or crash) there.
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-packaged-'));
    try {
      fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(fake, 'dist'), { recursive: true });
      fs.copyFileSync(LAUNCHER, path.join(fake, 'bin', 'muster.cjs'));
      fs.writeFileSync(path.join(fake, 'dist', 'cli.js'), 'process.exit(0);\n');
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(path.join(fake, 'dist', 'cli.js'), old, old);

      const stderr = spawnSync(process.execPath, [path.join(fake, 'bin', 'muster.cjs')], {
        encoding: 'utf-8',
      }).stderr;
      assert.doesNotMatch(stderr, /stale/);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });
});
