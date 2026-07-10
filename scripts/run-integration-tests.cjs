const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(
    extensionDevelopmentPath,
    'src',
    'test',
    'integration',
    'index.cjs'
  );
  const workspacePath = path.resolve(
    extensionDevelopmentPath,
    'src',
    'test',
    'fixtures',
    'smoke-workspace'
  );

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  });
}

main().catch((error) => {
  console.error('DevStack integration tests failed:', error);
  process.exitCode = 1;
});
