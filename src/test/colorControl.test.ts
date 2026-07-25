import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { A, colorByLevel, colorEnabled, serviceColor, setColorEnabled } from '../cli/render';

describe('colour enablement follows the NO_COLOR/FORCE_COLOR conventions', () => {
  it('colours when stdout is a TTY and nothing overrides it', () => {
    assert.equal(colorEnabled({}, true), true);
  });

  it('does not colour when stdout is piped', () => {
    // The bug this guards: `muster ls | grep api` used to receive escape
    // sequences in the middle of the text being matched.
    assert.equal(colorEnabled({}, false), false);
  });

  it('NO_COLOR wins over a TTY', () => {
    assert.equal(colorEnabled({ NO_COLOR: '1' }, true), false);
    assert.equal(colorEnabled({ NO_COLOR: 'anything' }, true), false);
  });

  it('an empty NO_COLOR is not treated as set', () => {
    assert.equal(colorEnabled({ NO_COLOR: '' }, true), true);
  });

  it('FORCE_COLOR re-enables colour for a pipe', () => {
    assert.equal(colorEnabled({ FORCE_COLOR: '1' }, false), true);
  });

  it('FORCE_COLOR=0 does not force colour on', () => {
    assert.equal(colorEnabled({ FORCE_COLOR: '0' }, false), false);
  });

  it('NO_COLOR beats FORCE_COLOR when both are set', () => {
    assert.equal(colorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }, true), false);
  });
});

describe('the palette can be blanked wholesale', () => {
  it('blanks every escape code and restores them', () => {
    setColorEnabled(false);
    try {
      for (const [key, value] of Object.entries(A)) {
        assert.equal(value, '', `expected A.${key} to be blank`);
      }
      // Service tags and level tints must go through the live palette, not
      // a copy captured at module load.
      assert.equal(serviceColor(0), '');
      assert.equal(colorByLevel('boom', 'error'), 'boom');
    } finally {
      setColorEnabled(true);
    }
    assert.notEqual(A.red, '');
    assert.notEqual(serviceColor(0), '');
  });

  it('service colours are stable per index and cycle', () => {
    setColorEnabled(true);
    const first = serviceColor(0);
    assert.equal(serviceColor(0), first, 'same index must keep its colour');
    assert.notEqual(serviceColor(1), first);
    assert.equal(serviceColor(4), first, 'colours cycle');
    assert.equal(serviceColor(-1), first, 'negative index is clamped, not undefined');
  });
});

describe('level tinting', () => {
  it('tints errors red and warnings yellow, leaving info untouched', () => {
    setColorEnabled(true);
    assert.ok(colorByLevel('boom', 'error').startsWith(A.red));
    assert.ok(colorByLevel('careful', 'warn').startsWith(A.yellow));
    // Ordinary lines stay as-is: tinting everything would destroy the
    // signal, and many dev servers already colour their own output.
    assert.equal(colorByLevel('listening on :3000', 'info'), 'listening on :3000');
  });

  it('closes the escape sequence so colour never bleeds into later lines', () => {
    setColorEnabled(true);
    assert.ok(colorByLevel('boom', 'error').endsWith(A.reset));
    assert.ok(colorByLevel('careful', 'warn').endsWith(A.reset));
  });
});
