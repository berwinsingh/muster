/**
 * Pure rendering for the muster CLI: rows, colors, filtering, and the
 * dashboard frame. No I/O — the TUI and plain commands both draw from
 * here, and tests assert on the output.
 */
import type { CliGroup, CliGroupStatus } from './client';

export const A = {
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

export function renderKeybar(mode: 'dash' | 'logs', width: number): string {
  const keys =
    mode === 'dash'
      ? '↑↓ select · r run · s stop · x restart (group or service) · l logs · / filter · q quit'
      : '↑↓ scroll · f follow · / filter · esc back · q quit';
  return truncateAnsi(`${A.invert} ${keys} ${A.reset}`, width);
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
