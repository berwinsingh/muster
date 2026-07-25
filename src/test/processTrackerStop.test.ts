import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProcessTracker, RESTART_DIVIDER } from '../orchestration/processTracker';

/**
 * Fakes for the two things stopService touches: a VS Code terminal (we only
 * care whether it was disposed and what was sent to it) and a child process
 * (whether it was signalled).
 */
function fakeTerminal() {
  const sent: string[] = [];
  let disposed = false;
  return {
    handle: {
      sendText: (text: string, _newline?: boolean) => sent.push(text),
      dispose: () => {
        disposed = true;
      },
    } as unknown as import('vscode').Terminal,
    sent,
    get disposed() {
      return disposed;
    },
  };
}

function fakeChild() {
  const signals: string[] = [];
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  return {
    handle: {
      killed: false,
      kill(signal?: string) {
        signals.push(signal ?? 'SIGTERM');
        (this as { killed: boolean }).killed = true;
        return true;
      },
      once(event: string, cb: (...a: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
        return this;
      },
    } as unknown as import('child_process').ChildProcess,
    signals,
  };
}

const CTRL_C = String.fromCharCode(3);

describe('stopService keeps terminals unless forced', () => {
  it('a plain stop interrupts the process but keeps the terminal and scrollback', async () => {
    const tracker = new ProcessTracker();
    const term = fakeTerminal();
    tracker.trackTerminal('g', 'web', term.handle, 'running');
    tracker.appendOutput('g', 'web', 'Error: boom\n');

    await tracker.stopService('g', 'web');

    assert.equal(term.disposed, false, 'terminal must stay open on a plain stop');
    assert.deepEqual(term.sent, [CTRL_C], 'a Ctrl-C should interrupt the running command');
    // The scrollback the user was reading is still queryable.
    assert.deepEqual(tracker.getRecentOutput('g', 'web'), ['Error: boom']);
    assert.equal(tracker.getService('g', 'web')?.status, 'stopped');
  });

  it('a force stop disposes the terminal and forgets the service', async () => {
    const tracker = new ProcessTracker();
    const term = fakeTerminal();
    tracker.trackTerminal('g', 'web', term.handle, 'running');
    tracker.appendOutput('g', 'web', 'line\n');

    await tracker.stopService('g', 'web', { force: true });

    assert.equal(term.disposed, true, 'force must dispose the terminal');
    assert.equal(tracker.getService('g', 'web'), undefined, 'force must forget the service');
  });

  it('SIGTERMs an aggregated child process without disposing the shared terminal', async () => {
    const tracker = new ProcessTracker();
    const child = fakeChild();
    tracker.trackPseudoterminal('g', 'api', { dispose: () => undefined }, child.handle, 'running');

    await tracker.stopService('g', 'api');

    assert.deepEqual(child.signals, ['SIGTERM']);
    assert.equal(tracker.getService('g', 'api')?.status, 'stopped');
  });

  it('a deliberate stop reports stopped, not failed, even on a non-zero exit', async () => {
    // Reproduces the "Ctrl-C looks like a crash" trap: an interrupted
    // process exits 130, but the user asked for it — status must be stopped.
    const tracker = new ProcessTracker();
    const term = fakeTerminal();
    const tracked = tracker.trackTerminal('g', 'web', term.handle, 'running');
    await tracker.stopService('g', 'web');
    assert.equal(tracked.expectStop, true);
    assert.equal(tracked.status, 'stopped');
  });
});

describe('restart preserves scrollback', () => {
  it('carries the previous run buffer into the new terminal with a divider', () => {
    const tracker = new ProcessTracker();
    const first = fakeTerminal();
    tracker.trackTerminal('g', 'web', first.handle, 'running');
    tracker.appendOutput('g', 'web', 'run 1 line A\nrun 1 line B\n');

    // Restarting re-tracks the same service with a fresh terminal.
    const second = fakeTerminal();
    tracker.trackTerminal('g', 'web', second.handle, 'starting');
    tracker.appendOutput('g', 'web', 'run 2 line\n');

    assert.deepEqual(tracker.getRecentOutput('g', 'web'), [
      'run 1 line A',
      'run 1 line B',
      RESTART_DIVIDER,
      'run 2 line',
    ]);
  });

  it('does not carry a buffer forward after a force stop cleared it', async () => {
    const tracker = new ProcessTracker();
    const first = fakeTerminal();
    tracker.trackTerminal('g', 'web', first.handle, 'running');
    tracker.appendOutput('g', 'web', 'old run\n');
    await tracker.stopService('g', 'web', { force: true });

    const second = fakeTerminal();
    tracker.trackTerminal('g', 'web', second.handle, 'starting');
    tracker.appendOutput('g', 'web', 'fresh run\n');

    // No divider, no old lines — force is the way to start clean.
    assert.deepEqual(tracker.getRecentOutput('g', 'web'), ['fresh run']);
  });
});

describe('group terminal ownership', () => {
  it('disposes a registered group terminal on clearGroup', () => {
    const tracker = new ProcessTracker();
    const shared = fakeTerminal();
    tracker.registerGroupTerminal('agg', shared.handle);
    tracker.clearGroup('agg', []);
    assert.equal(shared.disposed, true);
  });

  it('disposeGroupTerminal is idempotent', () => {
    const tracker = new ProcessTracker();
    const shared = fakeTerminal();
    tracker.registerGroupTerminal('agg', shared.handle);
    tracker.disposeGroupTerminal('agg');
    assert.doesNotThrow(() => tracker.disposeGroupTerminal('agg'));
  });
});
