import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
  appendNewLines,
  classifyLine,
  filterLog,
  matchesLevel,
  nextLevel,
  parseLevel,
  stripAnsi,
  TaggedLine,
} from '../cli/logFilter';

describe('log classification', () => {
  test('classifies error lines including tracebacks and markers', () => {
    assert.equal(classifyLine('ERROR: something broke'), 'error');
    assert.equal(classifyLine('TypeError: x is not a function'), 'error');
    assert.equal(classifyLine('Traceback (most recent call last):'), 'error');
    assert.equal(classifyLine('request failed with status 500'), 'error');
    assert.equal(classifyLine('✗ build did not complete'), 'error');
    assert.equal(classifyLine('[err] boom'), 'error');
  });

  test('classifies warnings, including deprecations', () => {
    assert.equal(classifyLine('WARN config missing'), 'warn');
    assert.equal(classifyLine('Warning: peer dependency unmet'), 'warn');
    assert.equal(classifyLine('DeprecationWarning: fs.exists'), 'warn');
  });

  test('everything else is info', () => {
    assert.equal(classifyLine('Server listening on :3000'), 'info');
    assert.equal(classifyLine('GET /health 200 2ms'), 'info');
  });

  test('classification sees through ANSI colors', () => {
    assert.equal(classifyLine('\x1b[31mERROR\x1b[0m boom'), 'error');
    assert.equal(stripAnsi('\x1b[32mhello\x1b[0m'), 'hello');
  });

  test('matchesLevel: all matches everything, others match exactly', () => {
    assert.ok(matchesLevel('ERROR x', 'all'));
    assert.ok(matchesLevel('ERROR x', 'error'));
    assert.ok(!matchesLevel('ERROR x', 'info'));
    assert.ok(!matchesLevel('plain line', 'error'));
  });

  test('level cycling and flag parsing', () => {
    assert.equal(nextLevel('all'), 'error');
    assert.equal(nextLevel('error'), 'warn');
    assert.equal(nextLevel('warn'), 'info');
    assert.equal(nextLevel('info'), 'all');
    assert.equal(parseLevel('errors'), 'error');
    assert.equal(parseLevel('WARNING'), 'warn');
    assert.equal(parseLevel('info'), 'info');
    assert.equal(parseLevel('all'), 'all');
    assert.equal(parseLevel('nope'), null);
  });
});

describe('filterLog', () => {
  const lines = [
    'Server listening on :8000',
    'ERROR: db connection refused',
    'WARN slow query 1200ms',
    '\x1b[31mERROR\x1b[0m: db timeout',
  ];

  test('filters by level', () => {
    assert.deepEqual(filterLog(lines, 'error'), [lines[1], lines[3]]);
    assert.deepEqual(filterLog(lines, 'warn'), [lines[2]]);
    assert.deepEqual(filterLog(lines, 'info'), [lines[0]]);
    assert.equal(filterLog(lines, 'all').length, 4);
  });

  test('composes level with case-insensitive text (ANSI-stripped)', () => {
    assert.deepEqual(filterLog(lines, 'error', 'TIMEOUT'), [lines[3]]);
    assert.deepEqual(filterLog(lines, 'all', 'db'), [lines[1], lines[3]]);
    assert.deepEqual(filterLog(lines, 'info', 'db'), []);
  });
});

describe('appendNewLines (combined feed merge)', () => {
  test('first poll dumps everything; later polls append only deltas', () => {
    const combined: TaggedLine[] = [];
    const counts = new Map<string, number>();
    assert.equal(appendNewLines(combined, counts, 'api', ['a', 'b']), 2);
    assert.equal(appendNewLines(combined, counts, 'web', ['x']), 1);
    assert.equal(appendNewLines(combined, counts, 'api', ['a', 'b', 'c']), 1);
    assert.deepEqual(
      combined.map((e) => `${e.serviceId}:${e.line}`),
      ['api:a', 'api:b', 'web:x', 'api:c']
    );
  });

  test('a shrunken buffer (restart) resyncs without duplicating', () => {
    const combined: TaggedLine[] = [];
    const counts = new Map<string, number>();
    appendNewLines(combined, counts, 'api', ['a', 'b', 'c']);
    assert.equal(appendNewLines(combined, counts, 'api', ['fresh']), 0);
    // next delta after the resync flows normally
    assert.equal(appendNewLines(combined, counts, 'api', ['fresh', 'more']), 1);
    assert.equal(combined[combined.length - 1].line, 'more');
  });

  test('recovers new lines when a saturated tail window slides', () => {
    const combined: TaggedLine[] = [];
    const counts = new Map<string, number>();
    appendNewLines(combined, counts, 'api', ['a', 'b', 'c']);
    // window stays 3 long but slid by two: c is the overlap point
    assert.equal(appendNewLines(combined, counts, 'api', ['c', 'd', 'e']), 2);
    assert.deepEqual(combined.map((e) => e.line), ['a', 'b', 'c', 'd', 'e']);
    // identical poll appends nothing
    assert.equal(appendNewLines(combined, counts, 'api', ['c', 'd', 'e']), 0);
  });

  test('caps the combined buffer', () => {
    const combined: TaggedLine[] = [];
    const counts = new Map<string, number>();
    appendNewLines(combined, counts, 'api', Array.from({ length: 30 }, (_, i) => `l${i}`), 10);
    assert.equal(combined.length, 10);
    assert.equal(combined[0].line, 'l20');
  });
});
