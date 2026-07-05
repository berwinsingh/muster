import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compilePatterns, DEFAULT_MONITORING_PATTERNS, resolveMonitoringConfig } from '../monitoring/patterns';
import { matchTerminalLine } from '../monitoring/matchLine';

describe('event pattern matching', () => {
  const patterns = compilePatterns(
    resolveMonitoringConfig(undefined).patterns.filter((p) => p.sources.includes('terminal'))
  );

  it('matches info log lines', () => {
    const match = matchTerminalLine('[info] Server listening on port 3000', patterns);
    assert.ok(match);
    assert.equal(match?.severity, 'info');
  });

  it('matches OperationalError as error severity', () => {
    const match = matchTerminalLine('sqlalchemy.exc.OperationalError: connection failed', patterns);
    assert.ok(match);
    assert.equal(match?.severity, 'error');
  });

  it('matches connection refused messages', () => {
    const match = matchTerminalLine('Error: connect ECONNREFUSED 127.0.0.1:5432', patterns);
    assert.ok(match);
    assert.equal(match?.severity, 'error');
  });

  it('ignores blank lines', () => {
    assert.equal(matchTerminalLine('   ', patterns), undefined);
  });
});

describe('default monitoring patterns', () => {
  it('includes error, warning, and info defaults', () => {
    const ids = DEFAULT_MONITORING_PATTERNS.map((p) => p.id).sort();
    assert.deepEqual(ids, ['error', 'info', 'warning']);
  });

  it('falls back to defaults when monitoring config is empty', () => {
    const resolved = resolveMonitoringConfig({ maxDays: 7, patterns: [], includeDiagnostics: false });
    assert.equal(resolved.patterns.length, DEFAULT_MONITORING_PATTERNS.length);
  });
});
