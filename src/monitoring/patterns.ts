import { MonitoringConfig, MonitoringPattern } from '../config/schema';

export const DEFAULT_MONITORING_PATTERNS: MonitoringPattern[] = [
  {
    id: 'error',
    severity: 'error',
    category: 'runtime',
    regex:
      'ERROR|Error:|Traceback|Exception|OperationalError|ECONNREFUSED|connection refused|FATAL|panic:',
    sources: ['terminal'],
  },
  {
    id: 'warning',
    severity: 'warning',
    category: 'runtime',
    regex: 'WARN|Warning:|warning:|deprecated',
    sources: ['terminal'],
  },
  {
    id: 'info',
    severity: 'info',
    category: 'runtime',
    regex:
      '\\[info\\]|\\[INFO\\]|INFO:|started|listening on|ready|initialized|Server running',
    sources: ['terminal'],
  },
];

export function resolveMonitoringConfig(
  monitoring: MonitoringConfig | undefined
): Required<MonitoringConfig> {
  const patterns =
    monitoring?.patterns?.length ? monitoring.patterns : DEFAULT_MONITORING_PATTERNS;

  return {
    maxDays: monitoring?.maxDays ?? 7,
    patterns,
    includeDiagnostics: monitoring?.includeDiagnostics ?? true,
  };
}

export function compilePatterns(
  patterns: MonitoringPattern[]
): Array<MonitoringPattern & { compiled: RegExp }> {
  return patterns
    .map((pattern) => {
      try {
        return { ...pattern, compiled: new RegExp(pattern.regex, 'i') };
      } catch {
        return null;
      }
    })
    .filter((p): p is MonitoringPattern & { compiled: RegExp } => p !== null);
}

export function diagnosticSeverityToEventSeverity(
  severity: number
): 'error' | 'warning' | 'info' | null {
  switch (severity) {
    case 0:
      return 'error';
    case 1:
      return 'warning';
    case 2:
      return 'info';
    default:
      return null;
  }
}
