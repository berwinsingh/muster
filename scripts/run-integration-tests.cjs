const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(
    extensionDevelopmentPath,
    'src',
    'test',
    'integration',
    'index.js'
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
    extensionTestsEnv: {
      // Route the "install CLI" command's wrappers into a temp dir so the
      // test never touches the real /usr/local/bin or ~/.local/bin.
      MUSTER_CLI_INSTALL_DIR: path.join(os.tmpdir(), `muster-cli-install-${process.pid}`),
    },
    launchArgs: [
      workspacePath,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
}

main().catch((error) => {
  console.error('Muster integration tests failed:', error);
  process.exitCode = 1;
});
