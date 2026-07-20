/**
 * The interactive `muster` dashboard: a full-screen terminal UI over the
 * extension's IPC API. Poll-driven (1s), keyboard-operated, zero deps —
 * hand-rolled ANSI on the alternate screen buffer.
 */
import { CliGroupStatus, IpcClient } from './client';
import {
  A,
  buildRows,
  renderHeader,
  renderKeybar,
  renderRow,
  Row,
} from './render';

const ALT_ON = '\x1b[?1049h\x1b[?25l';
const ALT_OFF = '\x1b[?25h\x1b[?1049l';
const CLEAR = '\x1b[2J\x1b[H';

type Mode = 'dash' | 'filter' | 'logs';

export async function runTui(client: IpcClient): Promise<void> {
  let rows: Row[] = [];
  let selected = 0;
  let filter = '';
  let mode: Mode = 'dash';
  let logsTarget: { groupId: string; serviceId: string; name: string } | null = null;
  let logLines: string[] = [];
  let logFilter = '';
  let logScroll = 0; // 0 = pinned to tail
  let follow = true;
  let flash = '';
  let flashTicks = 0; // poll ticks the current flash stays visible
  let connectionError = '';
  let running = true;
  // '/' edits the dashboard filter or the log filter depending on where it was pressed
  let filterReturnMode: 'dash' | 'logs' = 'dash';

  const statuses = new Map<string, CliGroupStatus>();

  async function refresh(): Promise<void> {
    try {
      const groups = await client.groups();
      await Promise.all(
        groups.map(async (g) => {
          try {
            statuses.set(g.id, await client.status(g.id));
          } catch {
            // group may not have run yet
          }
        })
      );
      rows = buildRows(groups, statuses, filter);
      if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
      if (mode === 'logs' && logsTarget && follow) {
        logLines = await client.logs(logsTarget.groupId, logsTarget.serviceId, 500);
      }
      connectionError = '';
    } catch (err) {
      connectionError = String(err instanceof Error ? err.message : err);
    }
  }

  function draw(): void {
    const width = process.stdout.columns ?? 80;
    const height = process.stdout.rows ?? 24;
    const out: string[] = [];

    out.push(renderHeader(client.workspace, filter, width));
    out.push('');

    if (connectionError) {
      out.push(`${A.red}▲ ${connectionError}${A.reset}`);
      out.push(`${A.dim}Retrying every second…${A.reset}`);
    } else if (mode === 'logs' && logsTarget) {
      const filterTag = logFilter ? `  ${A.amber}/${logFilter}${A.reset}` : '';
      out.push(
        `${A.amber}logs${A.reset} ${A.bold}${logsTarget.name}${A.reset} ${A.dim}(${logsTarget.groupId}/${logsTarget.serviceId})${A.reset} ${follow ? `${A.green}following${A.reset}` : `${A.dim}paused${A.reset}`}${filterTag}`
      );
      out.push('');
      const needle = logFilter.toLowerCase();
      const visible = needle
        ? logLines.filter((l) => l.toLowerCase().includes(needle))
        : logLines;
      const room = height - 6;
      const end = logScroll === 0 ? visible.length : visible.length - logScroll;
      const slice = visible.slice(Math.max(0, end - room), end);
      for (const line of slice) {
        out.push(line.length > width ? line.slice(0, width - 1) : line);
      }
      if (needle && visible.length === 0) {
        out.push(`${A.dim}No lines matching "${logFilter}".${A.reset}`);
      }
    } else {
      const room = height - 5;
      const start = Math.max(0, Math.min(selected - Math.floor(room / 2), rows.length - room));
      rows.slice(start, start + room).forEach((row, i) => {
        out.push(renderRow(row, start + i === selected, width));
      });
      if (rows.length === 0) {
        out.push(`${A.dim}No groups${filter ? ` matching "${filter}"` : ' configured'}.${A.reset}`);
      }
    }

    const footer: string[] = [];
    if (flash) footer.push(`${A.amber}${flash}${A.reset}`);
    if (mode === 'filter') {
      const editing = filterReturnMode === 'logs' ? logFilter : filter;
      footer.push(`${A.invert} filter: ${editing}▏(enter to apply, esc to clear) ${A.reset}`);
    } else {
      footer.push(renderKeybar(mode === 'logs' ? 'logs' : 'dash', width));
    }

    const body = out.slice(0, height - footer.length - 1);
    while (body.length < height - footer.length - 1) body.push('');
    process.stdout.write(CLEAR + body.join('\n') + '\n' + footer.join('\n'));
  }

  async function act(action: 'run' | 'stop' | 'restart'): Promise<void> {
    const row = rows[selected];
    if (!row) return;
    // A selected service row acts on just that service; a group row on the group.
    const groupId = row.group.id;
    const serviceId = row.kind === 'service' ? row.serviceId : undefined;
    const label = serviceId ? `${groupId}/${serviceId}` : groupId;
    flash = `${action} ${label}…`;
    flashTicks = 3;
    draw();
    try {
      await client[action](groupId, serviceId);
      flash = `${action} ${label} ✓`;
    } catch (err) {
      flash = `${action} ${label} failed: ${err instanceof Error ? err.message : err}`;
    }
    flashTicks = 3;
  }

  async function onKey(key: string): Promise<void> {
    if (key === '\x03') {
      running = false;
      return;
    }

    if (mode === 'filter') {
      const apply = (value: string): void => {
        if (filterReturnMode === 'logs') logFilter = value;
        else filter = value;
      };
      const current = filterReturnMode === 'logs' ? logFilter : filter;
      if (key === '\r') mode = filterReturnMode;
      else if (key === '\x1b') { apply(''); mode = filterReturnMode; }
      else if (key === '\x7f') apply(current.slice(0, -1));
      else if (key >= ' ' && key.length === 1) apply(current + key);
      await refresh();
      return;
    }

    if (mode === 'logs') {
      if (key === 'q') { running = false; return; }
      if (key === '\x1b') { mode = 'dash'; logsTarget = null; logFilter = ''; return; }
      if (key === 'f') { follow = !follow; logScroll = 0; return; }
      if (key === '/') { filterReturnMode = 'logs'; mode = 'filter'; return; }
      if (key === '\x1b[A') { follow = false; logScroll = Math.min(logScroll + 3, Math.max(0, logLines.length - 5)); return; }
      if (key === '\x1b[B') { logScroll = Math.max(0, logScroll - 3); if (logScroll === 0) follow = true; return; }
      return;
    }

    switch (key) {
      case 'q':
        running = false;
        return;
      case '\x1b[A':
        selected = Math.max(0, selected - 1);
        return;
      case '\x1b[B':
        selected = Math.min(rows.length - 1, selected + 1);
        return;
      case '/':
        filterReturnMode = 'dash';
        mode = 'filter';
        return;
      case 'r':
        await act('run');
        return;
      case 's':
        await act('stop');
        return;
      case 'x':
        await act('restart');
        return;
      case 'l': {
        const row = rows[selected];
        if (row?.kind === 'service') {
          logsTarget = { groupId: row.group.id, serviceId: row.serviceId, name: row.name };
          mode = 'logs';
          follow = true;
          logScroll = 0;
          logLines = await client.logs(row.group.id, row.serviceId, 500).catch(() => []);
        }
        return;
      }
    }
  }

  process.stdout.write(ALT_ON);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const cleanup = (): void => {
    process.stdin.setRawMode?.(false);
    process.stdout.write(ALT_OFF);
  };
  process.on('exit', cleanup);

  process.stdin.on('data', (chunk: string) => {
    void onKey(chunk).then(() => {
      if (!running) {
        cleanup();
        process.exit(0);
      }
      draw();
    });
  });

  await refresh();
  draw();
  const timer = setInterval(async () => {
    if (!running) {
      clearInterval(timer);
      return;
    }
    if (flashTicks > 0) {
      flashTicks -= 1;
    } else {
      flash = '';
    }
    await refresh();
    draw();
  }, 1000);
}
