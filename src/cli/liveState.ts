/**
 * Pure state helpers for the headless supervisor's live dashboard: chunk →
 * line buffering (child stdout arrives in arbitrary splits) and group-state
 * derivation from per-service statuses. No I/O — unit tested directly.
 */

export type LineBuffer = { lines: string[]; partial: string };

export function newLineBuffer(): LineBuffer {
  return { lines: [], partial: '' };
}

/**
 * Append a raw stdout chunk, completing lines at newline boundaries.
 * Returns the lines completed by this chunk (for echo streaming). The
 * buffer keeps at most `cap` lines.
 */
export function appendChunk(buf: LineBuffer, chunk: string, cap = 2000): string[] {
  const text = buf.partial + chunk;
  const parts = text.split(/\r?\n/);
  buf.partial = parts.pop() ?? '';
  const completed = parts.filter((line) => line.length > 0);
  buf.lines.push(...completed);
  if (buf.lines.length > cap) {
    buf.lines.splice(0, buf.lines.length - cap);
  }
  return completed;
}

/** Everything received so far, for readyPattern matching. */
export function bufferedText(buf: LineBuffer): string {
  return buf.lines.length ? buf.lines.join('\n') + '\n' + buf.partial : buf.partial;
}

/** Tail of the completed lines (plus any trailing partial, so live output shows). */
export function tailLines(buf: LineBuffer, count: number): string[] {
  const all = buf.partial ? [...buf.lines, buf.partial] : buf.lines;
  return all.slice(Math.max(0, all.length - count));
}

export type ServiceState = 'starting' | 'running' | 'failed' | 'stopped';

/**
 * Collapse per-service statuses into the group state the dashboard shows.
 * `total` is the group's configured service count — services not yet
 * spawned (sequential startup) count as pending.
 */
export function deriveGroupState(statuses: ServiceState[], total: number): string {
  if (statuses.length === 0) return 'idle';
  if (statuses.some((s) => s === 'starting')) return 'starting';
  const running = statuses.filter((s) => s === 'running').length;
  if (running === total) return 'running';
  if (running > 0) return 'partial';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  return 'stopped';
}
