import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { buildActions, fuzzyScore, matchActions } from '../cli/palette';
import { buildRows } from '../cli/render';
import type { CliGroup, CliGroupStatus } from '../cli/client';

const GROUPS: CliGroup[] = [
  {
    id: 'split-demo',
    label: 'Split Layout Demo',
    layout: 'split',
    order: 'parallel',
    services: [
      { id: 'api', name: 'API', command: 'echo api' },
      { id: 'web', name: 'Web', command: 'echo web' },
    ],
  },
];

function rows() {
  return buildRows(GROUPS, new Map<string, CliGroupStatus>(), '');
}

describe('command palette', () => {
  test('builds run/stop/restart for groups and +logs for services', () => {
    const labels = buildActions(rows(), false).map((a) => a.label);
    assert.ok(labels.includes('run split-demo'));
    assert.ok(labels.includes('stop split-demo/web'));
    assert.ok(labels.includes('logs split-demo/api'));
    assert.ok(labels.includes('quit'));
    assert.ok(!labels.includes('clear filter'));
  });

  test('offers clear filter only when a filter is active', () => {
    const labels = buildActions(rows(), true).map((a) => a.label);
    assert.ok(labels.includes('clear filter'));
  });

  test('fuzzy matching: "stop web" finds stop split-demo/web first', () => {
    const matches = matchActions(buildActions(rows(), false), 'stop web');
    assert.equal(matches[0]?.label, 'stop split-demo/web');
  });

  test('fuzzy matching is subsequence-based and case-insensitive', () => {
    assert.notEqual(fuzzyScore('LGAPI', 'logs split-demo/api'), null);
    assert.equal(fuzzyScore('zzz', 'logs split-demo/api'), null);
  });

  test('empty query returns everything up to the limit', () => {
    const matches = matchActions(buildActions(rows(), false), '', 50);
    assert.equal(matches.length, buildActions(rows(), false).length);
  });
});
