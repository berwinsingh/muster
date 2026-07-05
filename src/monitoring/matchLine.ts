import { MonitoringPattern } from '../config/schema';

const SEVERITY_RANK: Record<'error' | 'warning' | 'info', number> = {
  error: 3,
  warning: 2,
  info: 1,
};

export type CompiledPattern = MonitoringPattern & { compiled: RegExp };

export function matchTerminalLine(
  line: string,
  patterns: CompiledPattern[]
): (MonitoringPattern & { compiled: RegExp }) | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let bestMatch: CompiledPattern | undefined;
  for (const pattern of patterns) {
    if (!pattern.compiled.test(trimmed)) {
      continue;
    }
    if (!bestMatch || SEVERITY_RANK[pattern.severity] > SEVERITY_RANK[bestMatch.severity]) {
      bestMatch = pattern;
    }
  }

  return bestMatch;
}
