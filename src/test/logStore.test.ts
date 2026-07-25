import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  LogStore,
  describeRetention,
  parseLines,
  parseRetention,
} from '../logs/store';

let tmp: string;

function makeStore(overrides: Partial<ConstructorParameters<typeof LogStore>[0]> = {}) {
  return new LogStore({
    workspaceRoot: '/fake/workspace',
    baseDir: tmp,
    flushMs: 5,
    ...overrides,
  });
}

describe('log retention parsing', () => {
  it('parses duration windows in every supported unit', () => {
    assert.deepEqual(parseRetention('7d'), { ms: 7 * 24 * 60 * 60 * 1000 });
    assert.deepEqual(parseRetention('48h'), { ms: 48 * 60 * 60 * 1000 });
    assert.deepEqual(parseRetention('90m'), { ms: 90 * 60 * 1000 });
    assert.deepEqual(parseRetention('30s'), { ms: 30 * 1000 });
    assert.deepEqual(parseRetention('2w'), { ms: 14 * 24 * 60 * 60 * 1000 });
  });

  it('is case and whitespace insensitive', () => {
    assert.deepEqual(parseRetention('  7D '), { ms: 7 * 24 * 60 * 60 * 1000 });
    assert.deepEqual(parseRetention('48 H'), { ms: 48 * 60 * 60 * 1000 });
  });

  it('treats the opt-out spellings as keep-forever', () => {
    for (const raw of ['none', 'off', 'forever', 'never', 'NONE']) {
      assert.deepEqual(parseRetention(raw), { ms: null }, raw);
    }
  });

  it('treats a zero window as keep-forever, not delete-everything', () => {
    // A literal 0ms window would make every line older than itself the
    // instant it was written. Keeping forever is the safe reading.
    assert.deepEqual(parseRetention('0d'), { ms: null });
  });

  it('returns null for unset and for unparseable values so callers can complain', () => {
    assert.equal(parseRetention(undefined), null);
    assert.equal(parseRetention(''), null);
    assert.equal(parseRetention('soon'), null);
    assert.equal(parseRetention('7 days'), null);
    assert.equal(parseRetention('d7'), null);
    assert.equal(parseRetention('-3d'), null);
  });

  it('round-trips through a human description', () => {
    assert.equal(describeRetention({ ms: 7 * 24 * 60 * 60 * 1000 }), '7d');
    assert.equal(describeRetention({ ms: 48 * 60 * 60 * 1000 }), '2d');
    assert.equal(describeRetention({ ms: 90 * 60 * 1000 }), '90m');
    assert.equal(describeRetention({ ms: null }), 'kept until manually cleared');
  });
});

describe('log store persistence', () => {
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-logstore-'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes lines and reads them back in order', () => {
    const store = makeStore();
    store.append('api', 'web', ['first', 'second', 'third']);
    const read = store.read('api', 'web');
    assert.deepEqual(
      read.map((entry) => entry.line),
      ['first', 'second', 'third']
    );
    store.dispose();
  });

  it('survives the writing process going away, which is the whole point', () => {
    const writer = makeStore();
    writer.append('api', 'crashy', ['about to die', 'Error: boom']);
    writer.dispose();

    // A completely separate store instance — stands in for a new CLI
    // invocation after the one that produced the logs has exited.
    const reader = makeStore();
    assert.deepEqual(
      reader.read('api', 'crashy').map((e) => e.line),
      ['about to die', 'Error: boom']
    );
    reader.dispose();
  });

  it('keeps history across a restart instead of clearing it', () => {
    const store = makeStore();
    store.append('api', 'restarted', ['run 1 line']);
    store.append('api', 'restarted', ['— restarted —', 'run 2 line']);
    assert.deepEqual(
      store.read('api', 'restarted').map((e) => e.line),
      ['run 1 line', '— restarted —', 'run 2 line']
    );
    store.dispose();
  });

  it('honours a line limit, returning the most recent lines', () => {
    const store = makeStore();
    store.append('api', 'chatty', ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(
      store.read('api', 'chatty', { lines: 2 }).map((e) => e.line),
      ['d', 'e']
    );
    store.dispose();
  });

  it('filters by timestamp for --since', () => {
    let clock = 1_000_000;
    const store = makeStore({ now: () => clock });
    store.append('api', 'timed', ['old line']);
    clock += 60_000;
    store.append('api', 'timed', ['new line']);

    const recent = store.read('api', 'timed', { since: 1_000_000 + 30_000 });
    assert.deepEqual(
      recent.map((e) => e.line),
      ['new line']
    );
    store.dispose();
  });

  it('preserves tabs and ANSI codes inside a log line', () => {
    const store = makeStore();
    const line = '[31mERROR[0m\tcolumn\tseparated';
    store.append('api', 'tabs', [line]);
    assert.deepEqual(
      store.read('api', 'tabs').map((e) => e.line),
      [line]
    );
    store.dispose();
  });

  it('rotates without destroying earlier generations', () => {
    // pm2-logrotate#135: rotation that overwrites history is worse than no
    // rotation at all. Every line written must still be readable after.
    const store = makeStore({ maxBytes: 400, maxGenerations: 3 });
    const written: string[] = [];
    for (let i = 0; i < 60; i++) {
      const line = `line ${i} padded out to force several rotations`;
      written.push(line);
      store.append('api', 'rotating', [line]);
      store.flush();
    }
    const readBack = store.read('api', 'rotating', { lines: 1000 }).map((e) => e.line);
    const tail = written.slice(-readBack.length);
    // The retained lines must be an unbroken tail of what was written — no
    // gaps, no corruption at a generation boundary.
    assert.deepEqual(readBack, tail);
    // And rotation must retain more than the single live generation, i.e.
    // history genuinely spans rotated files rather than starting fresh.
    assert.ok(
      readBack.length > 12,
      `expected rotation to retain multiple generations, got ${readBack.length}`
    );
    store.dispose();
  });

  it('prunes only what is older than the retention window', () => {
    const store = makeStore();
    store.append('api', 'keep', ['recent']);
    store.append('api', 'drop', ['ancient']);
    store.flush();

    // Backdate one file past the window; leave the other alone.
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(store.logFile('api', 'drop'), old, old);

    const removed = store.prune({ ms: 7 * 24 * 60 * 60 * 1000 });
    assert.equal(removed, 1);
    assert.equal(store.has('api', 'drop'), false);
    assert.deepEqual(
      store.read('api', 'keep').map((e) => e.line),
      ['recent']
    );
    store.dispose();
  });

  it('never prunes when retention is keep-forever', () => {
    const store = makeStore();
    store.append('api', 'immortal', ['ancient']);
    store.flush();
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    fs.utimesSync(store.logFile('api', 'immortal'), old, old);

    assert.equal(store.prune({ ms: null }), 0);
    assert.equal(store.has('api', 'immortal'), true);
    store.dispose();
  });

  it('clears one service without touching its siblings', () => {
    const store = makeStore();
    store.append('two', 'a', ['from a']);
    store.append('two', 'b', ['from b']);
    store.flush();

    store.clear('two', 'a');
    assert.equal(store.has('two', 'a'), false);
    assert.deepEqual(
      store.read('two', 'b').map((e) => e.line),
      ['from b']
    );
    store.dispose();
  });

  it('refuses to let a hand-edited id escape the log directory', () => {
    const store = makeStore();
    store.append('../../../etc', 'passwd', ['nope']);
    store.flush();
    const written = store.logFile('../../../etc', 'passwd');
    assert.ok(
      path.resolve(written).startsWith(path.resolve(tmp)),
      `log path escaped the store root: ${written}`
    );
    store.dispose();
  });

  it('reports empty history rather than throwing for an unknown service', () => {
    const store = makeStore();
    assert.deepEqual(store.read('nope', 'nothing'), []);
    assert.equal(store.has('nope', 'nothing'), false);
    store.dispose();
  });

  it('keeps unparseable lines instead of dropping them', () => {
    // A truncated or hand-edited file should still show its content.
    const parsed = parseLines('2026-07-25T09:00:00.000Z\tgood line\nmangled line\n');
    assert.deepEqual(
      parsed.map((e) => e.line),
      ['good line', 'mangled line']
    );
    assert.equal(parsed[1].timestamp, 0);
  });

  it('degrades to in-memory rather than throwing when the disk rejects a write', () => {
    // Losing log history must never take down the user's dev servers. Point
    // the store at a path blocked by a regular file so every mkdir/write
    // fails with ENOTDIR — a deterministic stand-in for a full disk or a
    // permission the user has revoked.
    const blocker = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const store = makeStore({ baseDir: path.join(blocker, 'logs') });
    assert.doesNotThrow(() => {
      store.append('api', 'web', ['line']);
      store.flush();
    });
    store.dispose();
  });
});
