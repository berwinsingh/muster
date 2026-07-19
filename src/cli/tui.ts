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
  let logScroll = 0; // 0 = pinned to tail
  let follow = true;
  let flash = '';
  let connectionError = '';
  let running = true;

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
      out.push(
        `${A.amber}logs${A.reset} ${A.bold}${logsTarget.name}${A.reset} ${A.dim}(${logsTarget.groupId}/${logsTarget.serviceId})${A.reset} ${follow ? `${A.green}following${A.reset}` : `${A.dim}paused${A.reset}`}`
      );
      out.push('');
      const room = height - 6;
      const end = logScroll === 0 ? logLines.length : logLines.length - logScroll;
      const slice = logLines.slice(Math.max(0, end - room), end);
      for (const line of slice) {
        out.push(line.length > width ? line.slice(0, width - 1) : line);
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
    if (mode === 'filter') footer.push(`${A.invert} filter: ${filter}▏(enter to apply, esc to clear) ${A.reset}`);
    else footer.push(renderKeybar(mode === 'logs' ? 'logs' : 'dash', width));

    const body = out.slice(0, height - footer.length - 1);
    while (body.length < height - footer.length - 1) body.push('');
    process.stdout.write(CLEAR + body.join('\n') + '\n' + footer.join('\n'));
  }

  function selectedGroupId(): string | null {
    const row = rows[selected];
    return row ? row.group.id : null;
  }

  async function act(action: 'run' | 'stop' | 'restart'): Promise<void> {
    const groupId = selectedGroupId();
    if (!groupId) return;
    flash = `${action} ${groupId}…`;
    draw();
    try {
      await client[action](groupId);
      flash = `${action} ${groupId} ✓`;
    } catch (err) {
      flash = `${action} ${groupId} failed: ${err instanceof Error ? err.message : err}`;
    }
  }

  async function onKey(key: string): Promise<void> {
    if (key === '\x03') {
      running = false;
      return;
    }

    if (mode === 'filter') {
      if (key === '\r') mode = 'dash';
      else if (key === '\x1b') { filter = ''; mode = 'dash'; }
      else if (key === '\x7f') filter = filter.slice(0, -1);
      else if (key >= ' ' && key.length === 1) filter += key;
      await refresh();
      return;
    }

    if (mode === 'logs') {
      if (key === 'q') { running = false; return; }
      if (key === '\x1b') { mode = 'dash'; logsTarget = null; return; }
      if (key === 'f') { follow = !follow; logScroll = 0; return; }
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
    if (flash) flash = '';
    await refresh();
    draw();
  }, 1000);
}
