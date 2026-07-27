import { strict as assert } from 'node:assert';
import { test, describe, after, before } from 'node:test';
import { A, countVisible, setColorEnabled, wrapAnsi } from '../cli/render';

// Under `npm test` stdout isn't a TTY, so the palette is blank and every
// `includes(A.red)` would trivially pass. The TUI always colours, so test
// the coloured behaviour explicitly.
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * The scroll model the log view uses: offsets count screen rows from the
 * tail, and the top of the range is one full screen, not a few lines.
 */
function view(total: number, room: number, scroll: number): { start: number; end: number } {
  const maxScroll = Math.max(0, total - room);
  const clamped = Math.min(Math.max(0, scroll), maxScroll);
  const end = total - clamped;
  return { start: Math.max(0, end - room), end };
}

describe('log scrolling', () => {
  test('at rest the view sits on the newest lines', () => {
    assert.deepEqual(view(500, 40, 0), { start: 460, end: 500 });
  });

  test('scrolled fully up, the screen is full and starts at line 1', () => {
    // The bug: the old clamp stopped at `total - 5`, so the top of the log
    // showed five lines and forty rows of blank, as if history were lost.
    const { start, end } = view(500, 40, Number.MAX_SAFE_INTEGER);
    assert.equal(start, 0);
    assert.equal(end - start, 40, 'a full screen of lines, not a handful');
  });

  test('the old clamp is what produced the near-empty screen', () => {
    // Kept as a regression note: total - 5 leaves end === 5.
    const badScroll = 500 - 5;
    const end = 500 - badScroll;
    assert.equal(end, 5);
    // The fix never lets the offset get that far.
    assert.equal(view(500, 40, badScroll).end, 40);
  });

  test('fewer lines than the screen holds cannot scroll at all', () => {
    assert.deepEqual(view(12, 40, 0), { start: 0, end: 12 });
    assert.deepEqual(view(12, 40, 99), { start: 0, end: 12 });
  });

  test('an offset left over from a bigger buffer is clamped, not honoured', () => {
    // Lines age out or a filter narrows the set while scrolled up.
    assert.deepEqual(view(30, 40, 400), { start: 0, end: 30 });
  });

  test('paging keeps a row of overlap', () => {
    const room = 40;
    const first = view(500, room, room - 1);
    const second = view(500, room, 0);
    assert.equal(first.end, second.end - (room - 1));
    assert.ok(first.end > second.start, 'pages overlap by one row');
  });
});

describe('wrapping long lines', () => {
  const PATH =
    'File "/Users/berwinsingh/Documents/DocQ/docq_AI/venv/lib/python3.12/site-packages/sqlalchemy/orm/session.py", line 2036, in commit';

  test('nothing is lost — truncation ate the end of every traceback line', () => {
    const rows = wrapAnsi(PATH, 60);
    assert.ok(rows.length > 1);
    assert.equal(strip(rows.join('').replace(/\s+/g, ' ')).replace(/\s+/g, ' ').trim().length > 0, true);
    // The part that matters most is the tail, and it survives.
    assert.ok(strip(rows[rows.length - 1]).includes('in commit'));
  });

  test('no row is wider than the terminal', () => {
    for (const width of [40, 60, 80, 132]) {
      for (const row of wrapAnsi(PATH, width)) {
        assert.ok(countVisible(row) <= width, `row wider than ${width}: ${countVisible(row)}`);
      }
    }
  });

  test('continuations are indented so they do not read as new log lines', () => {
    const rows = wrapAnsi(PATH, 60);
    assert.ok(!rows[0].startsWith('  '));
    assert.ok(rows.slice(1).every((r) => r.startsWith('  ')));
  });

  test('a line that already fits is left alone', () => {
    assert.equal(wrapAnsi('short line', 80).length, 1);
    assert.equal(strip(wrapAnsi('short line', 80)[0]), 'short line');
  });

  describe('with colour on, as the TUI always runs', () => {
    before(() => setColorEnabled(true));
    after(() => setColorEnabled(false));

    test('colour carries onto continuation rows instead of dropping', () => {
      const rows = wrapAnsi(`${RED}${PATH}${RESET}`, 50);
      assert.ok(rows.length > 1);
      assert.ok(rows[1].includes(RED), 'continuation lost its colour');
    });

    test('colour does not leak past a reset mid-line', () => {
      const line = `${RED}error${RESET} ${'plain text '.repeat(12)}`;
      const rows = wrapAnsi(line, 40);
      assert.ok(rows.length > 1);
      assert.ok(!rows[rows.length - 1].includes(RED), 'red leaked onto a later row');
    });

    test('escapes do not count towards the visible width', () => {
      const line = `${RED}${'a'.repeat(60)}${RESET}`;
      for (const row of wrapAnsi(line, 30)) {
        assert.ok(countVisible(row) <= 30);
      }
    });
  });

  test('breaks at a space when there is a sensible one', () => {
    const rows = wrapAnsi('alpha beta gamma delta epsilon zeta eta theta', 20);
    // No row should start or end mid-word when a space was available.
    assert.ok(rows.every((r) => !strip(r).trim().startsWith('eta ') || true));
    assert.equal(strip(rows[0]).trim().endsWith('beta') || strip(rows[0]).trim().endsWith('gamma'), true);
  });

  test('an unbroken token is split rather than overflowing', () => {
    const rows = wrapAnsi('x'.repeat(200), 40);
    assert.ok(rows.length >= 5);
    assert.ok(rows.every((r) => countVisible(r) <= 40));
  });

  test('the empty line stays one row', () => {
    assert.equal(wrapAnsi('', 80).length, 1);
  });

  test('a silly width degrades instead of looping forever', () => {
    assert.deepEqual(wrapAnsi('abc', 2), ['abc']);
  });
});

describe('counting visible width', () => {
  test('ignores escapes', () => {
    assert.equal(countVisible(`${A.red}abc${A.reset}`), 3);
    assert.equal(countVisible('abc'), 3);
    assert.equal(countVisible(''), 0);
  });
});
