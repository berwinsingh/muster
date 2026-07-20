/**
 * Assembles packages/muster-cli/ from the built extension artifacts:
 * the launcher scripts and the two compiled bundles they need
 * (dist/cli.js, dist/mcp/server.js — not dist/extension.js, which is
 * VS-Code-extension-only and irrelevant to a standalone CLI install).
 *
 * Run `npm run compile` first (npm run build:npm-package does this).
 * Output is git-ignored: regenerated fresh before every pack/publish so
 * there is exactly one source of truth (root bin/ and dist/), never two
 * drifting copies.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkgDir = join(root, 'packages', 'muster-cli');

const required = [
  join(root, 'dist', 'cli.js'),
  join(root, 'dist', 'mcp', 'server.js'),
  join(root, 'bin', 'muster.cjs'),
  join(root, 'bin', 'muster-mcp.cjs'),
];
const missing = required.filter((p) => !existsSync(p));
if (missing.length > 0) {
  console.error('[build-npm-package] missing built artifacts, run `npm run compile` first:');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

mkdirSync(join(pkgDir, 'bin'), { recursive: true });
mkdirSync(join(pkgDir, 'dist', 'mcp'), { recursive: true });

copyFileSync(join(root, 'bin', 'muster.cjs'), join(pkgDir, 'bin', 'muster.cjs'));
copyFileSync(join(root, 'bin', 'muster-mcp.cjs'), join(pkgDir, 'bin', 'muster-mcp.cjs'));
copyFileSync(join(root, 'dist', 'cli.js'), join(pkgDir, 'dist', 'cli.js'));
copyFileSync(join(root, 'dist', 'cli.js.map'), join(pkgDir, 'dist', 'cli.js.map'));
copyFileSync(join(root, 'dist', 'mcp', 'server.js'), join(pkgDir, 'dist', 'mcp', 'server.js'));
copyFileSync(join(root, 'dist', 'mcp', 'server.js.map'), join(pkgDir, 'dist', 'mcp', 'server.js.map'));

// Keep the published version in lockstep with the extension — one number
// to bump (root package.json), not two that can drift out of sync.
const rootVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version;
const pkgJsonPath = join(pkgDir, 'package.json');
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
pkgJson.version = rootVersion;
writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');

console.log(`[build-npm-package] packages/muster-cli ready at version ${rootVersion}`);
