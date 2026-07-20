/**
 * The interactive `muster` dashboard: a full-screen terminal UI over any
 * DashboardSource — the extension's IPC API (remote) or a local headless
 * Supervisor (`muster up`). Poll-driven (1s), zero deps — hand-rolled ANSI
 * on the alternate screen buffer. Operated three ways: hotkeys, mouse
 * (click rows and footer buttons, scroll wheel), and a fuzzy command
 * palette (:) where you type what you want ("stop web").
 */
import type { CliGroup, CliGroupStatus } from './client';
import { buildActions, matchActions, PaletteAction } from './palette';
import {
  A,
  Button,
  buildRows,
  renderButtons,
  renderHeader,
  renderRow,
  truncateAnsi,
  Row,
} from './render';

/** What the dashboard needs from a backend; IpcClient satisfies this. */
export interface DashboardSource {
  readonly workspace: string;
  groups(): Promise<CliGroup[]>;
  status(groupId: string): Promise<CliGroupStatus>;
  logs(groupId: string, serviceId: string, lines?: number): Promise<string[]>;
  run(groupId: string, serviceId?: string): Promise<unknown>;
  stop(groupId: string, serviceId?: string): Promise<unknown>;
  restart(groupId: string, serviceId?: string): Promise<unknown>;
}

export type TuiOptions = {
  /** Feed opened by `l` on a group row (the headless narrator log). */
  groupFeedId?: string;
  /** Quit button label ("quit (stops all)" when quitting tears down). */
  quitLabel?: string;
  /** Persistent activity line shown above the footer. */
  statusLine?: () => string;
  /** Awaited after the screen is restored, before exit (teardown). */
  onQuit?: () => Promise<void>;
};

const ALT_ON = '\x1b[?1049h\x1b[?25l';
const ALT_OFF = '\x1b[?25h\x1b[?1049l';
const MOUSE_ON = '\x1b[?1002h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l';
const CLEAR = '\x1b[2J\x1b[H';
const MOUSE_EVENT = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

type Mode = 'dash' | 'filter' | 'logs' | 'palette';

export async function runTui(source: DashboardSource, opts: TuiOptions = {}): Promise<void> {
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
  // palette state
  let paletteQuery = '';
  let paletteIndex = 0;
  let paletteMatches: PaletteAction[] = [];
  // layout metadata from the last draw, for mouse hit-testing (1-based rows)
  let rowsTopY = 0;
  let rowsStartIndex = 0;
  let footerButtons: Button[] = [];
  let footerY = 0;

  const statuses = new Map<string, CliGroupStatus>();

  async function refresh(): Promise<void> {
    try {
      const groups = await source.groups();
      await Promise.all(
        groups.map(async (g) => {
          try {
            statuses.set(g.id, await source.status(g.id));
          } catch {
            // group may not have run yet
          }
        })
      );
      rows = buildRows(groups, statuses, filter);
      if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
      if (mode === 'logs' && logsTarget && follow) {
        logLines = await source.logs(logsTarget.groupId, logsTarget.serviceId, 500);
      }
      connectionError = '';
    } catch (err) {
      connectionError = String(err instanceof Error ? err.message : err);
    }
  }

  function draw(): void {
    // `||`, not `??`: some PTYs (tmux edge cases, CI) report 0×0.
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    const out: string[] = [];

    out.push(renderHeader(source.workspace, filter, width));
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
    } else if (mode === 'palette') {
      out.push(`${A.invert} : ${paletteQuery}▏${A.reset} ${A.dim}(type an action — "stop web" — enter to run, esc to cancel)${A.reset}`);
      out.push('');
      paletteMatches.forEach((match, i) => {
        const marker = i === paletteIndex ? `${A.amber}▸${A.reset} ` : '  ';
        const label = i === paletteIndex ? `${A.bold}${match.label}${A.reset}` : match.label;
        out.push(`${marker}${label}`);
      });
      if (paletteMatches.length === 0) {
        out.push(`${A.dim}No matching actions.${A.reset}`);
      }
    } else {
      const room = height - 5;
      const start = Math.max(0, Math.min(selected - Math.floor(room / 2), rows.length - room));
      rowsTopY = 3; // header line + blank line, 1-based
      rowsStartIndex = start;
      rows.slice(start, start + room).forEach((row, i) => {
        out.push(renderRow(row, start + i === selected, width));
      });
      if (rows.length === 0) {
        out.push(`${A.dim}No groups${filter ? ` matching "${filter}"` : ' configured'}.${A.reset}`);
      }
    }

    const footer: string[] = [];
    if (opts.statusLine && mode !== 'filter' && mode !== 'palette') {
      const activity = opts.statusLine();
      if (activity) footer.push(truncateAnsi(`${A.dim}‣${A.reset} ${activity}`, width));
    }
    if (flash) footer.push(`${A.amber}${flash}${A.reset}`);
    if (mode === 'filter') {
      const editing = filterReturnMode === 'logs' ? logFilter : filter;
      footer.push(`${A.invert} filter: ${editing}▏(enter to apply, esc to clear) ${A.reset}`);
      footerButtons = [];
    } else if (mode === 'palette') {
      footer.push(`${A.dim}↑↓ choose · enter run · esc cancel${A.reset}`);
      footerButtons = [];
    } else {
      const bar = renderButtons(mode === 'logs' ? 'logs' : 'dash', width, opts.quitLabel);
      footer.push(bar.line);
      footerButtons = bar.buttons;
    }

    const body = out.slice(0, height - footer.length - 1);
    while (body.length < height - footer.length - 1) body.push('');
    footerY = height - 1; // the button bar always lands on the last drawn row
    process.stdout.write(CLEAR + body.join('\n') + '\n' + footer.join('\n'));
  }

  async function performAction(
    action: 'run' | 'stop' | 'restart',
    groupId: string,
    serviceId?: string
  ): Promise<void> {
    const label = serviceId ? `${groupId}/${serviceId}` : groupId;
    flash = `${action} ${label}…`;
    flashTicks = 3;
    draw();
    try {
      await source[action](groupId, serviceId);
      flash = `${action} ${label} ✓`;
    } catch (err) {
      flash = `${action} ${label} failed: ${err instanceof Error ? err.message : err}`;
    }
    flashTicks = 3;
  }

  async function act(action: 'run' | 'stop' | 'restart'): Promise<void> {
    const row = rows[selected];
    if (!row) return;
    // A selected service row acts on just that service; a group row on the group.
    await performAction(action, row.group.id, row.kind === 'service' ? row.serviceId : undefined);
  }

  async function openLogs(groupId: string, serviceId: string, name: string): Promise<void> {
    logsTarget = { groupId, serviceId, name };
    mode = 'logs';
    follow = true;
    logScroll = 0;
    logFilter = '';
    logLines = await source.logs(groupId, serviceId, 500).catch(() => []);
  }

  async function executePaletteAction(action: PaletteAction): Promise<void> {
    mode = 'dash';
    paletteQuery = '';
    switch (action.kind) {
      case 'run':
      case 'stop':
      case 'restart':
        await performAction(action.kind, action.groupId!, action.serviceId);
        return;
      case 'logs':
        await openLogs(action.groupId!, action.serviceId!, action.serviceId!);
        return;
      case 'filter-clear':
        filter = '';
        await refresh();
        return;
      case 'quit':
        running = false;
        return;
    }
  }

  async function handleMouse(button: number, x: number, y: number, isPress: boolean): Promise<void> {
    // Scroll wheel works in every mode.
    if (button === 64 || button === 65) {
      const delta = button === 64 ? -1 : 1;
      if (mode === 'logs') {
        if (delta < 0) { follow = false; logScroll = Math.min(logScroll + 3, Math.max(0, logLines.length - 5)); }
        else { logScroll = Math.max(0, logScroll - 3); if (logScroll === 0) follow = true; }
      } else if (mode === 'dash') {
        selected = Math.max(0, Math.min(rows.length - 1, selected + delta));
      }
      return;
    }

    if (!isPress || button !== 0) {
      return;
    }

    // Footer buttons behave like their hotkeys, in any buttoned mode.
    if (y === footerY) {
      const hit = footerButtons.find((b) => x >= b.x1 && x <= b.x2);
      if (hit) {
        await onKey(hit.key);
      }
      return;
    }

    // Clicking a dashboard row selects it; clicking the selected row's
    // service opens its logs (click-to-drill).
    if (mode === 'dash') {
      const index = rowsStartIndex + (y - rowsTopY);
      if (index >= 0 && index < rows.length && y >= rowsTopY) {
        if (index === selected) {
          await onKey('l'); // drill into logs (service, or group feed if any)
        } else {
          selected = index;
        }
      }
    }
  }

  async function onKey(key: string): Promise<void> {
    if (key === '\x03') {
      running = false;
      return;
    }

    if (mode === 'palette') {
      const refreshMatches = (): void => {
        paletteMatches = matchActions(buildActions(rows, filter.length > 0), paletteQuery);
        paletteIndex = Math.min(paletteIndex, Math.max(0, paletteMatches.length - 1));
      };
      if (key === '\x1b') { mode = 'dash'; paletteQuery = ''; return; }
      if (key === '\r') {
        const chosen = paletteMatches[paletteIndex];
        if (chosen) await executePaletteAction(chosen);
        return;
      }
      if (key === '\x1b[A') { paletteIndex = Math.max(0, paletteIndex - 1); return; }
      if (key === '\x1b[B') { paletteIndex = Math.min(paletteMatches.length - 1, paletteIndex + 1); return; }
      if (key === '\x7f') { paletteQuery = paletteQuery.slice(0, -1); refreshMatches(); return; }
      // Multi-char chunks are pasted text; anything with ESC is a key sequence.
      if (key >= ' ' && !key.includes('\x1b')) { paletteQuery += key; refreshMatches(); return; }
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
      else if (key >= ' ' && !key.includes('\x1b')) apply(current + key);
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
      case ':':
        mode = 'palette';
        paletteQuery = '';
        paletteIndex = 0;
        paletteMatches = matchActions(buildActions(rows, filter.length > 0), '');
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
          await openLogs(row.group.id, row.serviceId, row.name);
        } else if (row?.kind === 'group' && opts.groupFeedId) {
          await openLogs(row.group.id, opts.groupFeedId, 'muster');
        }
        return;
      }
    }
  }

  process.stdout.write(ALT_ON + MOUSE_ON);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const cleanup = (): void => {
    process.stdin.setRawMode?.(false);
    process.stdout.write(MOUSE_OFF + ALT_OFF);
  };
  process.on('exit', cleanup);

  let quitting = false;
  const quit = async (): Promise<void> => {
    if (quitting) return;
    quitting = true;
    cleanup();
    if (opts.onQuit) {
      process.stdout.write(`${A.amber}[muster]${A.reset} shutting down…\n`);
      await opts.onQuit();
    }
    process.exit(0);
  };

  async function onInput(chunk: string): Promise<void> {
    // A chunk may carry several mouse events, a mouse event plus keys, or
    // a plain key sequence. Mouse events are consumed first; whatever is
    // left is treated as one key chord.
    let remaining = chunk;
    while (remaining.length > 0) {
      const mouse = MOUSE_EVENT.exec(remaining);
      if (mouse) {
        await handleMouse(
          parseInt(mouse[1], 10),
          parseInt(mouse[2], 10),
          parseInt(mouse[3], 10),
          mouse[4] === 'M'
        );
        remaining = remaining.slice(mouse[0].length);
        continue;
      }
      await onKey(remaining);
      return;
    }
  }

  process.stdin.on('data', (chunk: string) => {
    void onInput(chunk).then(async () => {
      if (!running) {
        await quit();
        return;
      }
      if (!quitting) draw();
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
