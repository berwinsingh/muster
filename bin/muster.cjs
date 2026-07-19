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

function resolveCli() {
  const local = path.join(__dirname, '..', 'dist', 'cli.js');
  if (fs.existsSync(local)) {
    return local;
  }
  const home = os.homedir();
  for (const root of [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.windsurf', 'extensions'),
  ]) {
    const found = findInExtensionsDir(root);
    if (found) return found;
  }
  return null;
}

const cliPath = resolveCli();
if (!cliPath) {
  process.stderr.write(
    'muster: could not find the compiled CLI.\n' +
      'Install the Muster VS Code extension, or build from source (npm install && npm run compile).\n'
  );
  process.exit(1);
}

require(cliPath);
