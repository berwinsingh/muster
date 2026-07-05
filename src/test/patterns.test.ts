import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compilePatterns,
  DEFAULT_MONITORING_PATTERNS,
  diagnosticSeverityToEventSeverity,
  resolveMonitoringConfig,
} from '../monitoring/patterns';

describe('monitoring patterns', () => {
  it('compiles regex patterns without throwing', () => {
    const compiled = compilePatterns(DEFAULT_MONITORING_PATTERNS);
    assert.equal(compiled.length, DEFAULT_MONITORING_PATTERNS.length);
    assert.ok(compiled.every((p) => p.compiled instanceof RegExp));
  });

  it('maps diagnostic severities to event severities', () => {
    assert.equal(diagnosticSeverityToEventSeverity(0), 'error');
    assert.equal(diagnosticSeverityToEventSeverity(1), 'warning');
    assert.equal(diagnosticSeverityToEventSeverity(2), 'info');
    assert.equal(diagnosticSeverityToEventSeverity(3), null);
  });

  it('uses configured patterns when provided', () => {
    const custom = resolveMonitoringConfig({
      maxDays: 3,
      includeDiagnostics: false,
      patterns: [
        {
          id: 'custom',
          severity: 'warning',
          regex: 'CUSTOM_WARN',
          sources: ['terminal'],
        },
      ],
    });

    assert.equal(custom.maxDays, 3);
    assert.equal(custom.patterns.length, 1);
    assert.equal(custom.patterns[0]?.id, 'custom');
  });
});
