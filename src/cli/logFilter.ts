/**
 * Pure log-line filtering shared by the TUI, `muster logs`, and the MCP
 * logs tool: severity classification on ANSI-stripped text, level
 * cycling, and the per-service merge that feeds combined group views.
 * No I/O — unit tested directly.
 */

export type LogLevel = 'all' | 'error' | 'warn' | 'info';

export const LEVEL_CYCLE: LogLevel[] = ['all', 'error', 'warn', 'info'];

export const LEVEL_LABEL: Record<LogLevel, string> = {
  all: 'all',
  error: 'errors',
  warn: 'warnings',
  info: 'info',
};

export function nextLevel(level: LogLevel): LogLevel {
  return LEVEL_CYCLE[(LEVEL_CYCLE.indexOf(level) + 1) % LEVEL_CYCLE.length];
}

/** Normalize a --level flag value ("errors", "warning", …) or null if invalid. */
export function parseLevel(raw: string): LogLevel | null {
  const value = raw.trim().toLowerCase();
  if (value === 'all') return 'all';
  if (value === 'error' || value === 'errors' || value === 'err') return 'error';
  if (value === 'warn' || value === 'warning' || value === 'warnings') return 'warn';
  if (value === 'info') return 'info';
  return null;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// Aligned with the default monitoring patterns (ERROR|Error:|Traceback|
// Exception / WARN|Warning:) but broader, since service output is untyped.
// No leading \b before error/warn: compound words like "TypeError:" and
// "DeprecationWarning" must match too.
const ERROR_RE =
  /error(s)?\b|\berr\b|fatal|panic|exception\b|traceback|unhandled|critical|\bfail(ed|ure|ing)?s?\b|✗|\[err(or)?\]/i;
const WARN_RE = /warn(ing)?s?\b|deprecat|⚠|\[warn(ing)?\]/i;

export function classifyLine(line: string): 'error' | 'warn' | 'info' {
  const text = stripAnsi(line);
  if (ERROR_RE.test(text)) return 'error';
  if (WARN_RE.test(text)) return 'warn';
  return 'info';
}

export function matchesLevel(line: string, level: LogLevel): boolean {
  return level === 'all' || classifyLine(line) === level;
}

/** Apply level + case-insensitive text filters (text matches ANSI-stripped). */
export function filterLog(lines: string[], level: LogLevel, text = ''): string[] {
  const needle = text.trim().toLowerCase();
  return lines.filter(
    (line) =>
      matchesLevel(line, level) &&
      (!needle || stripAnsi(line).toLowerCase().includes(needle))
  );
}

/** A line in a combined multi-service feed, tagged with its origin. */
export type TaggedLine = { serviceId: string; line: string };

/**
 * Merge one service's freshly-polled tail into a combined feed, appending
 * only lines not seen before (tracked per service in `counts`). Handles
 * restarts (buffer shrank → reset without re-dumping) and saturated tail
 * windows (same length but content slid → recover via overlap with the
 * last seen line). Mutates `combined` and `counts`; returns the number of
 * lines appended.
 */
export function appendNewLines(
  combined: TaggedLine[],
  counts: Map<string, number>,
  serviceId: string,
  latest: string[],
  cap = 4000
): number {
  const seen = counts.get(serviceId);
  let fresh: string[] = [];

  if (seen === undefined) {
    fresh = latest;
  } else if (latest.length > seen) {
    fresh = latest.slice(seen);
  } else if (latest.length === seen && seen > 0) {
    // The tail window may have slid while staying the same size. Find the
    // last line we already have and take everything after it.
    let last: string | undefined;
    for (let i = combined.length - 1; i >= 0; i--) {
      if (combined[i].serviceId === serviceId) {
        last = combined[i].line;
        break;
      }
    }
    if (last !== undefined && latest[latest.length - 1] !== last) {
      const idx = latest.lastIndexOf(last);
      fresh = latest.slice(idx + 1); // idx === -1 → the whole tail is new
    }
  }
  // latest.length < seen → service restarted with a fresh buffer; just resync.

  counts.set(serviceId, latest.length);
  for (const line of fresh) {
    combined.push({ serviceId, line });
  }
  if (combined.length > cap) {
    combined.splice(0, combined.length - cap);
  }
  return fresh.length;
}
