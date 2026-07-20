import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
  isDirInPath,
  pathExportLine,
  preferredInstallDirs,
  shouldPromptForCliInstall,
  windowsWrapperScript,
  wrapperScript,
} from '../cli/installPaths';

describe('cli install paths', () => {
  test('posix wrapper execs node with the launcher and forwards args', () => {
    const script = wrapperScript('/ext/bin/muster.cjs');
    assert.ok(script.startsWith('#!/bin/sh\n'));
    assert.ok(script.includes('exec node "/ext/bin/muster.cjs" "$@"'));
  });

  test('windows wrapper forwards args with %*', () => {
    const script = windowsWrapperScript('C:\\ext\\bin\\muster.cjs');
    assert.ok(script.includes('node "C:\\ext\\bin\\muster.cjs" %*'));
  });

  test('preferred dirs: /usr/local/bin first on posix, home bin on windows', () => {
    assert.deepEqual(preferredInstallDirs('linux', '/home/dev'), [
      '/usr/local/bin',
      '/home/dev/.local/bin',
    ]);
    assert.deepEqual(preferredInstallDirs('win32', 'C:\\Users\\dev'), [
      'C:\\Users\\dev\\.muster\\bin',
    ]);
  });

  test('PATH membership handles trailing slashes and empty entries', () => {
    assert.equal(isDirInPath('/usr/local/bin', '/usr/bin:/usr/local/bin/', 'linux'), true);
    assert.equal(isDirInPath('/usr/local/bin', '/usr/bin::/opt/bin', 'linux'), false);
  });

  test('path export line matches the platform shell', () => {
    assert.equal(
      pathExportLine('/home/dev/.local/bin', 'linux'),
      'export PATH="/home/dev/.local/bin:$PATH"'
    );
    assert.ok(pathExportLine('C:\\Users\\dev\\.muster\\bin', 'win32').startsWith('setx PATH'));
  });
});

describe('auto-prompt decision', () => {
  test('prompts only when unasked, configured, and not already on PATH', () => {
    assert.equal(
      shouldPromptForCliInstall({
        alreadyPrompted: false,
        hasMusterConfig: true,
        cliAlreadyOnPath: false,
      }),
      true
    );
  });

  test('never re-prompts once asked', () => {
    assert.equal(
      shouldPromptForCliInstall({
        alreadyPrompted: true,
        hasMusterConfig: true,
        cliAlreadyOnPath: false,
      }),
      false
    );
  });

  test('stays silent for workspaces with no Muster config', () => {
    assert.equal(
      shouldPromptForCliInstall({
        alreadyPrompted: false,
        hasMusterConfig: false,
        cliAlreadyOnPath: false,
      }),
      false
    );
  });

  test('does not prompt when the CLI is already reachable', () => {
    assert.equal(
      shouldPromptForCliInstall({
        alreadyPrompted: false,
        hasMusterConfig: true,
        cliAlreadyOnPath: true,
      }),
      false
    );
  });
});
