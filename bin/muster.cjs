#!/usr/bin/env node
/**
 * Launcher for the muster CLI. Finds the compiled dist/cli.js in a repo
 * checkout (after a build) or in the newest installed Muster VS Code /
 * Cursor extension, mirroring bin/muster-mcp.cjs.
 *
 * Tip: `npm link` in a repo checkout puts `muster` on your PATH.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function findInExtensionsDir(extensionsDir) {
  let entries;
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((name) => name.startsWith('muster.muster-'))
    .map((name) => path.join(extensionsDir, name, 'dist', 'cli.js'))
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates.length > 0 ? candidates[0].p : null;
}

/**
 * Every place a VS Code-family editor keeps extensions. The `*-server`
 * directories are where extensions land when the editor's UI runs on the
 * host and the workspace lives elsewhere — WSL, Remote-SSH, devcontainers,
 * Codespaces. Omitting them made the CLI unfindable in exactly the setup
 * where you most want a terminal-first tool.
 */
function extensionRoots() {
  const home = os.homedir();
  return [
    '.vscode',
    '.vscode-server',
    '.vscode-insiders',
    '.vscode-server-insiders',
    '.cursor',
    '.cursor-server',
    '.windsurf',
    '.windsurf-server',
  ].map((dir) => path.join(home, dir, 'extensions'));
}

/**
 * Newest mtime under a directory tree, ignoring anything that isn't a file
 * we'd compile. Used only for the staleness check below, so it stays cheap
 * and gives up quietly rather than ever blocking a run.
 */
function newestSourceMtime(dir, deadline) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    if (Date.now() > deadline) return newest;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full, deadline));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.cjs')) {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        // vanished mid-scan; ignore
      }
    }
  }
  return newest;
}

/**
 * In a repo checkout, `dist/` is git-ignored — so `git pull` updates the
 * source while leaving the binary you actually run untouched. That silently
 * executes old code, which is a genuinely baffling way to lose an afternoon:
 * the fix is in the tree, the bug is still in front of you. Say so.
 */
function warnIfStale(cliPath, repoRoot) {
  try {
    const built = fs.statSync(cliPath).mtimeMs;
    // A second of slack so a build that races the last edit isn't flagged.
    const newest = newestSourceMtime(path.join(repoRoot, 'src'), Date.now() + 300);
    if (newest > built + 1000) {
      process.stderr.write(
        'muster: this build is older than the source in ' +
          `${repoRoot}.\n` +
          '        You are running stale code — rebuild with: npm run compile\n\n'
      );
    }
  } catch {
    // Staleness detection is a courtesy; never let it stop the CLI.
  }
}

/**
 * `npm link` in a checkout puts this launcher on PATH whether or not the
 * checkout has been built. With no dist/ we fall through to the installed
 * extension — so you edit one tree and run a different one, and every
 * change you make appears to do nothing. The stale check below covers the
 * built-but-old case; this covers the never-built one, which is worse
 * because there is no version difference to notice.
 */
function warnUnbuiltCheckout(repoRoot, running) {
  process.stderr.write(
    `muster: ${repoRoot} has no dist/, so this is NOT your checkout:\n` +
      `        ${running}\n` +
      '        That is the installed extension\'s CLI. To run your own tree:\n' +
      '        npm run compile\n\n'
  );
}

/** WSL keeps Linux extensions apart from the Windows ones; see below. */
function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf-8'));
  } catch {
    return false;
  }
}

function resolveCli() {
  const repoRoot = path.join(__dirname, '..');
  const local = path.join(repoRoot, 'dist', 'cli.js');
  // Only meaningful for a checkout, where src/ sits next to dist/.
  const isCheckout = fs.existsSync(path.join(repoRoot, 'src'));
  if (fs.existsSync(local)) {
    if (isCheckout) warnIfStale(local, repoRoot);
    return local;
  }
  for (const root of extensionRoots()) {
    const found = findInExtensionsDir(root);
    if (found) {
      if (isCheckout) warnUnbuiltCheckout(repoRoot, found);
      return found;
    }
  }
  return null;
}

const cliPath = resolveCli();
if (!cliPath) {
  process.stderr.write(
    'muster: could not find the compiled CLI.\n' +
      'Install the Muster VS Code extension, or build from source (npm install && npm run compile).\n'
  );
  // An extension installed on the Windows side lives under the Windows
  // profile, which is a different filesystem from this one — the install
  // reports success and the Linux CLI still sees nothing. Naming that is
  // the difference between a two-minute fix and an afternoon.
  if (isWsl()) {
    process.stderr.write(
      '\nYou are on WSL. An extension installed on the Windows side is not\n' +
        'visible here — Linux extensions live in ~/.vscode-server/extensions.\n' +
        'In the Extensions view, use "Install in WSL", or build from source\n' +
        'inside WSL.\n'
    );
  }
  process.exit(1);
}

// `muster --version` has to answer "which copy am I actually running?" —
// the version alone is not enough when a stale build is the usual culprit.
if (process.argv[2] === '--version' || process.argv[2] === '-v') {
  let version = 'unknown';
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(cliPath, '..', '..', 'package.json'), 'utf-8')
    ).version;
  } catch {
    // packaged without a manifest; the path below is still the useful part
  }
  process.stdout.write(`muster ${version}\n${cliPath}\n`);
  process.exit(0);
}

require(cliPath);
