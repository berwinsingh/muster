import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
  appendChunk,
  bufferedText,
  deriveGroupState,
  newLineBuffer,
  tailLines,
} from '../cli/liveState';

describe('liveState line buffer', () => {
  test('completes lines only at newline boundaries', () => {
    const buf = newLineBuffer();
    assert.deepEqual(appendChunk(buf, 'hel'), []);
    assert.deepEqual(appendChunk(buf, 'lo\nwor'), ['hello']);
    assert.deepEqual(appendChunk(buf, 'ld\n'), ['world']);
    assert.deepEqual(buf.lines, ['hello', 'world']);
    assert.equal(buf.partial, '');
  });

  test('handles CRLF and skips blank lines', () => {
    const buf = newLineBuffer();
    assert.deepEqual(appendChunk(buf, 'a\r\n\r\nb\n'), ['a', 'b']);
  });

  test('caps the buffer, keeping the newest lines', () => {
    const buf = newLineBuffer();
    for (let i = 0; i < 30; i++) appendChunk(buf, `line${i}\n`, 10);
    assert.equal(buf.lines.length, 10);
    assert.equal(buf.lines[0], 'line20');
    assert.equal(buf.lines[9], 'line29');
  });

  test('bufferedText includes the trailing partial for readyPattern matching', () => {
    const buf = newLineBuffer();
    appendChunk(buf, 'starting\nready on port 30');
    assert.match(bufferedText(buf), /ready on port 30/);
  });

  test('tailLines returns the newest lines plus any partial', () => {
    const buf = newLineBuffer();
    appendChunk(buf, 'one\ntwo\nthree\nfou');
    assert.deepEqual(tailLines(buf, 2), ['three', 'fou']);
    assert.deepEqual(tailLines(buf, 10), ['one', 'two', 'three', 'fou']);
  });
});

describe('deriveGroupState', () => {
  test('empty → idle; any starting wins', () => {
    assert.equal(deriveGroupState([], 3), 'idle');
    assert.equal(deriveGroupState(['running', 'starting'], 2), 'starting');
  });

  test('all configured services running → running', () => {
    assert.equal(deriveGroupState(['running', 'running'], 2), 'running');
  });

  test('spawned-but-incomplete counts as partial, not running', () => {
    assert.equal(deriveGroupState(['running'], 2), 'partial');
    assert.equal(deriveGroupState(['running', 'failed'], 2), 'partial');
  });

  test('nothing running → failed beats stopped', () => {
    assert.equal(deriveGroupState(['failed', 'stopped'], 2), 'failed');
    assert.equal(deriveGroupState(['stopped', 'stopped'], 2), 'stopped');
  });
});
