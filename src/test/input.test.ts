import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { tokenizeInput } from '../cli/input';

const DOWN = '\x1b[B';
const UP = '\x1b[A';

function keys(chunk: string): string[] {
  return tokenizeInput(chunk)
    .filter((t) => t.kind === 'key')
    .map((t) => (t.kind === 'key' ? t.key : ''));
}

describe('reading a stdin chunk', () => {
  test('a single keypress arrives as one key', () => {
    assert.deepEqual(keys('r'), ['r']);
    assert.deepEqual(keys(DOWN), [DOWN]);
  });

  test('key repeat in one chunk becomes one event per press', () => {
    // Holding ↓ batches the sequences; taking only the first made the
    // cursor move a single row and appear stuck.
    assert.deepEqual(keys(DOWN + DOWN + DOWN + DOWN), [DOWN, DOWN, DOWN, DOWN]);
    assert.deepEqual(keys(UP + DOWN), [UP, DOWN]);
  });

  test('pasted text stays one chunk, so filters and the palette get it whole', () => {
    assert.deepEqual(keys('stop web'), ['stop web']);
  });

  test('a mouse report is parsed, not mistaken for keys', () => {
    const tokens = tokenizeInput('\x1b[<0;12;7M');
    assert.equal(tokens.length, 1);
    assert.deepEqual(tokens[0], { kind: 'mouse', button: 0, x: 12, y: 7, press: true });
  });

  test('a release reports as such', () => {
    const [token] = tokenizeInput('\x1b[<0;3;4m');
    assert.equal(token.kind === 'mouse' && token.press, false);
  });

  test('several mouse reports in one chunk all arrive', () => {
    const tokens = tokenizeInput('\x1b[<64;1;1M\x1b[<64;1;1M\x1b[<64;1;1M');
    assert.equal(tokens.length, 3);
    assert.ok(tokens.every((t) => t.kind === 'mouse' && t.button === 64));
  });

  test('a mouse report followed by a keypress yields both', () => {
    const tokens = tokenizeInput('\x1b[<0;5;5Mq');
    assert.deepEqual(tokens.map((t) => t.kind), ['mouse', 'key']);
    assert.equal(tokens[1].kind === 'key' && tokens[1].key, 'q');
  });

  test('a bare escape is its own key, not a truncated sequence', () => {
    assert.deepEqual(keys('\x1b'), ['\x1b']);
  });

  test('an empty chunk produces nothing', () => {
    assert.deepEqual(tokenizeInput(''), []);
  });
});
