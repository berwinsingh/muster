/**
 * Pure rendering for the muster CLI: rows, colors, filtering, and the
 * dashboard frame. No I/O — the TUI and plain commands both draw from
 * here, and tests assert on the output.
 */
import type { CliGroup, CliGroupStatus } from './client';

/**
 * Whether to emit ANSI colour, decided once at startup.
 *
 * Honours the informal but widely-supported conventions: NO_COLOR (any
 * value) forces plain, FORCE_COLOR forces colour even when piped, and
 * otherwise colour follows "is stdout a terminal". Without this, piping
 * (`muster ls | grep api`) injected escape sequences into the middle of
 * the text being matched.
 */
export function colorEnabled(env = process.env, isTTY = process.stdout.isTTY): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') {
    return true;
  }
  return Boolean(isTTY);
}

const ANSI = {
  amber: '\x1b[38;5;215m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  invert: '\x1b[7m',
  reset: '\x1b[0m',
};

const PLAIN: typeof ANSI = {
  amber: '',
  green: '',
  red: '',
  yellow: '',
  blue: '',
  dim: '',
  bold: '',
  invert: '',
  reset: '',
};

/**
 * The palette every call site interpolates. Blanked wholesale rather than
 * wrapped in a helper so that adding colour anywhere stays a one-token
 * change and can never accidentally bypass the NO_COLOR check.
 */
export const A: typeof ANSI = colorEnabled() ? { ...ANSI } : { ...PLAIN };

/** Re-evaluate the palette — for tests, and the TUI, which always colours. */
export function setColorEnabled(enabled: boolean): void {
  Object.assign(A, enabled ? ANSI : PLAIN);
}

export function statusDot(status: string): string {
  switch (status) {
    case 'running':
      return `${A.green}●${A.reset}`;
    case 'starting':
      return `${A.yellow}◐${A.reset}`;
    case 'failed':
      return `${A.red}●${A.reset}`;
    case 'stopped':
      return `${A.dim}●${A.reset}`;
    default:
      return `${A.dim}○${A.reset}`;
  }
}

export type Row =
  | { kind: 'group'; group: CliGroup; state: string }
  | { kind: 'service'; group: CliGroup; serviceId: string; name: string; command: string; port?: number; status: string };

/** Flatten groups+statuses into selectable rows, applying a filter. */
export function buildRows(
  groups: CliGroup[],
  statuses: Map<string, CliGroupStatus>,
  filter: string
): Row[] {
  const needle = filter.trim().toLowerCase();
  const rows: Row[] = [];
  for (const group of groups) {
    const status = statuses.get(group.id);
    const services = group.services
      .map((svc) => ({
        kind: 'service' as const,
        group,
        serviceId: svc.id,
        name: svc.name,
        command: svc.command,
        port: svc.port,
        status: status?.services[svc.id] ?? 'idle',
      }))
      .filter(
        (row) =>
          !needle ||
          row.serviceId.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle) ||
          group.id.toLowerCase().includes(needle) ||
          group.label.toLowerCase().includes(needle)
      );
    if (needle && services.length === 0) {
      continue;
    }
    rows.push({ kind: 'group', group, state: status?.state ?? 'idle' });
    rows.push(...services);
  }
  return rows;
}

export function renderRow(row: Row, selected: boolean, width: number): string {
  const marker = selected ? `${A.amber}▸${A.reset} ` : '  ';
  let body: string;
  if (row.kind === 'group') {
    const state = row.state === 'running' ? `${A.green}${row.state}${A.reset}` : `${A.dim}${row.state}${A.reset}`;
    body = `${A.bold}${row.group.label}${A.reset} ${A.dim}(${row.group.id} · ${row.group.layout})${A.reset} ${state}`;
  } else {
    const port = row.port !== undefined ? `${A.blue}:${row.port}${A.reset} ` : '';
    const cmd = row.command.length > 48 ? `${row.command.slice(0, 45)}…` : row.command;
    body = `  ${statusDot(row.status)} ${row.name} ${port}${A.dim}${cmd}${A.reset}`;
  }
  return truncateAnsi(marker + body, width);
}

/** Truncate a string containing ANSI codes to a visible width. */
export function truncateAnsi(text: string, width: number): string {
  let visible = 0;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x1b') {
      const end = text.indexOf('m', i);
      if (end === -1) break;
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (visible >= width) break;
    out += text[i];
    visible += 1;
    i += 1;
  }
  return out + A.reset;
}

export function renderHeader(workspace: string, filter: string, width: number): string {
  const mark = `${A.amber}${A.bold} MUSTER ${A.reset}`;
  const ws = `${A.dim}${workspace}${A.reset}`;
  const f = filter ? `  ${A.amber}/${filter}${A.reset}` : '';
  return truncateAnsi(`${mark} ${ws}${f}`, width);
}

export type Button = { key: string; label: string; x1: number; x2: number };

/**
 * Colours used to tag services in combined log views, index-stable so a
 * given service keeps its colour for the whole session. Read through `A`
 * at call time rather than captured, so toggling colour off actually
 * applies here too.
 */
const SERVICE_COLOR_KEYS = ['green', 'blue', 'yellow', 'amber'] as const;

export function serviceColor(index: number): string {
  return A[SERVICE_COLOR_KEYS[Math.max(0, index) % SERVICE_COLOR_KEYS.length]];
}

/**
 * Tint a log line by its detected severity, so errors stand out when
 * scanning a wall of output. Only errors and warnings are coloured —
 * tinting ordinary lines would wash out the signal, and many dev servers
 * already colour their own output, which is left untouched.
 */
export function colorByLevel(line: string, level: 'error' | 'warn' | 'info'): string {
  if (level === 'error') return `${A.red}${line}${A.reset}`;
  if (level === 'warn') return `${A.yellow}${line}${A.reset}`;
  return line;
}

export type LogsBarState = {
  /** Current level filter label ("all", "errors", …). */
  level: string;
  /** Service focus label for combined views; undefined = single-service view. */
  focus?: string;
};

/**
 * Bottom button bar: every entry is both a keyboard hint and a clickable
 * hitbox. Returns the rendered line plus 1-based column ranges per button
 * so the TUI can hit-test mouse clicks.
 */
export function renderButtons(
  mode: 'dash' | 'logs',
  width: number,
  quitLabel = 'quit',
  logs?: LogsBarState
): { line: string; buttons: Button[] } {
  const defs: { key: string; label: string }[] =
    mode === 'dash'
      ? [
          { key: 'r', label: 'run' },
          { key: 's', label: 'stop' },
          { key: 'x', label: 'restart' },
          { key: 'l', label: 'logs' },
          { key: 'a', label: 'all logs' },
          { key: 'e', label: 'edit' },
          { key: '/', label: 'filter' },
          { key: ':', label: 'commands' },
          { key: 'q', label: quitLabel },
        ]
      : [
          { key: 'f', label: 'follow' },
          { key: 'v', label: `level: ${logs?.level ?? 'all'}` },
          ...(logs?.focus !== undefined ? [{ key: '\t', label: `service: ${logs.focus}` }] : []),
          { key: '/', label: 'filter' },
          { key: '\x1b', label: 'back' },
          { key: 'q', label: quitLabel },
        ];

  const buttons: Button[] = [];
  let line = '';
  let col = 1;
  for (const def of defs) {
    const keyText = def.key === '\x1b' ? 'esc' : def.key === '\t' ? 'tab' : def.key;
    // Visible cells: " key " + " label " → key+2 plus label+2 columns.
    const visible = keyText.length + def.label.length + 4;
    const x1 = col;
    const x2 = col + visible - 1;
    buttons.push({ key: def.key, label: def.label, x1, x2 });
    line += `${A.invert}${A.amber} ${keyText} ${A.reset}${A.invert}${A.dim} ${def.label} ${A.reset} `;
    col = x2 + 2; // one-column gap between buttons
  }
  const hint = mode === 'dash' ? '↑↓/click select' : '↑↓ scroll';
  return { line: truncateAnsi(`${line}${A.dim}${hint}${A.reset}`, width), buttons };
}

export function plainGroupList(groups: CliGroup[], statuses: Map<string, CliGroupStatus>): string {
  const lines: string[] = [];
  for (const group of groups) {
    const status = statuses.get(group.id);
    lines.push(
      `${A.bold}${group.id}${A.reset}  ${group.label}  ${A.dim}${group.layout}/${group.order}${A.reset}  ${status?.state ?? 'idle'}`
    );
    for (const svc of group.services) {
      const st = status?.services[svc.id] ?? 'idle';
      const port = svc.port !== undefined ? ` :${svc.port}` : '';
      lines.push(`  ${statusDot(st)} ${svc.id}${port}  ${A.dim}${svc.command}${A.reset}`);
    }
  }
  return lines.join('\n');
}
