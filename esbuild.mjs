import * as esbuild from 'esbuild';
import { readdirSync } from 'fs';
import { join } from 'path';

const watch = process.argv.includes('--watch');
const testOnly = process.argv.includes('--test');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  external: ['vscode'],
};

function findTestEntries() {
  const testDir = join(process.cwd(), 'src', 'test');
  try {
    return readdirSync(testDir)
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => join('src', 'test', file));
  } catch {
    return [];
  }
}

async function buildTests() {
  const entryPoints = findTestEntries();
  if (!entryPoints.length) {
    console.log('[devstack] no test files found');
    return;
  }

  const testCtx = await esbuild.context({
    ...common,
    entryPoints,
    outdir: 'dist-test',
    format: 'cjs',
    outbase: 'src',
  });

  await testCtx.rebuild();
  await testCtx.dispose();
  console.log('[devstack] test build complete');
}

if (testOnly) {
  await buildTests();
} else {
  const extensionCtx = await esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    format: 'cjs',
  });

  const mcpCtx = await esbuild.context({
    ...common,
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'dist/mcp/server.js',
    format: 'cjs',
    external: ['vscode'],
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), mcpCtx.watch()]);
    console.log('[devstack] watching...');
  } else {
    await Promise.all([extensionCtx.rebuild(), mcpCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), mcpCtx.dispose()]);
    console.log('[devstack] build complete');
  }
}
