import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  external: ['vscode'],
};

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
