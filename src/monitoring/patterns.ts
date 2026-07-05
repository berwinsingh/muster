import { MonitoringConfig, MonitoringPattern } from '../config/schema';

export const DEFAULT_MONITORING_PATTERNS: MonitoringPattern[] = [
  {
    id: 'error',
    severity: 'error',
    regex: 'ERROR|Error:|Traceback|Exception|FATAL',
    sources: ['terminal'],
  },
  {
    id: 'warning',
    severity: 'warning',
    regex: 'WARN|Warning:',
    sources: ['terminal'],
  },
];

export function resolveMonitoringConfig(
  monitoring: MonitoringConfig | undefined
): Required<MonitoringConfig> {
  const patterns =
    monitoring?.patterns?.length ? monitoring.patterns : DEFAULT_MONITORING_PATTERNS;

  return {
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
