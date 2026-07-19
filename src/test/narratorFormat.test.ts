import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
  formatAllRunning,
  formatFailure,
  formatReadyMatched,
  formatRunHeader,
  formatServiceLaunch,
  formatStarting,
  formatStopped,
  formatStopping,
  formatWaitingReady,
  stripAnsi,
} from '../orchestration/narratorFormat';

describe('narrator formatting', () => {
  test('run header reads like a CLI invocation', () => {
    assert.equal(stripAnsi(formatRunHeader('full-stack')), '❯ muster run full-stack');
  });

  test('starting line includes count, layout, and order', () => {
    assert.equal(
      stripAnsi(formatStarting(3, 'dedicated', 'parallel')),
      '[muster] starting 3 services · layout: dedicated · order: parallel'
    );
    assert.equal(
      stripAnsi(formatStarting(1, 'aggregated', 'sequence')),
      '[muster] starting 1 service · layout: aggregated · order: sequence'
    );
  });

  test('service launch shows id and command', () => {
    const line = stripAnsi(formatServiceLaunch('api', 'uvicorn main:app --reload'));
    assert.equal(line, '[muster] ▶ api — uvicorn main:app --reload');
  });

  test('ready matched appends dependents arrow only when there are dependents', () => {
    assert.equal(
      stripAnsi(formatReadyMatched('api', true)),
      '[muster] ready pattern matched on api → starting dependents'
    );
    assert.equal(
      stripAnsi(formatReadyMatched('api', false)),
      '[muster] ready pattern matched on api'
    );
  });

  test('waiting line names what is awaited', () => {
    assert.equal(
      stripAnsi(formatWaitingReady('api', 'ready pattern + health check')),
      '[muster] waiting for ready pattern + health check on api…'
    );
  });

  test('all-running summary matches the product tagline shape', () => {
    assert.equal(
      stripAnsi(formatAllRunning('full-stack', 3, 3)),
      '✓ [muster] full-stack · 3/3 services running'
    );
  });

  test('stop lines are symmetric', () => {
    assert.equal(stripAnsi(formatStopping('dev')), '[muster] ⏹ stopping dev…');
    assert.equal(stripAnsi(formatStopped('dev')), '[muster] stopped dev');
  });

  test('failure line carries context and message', () => {
    assert.equal(
      stripAnsi(formatFailure('api', 'did not become ready')),
      '✗ [muster] api: did not become ready'
    );
  });

  test('every line is actually colored (contains ANSI escapes)', () => {
    for (const line of [
      formatRunHeader('g'),
      formatStarting(2, 'split', 'parallel'),
      formatServiceLaunch('s', 'cmd'),
      formatAllRunning('g', 2, 2),
      formatFailure('s', 'boom'),
    ]) {
      assert.notEqual(line, stripAnsi(line), `expected ANSI codes in: ${line}`);
    }
  });
});
