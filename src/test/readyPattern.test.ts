import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendChunk, bufferedText, newLineBuffer } from '../cli/liveState';
import { stripAnsi } from '../cli/logFilter';

/**
 * The readiness check the supervisor performs, isolated: does this pattern
 * match what the service has printed so far? Spawning a real process to
 * assert on regex behaviour would only make these slower and flakier.
 */
function matchesReady(chunks: string[], pattern: string): boolean {
  const buf = newLineBuffer();
  for (const chunk of chunks) appendChunk(buf, chunk);
  return new RegExp(pattern).test(stripAnsi(bufferedText(buf)));
}

describe('readyPattern matches through ANSI colour', () => {
  it("matches Next.js's coloured ready line", () => {
    // The regression: Next.js emits "✓\x1b[0m Ready in 1.2s", so the reset
    // code sits between the tick and the word. Matching the raw bytes meant
    // "✓ Ready" never matched, the group hung for the full 120s timeout,
    // and anything depending on it never started at all.
    const nextOutput = [
      '   \x1b[1m▲ Next.js 15.0.0\x1b[0m\n',
      '   - Local:        http://localhost:3000\n',
      ' \x1b[32m✓\x1b[0m Ready in 1.2s\n',
    ];
    assert.equal(matchesReady(nextOutput, '✓ Ready'), true);
    assert.equal(matchesReady(nextOutput, 'Ready in'), true);
  });

  it('matches a pattern anchored to the start of a coloured line', () => {
    // A leading colour code would otherwise push the real text off ^.
    assert.equal(matchesReady(['\x1b[32mready - started server\x1b[0m\n'], '^ready - started'), true);
  });

  it('matches Vite-style coloured output', () => {
    const vite = ['  \x1b[32m➜\x1b[0m  \x1b[1mLocal\x1b[0m:   http://localhost:5173/\n'];
    assert.equal(matchesReady(vite, '➜  Local'), true);
    assert.equal(matchesReady(vite, 'Local:'), true);
  });

  it('still matches plain uncoloured output', () => {
    assert.equal(
      matchesReady(['INFO: Application startup complete.\n'], 'Application startup complete'),
      true
    );
  });

  it('matches across a chunk split mid-line', () => {
    // stdout arrives in arbitrary splits; the phrase can straddle two chunks.
    assert.equal(matchesReady(['Ready ', 'in 1.2s\n'], 'Ready in'), true);
  });

  it('matches text still sitting in the unterminated partial line', () => {
    // A server that prints its ready marker without a trailing newline must
    // still be detected — otherwise it hangs until the timeout.
    assert.equal(matchesReady(['Ready in 1.2s'], 'Ready in'), true);
  });

  it('does not match a pattern the service never printed', () => {
    assert.equal(
      matchesReady(['listening on :3000\n'], 'Application startup complete'),
      false
    );
  });

  it('does not let a stripped colour code join two unrelated words', () => {
    // Stripping must not fabricate a match: "done" and "loading" stay apart.
    assert.equal(matchesReady(['done\x1b[0m loading\n'], 'doneloading'), false);
  });
});
