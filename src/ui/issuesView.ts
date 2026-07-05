import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { DevStackEvent, EventTracker, revealEvent } from '../monitoring/eventTracker';
import { ProcessTracker } from '../orchestration/processTracker';

type IssuesFilters = {
  dateRange: 'today' | '3d' | 'maxDays' | 'all';
  severity: 'error' | 'warning' | 'info' | 'all';
  groupId: string;
  serviceId: string;
  category: string;
};

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setFilters'; filters: IssuesFilters }
  | { type: 'clear' }
  | { type: 'reveal'; eventId: string }
  | { type: 'refresh' };

function getIssuesHtml(webview: vscode.Webview): string {
  const codiconsUri = 'https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css';
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net`,
    `font-src ${webview.cspSource} https://cdn.jsdelivr.net`,
    `script-src 'nonce-devstack-issues'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DevStack Events</title>
  <link rel="stylesheet" href="${codiconsUri}" />
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      margin: 0;
      padding: 0;
      line-height: 1.45;
    }
    .panel-header {
      padding: 12px 12px 0;
    }
    .panel-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 10px;
    }
    .filter-section {
      padding: 0 12px 10px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .segmented {
      display: flex;
      gap: 2px;
      padding: 2px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border);
      margin-bottom: 10px;
    }
    .segment {
      flex: 1;
      padding: 4px 6px;
      font-size: 11px;
      font-family: inherit;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      transition: background 0.15s ease, color 0.15s ease;
    }
    .segment:hover { color: var(--vscode-foreground); }
    .segment.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .severity-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .sev-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid var(--vscode-widget-border);
      background: transparent;
      color: var(--vscode-foreground);
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .sev-chip:hover { background: var(--vscode-list-hoverBackground); }
    .sev-chip.active { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
    .sev-chip .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .sev-chip.error .dot { background: var(--vscode-errorForeground); }
    .sev-chip.warning .dot { background: var(--vscode-editorWarning-foreground, #cca700); }
    .sev-chip.info .dot { background: var(--vscode-editorInfo-foreground, #3794ff); }
    .sev-chip.all .dot { background: var(--vscode-descriptionForeground); }
    .sev-count {
      font-size: 10px;
      opacity: 0.75;
      min-width: 14px;
      text-align: center;
    }
    .category-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .category-chips.hidden { display: none; }
    .cat-chip {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid var(--vscode-widget-border);
      background: transparent;
      color: var(--vscode-descriptionForeground);
    }
    .cat-chip.active {
      color: var(--vscode-foreground);
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-badge-background);
    }
    .select-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 8px;
    }
    label {
      display: block;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 3px;
    }
    select {
      width: 100%;
      padding: 5px 8px;
      font-size: 12px;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
    }
    select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }
    .toolbar {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .toolbar button {
      flex: 1;
      padding: 5px 10px;
      font-size: 11px;
      font-family: inherit;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .events-scroll {
      overflow-y: auto;
      max-height: calc(100vh - 280px);
      padding: 4px 0;
    }
    .date-group { margin-bottom: 2px; }
    .date-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
      position: sticky;
      top: 0;
      background: var(--vscode-sideBar-background);
      z-index: 1;
    }
    .date-header:hover { color: var(--vscode-foreground); }
    .date-header .chevron {
      font-size: 12px;
      transition: transform 0.2s ease;
    }
    .date-group.expanded .date-header .chevron { transform: rotate(90deg); }
    .date-body { display: none; }
    .date-group.expanded .date-body { display: block; }
    .event-row {
      display: grid;
      grid-template-columns: 52px 10px 1fr;
      gap: 8px;
      align-items: start;
      padding: 7px 12px 7px 16px;
      cursor: pointer;
      border-left: 2px solid transparent;
      transition: background 0.12s ease;
    }
    .event-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .event-time {
      font-size: 10px;
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      padding-top: 2px;
    }
    .event-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 5px;
      flex-shrink: 0;
    }
    .event-row.error .event-dot { background: var(--vscode-errorForeground); }
    .event-row.warning .event-dot { background: var(--vscode-editorWarning-foreground, #cca700); }
    .event-row.info .event-dot { background: var(--vscode-editorInfo-foreground, #3794ff); }
    .event-content { min-width: 0; }
    .event-meta {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event-msg {
      font-size: 12px;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .event-badge {
      display: inline-block;
      padding: 0 4px;
      border-radius: 3px;
      font-size: 9px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-left: 4px;
      vertical-align: middle;
    }
    .empty {
      text-align: center;
      padding: 32px 16px;
      color: var(--vscode-descriptionForeground);
    }
    .empty .codicon { font-size: 28px; opacity: 0.5; display: block; margin-bottom: 8px; }
    .empty p { margin: 0; font-size: 12px; }
    .summary {
      padding: 6px 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-widget-border);
    }
  </style>
</head>
<body>
  <div class="panel-header">
    <p class="panel-title">Events</p>
  </div>
  <div class="filter-section">
    <div class="segmented" id="dateSegments">
      <button type="button" class="segment" data-range="today">Today</button>
      <button type="button" class="segment" data-range="3d">3d</button>
      <button type="button" class="segment" data-range="maxDays" id="maxDaysSegment">7d</button>
      <button type="button" class="segment active" data-range="all">All</button>
    </div>
    <div class="severity-chips" id="severityChips">
      <button type="button" class="sev-chip all active" data-severity="all"><span class="dot"></span>All</button>
      <button type="button" class="sev-chip error" data-severity="error"><span class="dot"></span>Error <span class="sev-count" id="countError">0</span></button>
      <button type="button" class="sev-chip warning" data-severity="warning"><span class="dot"></span>Warn <span class="sev-count" id="countWarning">0</span></button>
      <button type="button" class="sev-chip info" data-severity="info"><span class="dot"></span>Info <span class="sev-count" id="countInfo">0</span></button>
    </div>
    <div class="category-chips hidden" id="categoryChips"></div>
    <div class="select-row">
      <div><label>Group</label><select id="groupId"><option value="all">All groups</option></select></div>
      <div><label>Service</label><select id="serviceId"><option value="all">All services</option></select></div>
    </div>
  </div>
  <div class="toolbar">
    <button id="refresh"><span class="codicon codicon-refresh"></span> Refresh</button>
    <button id="clear"><span class="codicon codicon-clear-all"></span> Clear</button>
  </div>
  <div class="summary" id="summary"></div>
  <div class="events-scroll" id="eventsScroll"></div>
  <div class="empty" id="empty" style="display:none">
    <span class="codicon codicon-pass"></span>
    <p id="emptyMessage">No events match the current filters.</p>
  </div>
  <script nonce="devstack-issues">
    const vscode = acquireVsCodeApi();
    let filters = { dateRange: 'all', severity: 'all', groupId: 'all', serviceId: 'all', category: 'all' };
    let groupsMeta = [];
    let maxDays = 7;
    let categories = [];
    let collapsedDates = new Set();

    function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

    function formatTime(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function dateLabel(ts) {
      const d = new Date(ts);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diff = (today - eventDay) / (24 * 60 * 60 * 1000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Yesterday';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function dateKey(ts) {
      const d = new Date(ts);
      return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }

    function renderFilters(meta, metaInfo) {
      groupsMeta = meta || [];
      maxDays = metaInfo?.maxDays ?? 7;
      categories = metaInfo?.categories ?? [];

      document.getElementById('maxDaysSegment').textContent = maxDays + 'd';

      const groupSel = document.getElementById('groupId');
      const prev = groupSel.value;
      groupSel.innerHTML = '<option value="all">All groups</option>' +
        groupsMeta.map(g => '<option value="' + esc(g.id) + '">' + esc(g.label) + '</option>').join('');
      groupSel.value = prev;
      updateServiceFilter();

      const catContainer = document.getElementById('categoryChips');
      if (categories.length) {
        catContainer.classList.remove('hidden');
        catContainer.innerHTML =
          '<button type="button" class="cat-chip' + (filters.category === 'all' ? ' active' : '') + '" data-category="all">All</button>' +
          categories.map(c =>
            '<button type="button" class="cat-chip' + (filters.category === c ? ' active' : '') + '" data-category="' + esc(c) + '">' + esc(c) + '</button>'
          ).join('');
      } else {
        catContainer.classList.add('hidden');
        catContainer.innerHTML = '';
      }

      document.querySelectorAll('.segment').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === filters.dateRange);
      });
      document.querySelectorAll('.sev-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.severity === filters.severity);
      });
    }

    function updateServiceFilter() {
      const groupSel = document.getElementById('groupId');
      const serviceSel = document.getElementById('serviceId');
      const prev = serviceSel.value;
      const group = groupsMeta.find(g => g.id === groupSel.value);
      serviceSel.innerHTML = '<option value="all">All services</option>' +
        (group ? group.services.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') : '');
      serviceSel.value = prev;
    }

    function renderEvents(events, counts, hasAnyEvents) {
      const scroll = document.getElementById('eventsScroll');
      const empty = document.getElementById('empty');
      const summary = document.getElementById('summary');
      const emptyMessage = document.getElementById('emptyMessage');

      document.getElementById('countError').textContent = counts?.error ?? 0;
      document.getElementById('countWarning').textContent = counts?.warning ?? 0;
      document.getElementById('countInfo').textContent = counts?.info ?? 0;

      summary.textContent = events.length + ' event' + (events.length !== 1 ? 's' : '');
      scroll.innerHTML = '';

      if (!events.length) {
        empty.style.display = 'block';
        scroll.style.display = 'none';
        emptyMessage.textContent = hasAnyEvents
          ? 'No events match the current filters.'
          : 'No events yet — output capture starts when you Run a group via DevStack.';
        return;
      }
      empty.style.display = 'none';
      scroll.style.display = 'block';

      const grouped = new Map();
      events.forEach(ev => {
        const key = dateKey(ev.timestamp);
        if (!grouped.has(key)) grouped.set(key, { label: dateLabel(ev.timestamp), events: [] });
        grouped.get(key).events.push(ev);
      });

      grouped.forEach((group, key) => {
        const isToday = group.label === 'Today';
        const expanded = isToday || !collapsedDates.has(key);
        const section = document.createElement('div');
        section.className = 'date-group' + (expanded ? ' expanded' : '');
        section.dataset.dateKey = key;

        const header = document.createElement('div');
        header.className = 'date-header';
        header.innerHTML =
          '<span class="chevron codicon codicon-chevron-right"></span>' +
          '<span>' + esc(group.label) + '</span>' +
          '<span style="opacity:0.6;font-weight:400;margin-left:4px">(' + group.events.length + ')</span>';
        header.addEventListener('click', () => {
          if (section.classList.contains('expanded')) {
            section.classList.remove('expanded');
            collapsedDates.add(key);
          } else {
            section.classList.add('expanded');
            collapsedDates.delete(key);
          }
        });

        const body = document.createElement('div');
        body.className = 'date-body';

        group.events.forEach(ev => {
          const row = document.createElement('div');
          row.className = 'event-row ' + ev.severity;
          row.dataset.id = ev.id;
          const catBadge = ev.category ? '<span class="event-badge">' + esc(ev.category) + '</span>' : '';
          row.innerHTML =
            '<span class="event-time">' + formatTime(ev.timestamp) + '</span>' +
            '<span class="event-dot"></span>' +
            '<div class="event-content">' +
              '<div class="event-meta">' + esc(ev.groupLabel) + ' / ' + esc(ev.serviceName) + catBadge +
              ' <span class="event-badge">' + esc(ev.source) + '</span></div>' +
              '<div class="event-msg">' + esc(ev.message) + '</div>' +
            '</div>';
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'reveal', eventId: ev.id });
          });
          body.appendChild(row);
        });

        section.appendChild(header);
        section.appendChild(body);
        scroll.appendChild(section);
      });
    }

    function sendFilters() {
      vscode.postMessage({ type: 'setFilters', filters });
    }

    document.getElementById('dateSegments').addEventListener('click', (e) => {
      const btn = e.target.closest('.segment');
      if (!btn) return;
      filters.dateRange = btn.dataset.range;
      document.querySelectorAll('.segment').forEach(b => b.classList.toggle('active', b === btn));
      sendFilters();
    });

    document.getElementById('severityChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.sev-chip');
      if (!btn) return;
      filters.severity = btn.dataset.severity;
      document.querySelectorAll('.sev-chip').forEach(b => b.classList.toggle('active', b === btn));
      sendFilters();
    });

    document.getElementById('categoryChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-chip');
      if (!btn) return;
      filters.category = btn.dataset.category;
      document.querySelectorAll('.cat-chip').forEach(b => b.classList.toggle('active', b === btn));
      sendFilters();
    });

    document.getElementById('groupId').addEventListener('change', () => {
      filters.groupId = document.getElementById('groupId').value;
      updateServiceFilter();
      sendFilters();
    });

    document.getElementById('serviceId').addEventListener('change', () => {
      filters.serviceId = document.getElementById('serviceId').value;
      sendFilters();
    });

    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        renderFilters(msg.groupsMeta, msg.monitoringMeta);
        renderEvents(msg.events, msg.severityCounts, msg.hasAnyEvents);
      }
      if (msg.type === 'update') {
        renderEvents(msg.events, msg.severityCounts, msg.hasAnyEvents);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export class IssuesViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private filters: IssuesFilters = {
    dateRange: 'all',
    severity: 'all',
    groupId: 'all',
    serviceId: 'all',
    category: 'all',
  };

  constructor(
    private readonly eventTracker: EventTracker,
    private readonly processTracker: ProcessTracker
  ) {
    eventTracker.onDidChange(() => this.pushUpdate());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getIssuesHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.type === 'ready') {
        this.sendInit();
        return;
      }
      if (msg.type === 'setFilters') {
        this.filters = msg.filters;
        this.pushUpdate();
        return;
      }
      if (msg.type === 'clear') {
        this.eventTracker.clearEvents();
        return;
      }
      if (msg.type === 'refresh') {
        this.eventTracker.refreshMonitoringConfig();
        this.pushUpdate();
        return;
      }
      if (msg.type === 'reveal') {
        const event = this.eventTracker.getEvents().find((e) => e.id === msg.eventId);
        if (event) {
          await revealEvent(event, this.processTracker);
        }
      }
    });
  }

  private getGroupsMeta(): Array<{ id: string; label: string; services: Array<{ id: string; name: string }> }> {
    try {
      const config = loadMergedConfig(vscode.workspace.workspaceFolders?.[0]);
      return config.groups.map((g) => ({
        id: g.id,
        label: g.label,
        services: g.services.map((s) => ({ id: s.id, name: s.name })),
      }));
    } catch {
      return [];
    }
  }

  private buildPayload(): {
    events: DevStackEvent[];
    severityCounts: Record<'error' | 'warning' | 'info', number>;
    hasAnyEvents: boolean;
  } {
    const severityCounts = this.eventTracker.getSeverityCounts({
      dateRange: this.filters.dateRange,
      groupId: this.filters.groupId,
      serviceId: this.filters.serviceId,
      category: this.filters.category,
    });
    const events = this.eventTracker.getFilteredEvents(this.filters);
    return { events, severityCounts, hasAnyEvents: this.eventTracker.hasAnyEvents() };
  }

  private sendInit(): void {
    if (!this.view) {
      return;
    }
    const { events, severityCounts, hasAnyEvents } = this.buildPayload();
    this.view.webview.postMessage({
      type: 'init',
      groupsMeta: this.getGroupsMeta(),
      monitoringMeta: this.eventTracker.getMonitoringMeta(),
      events,
      severityCounts,
      hasAnyEvents,
    });
  }

  pushUpdate(): void {
    if (!this.view?.visible) {
      return;
    }
    const { events, severityCounts, hasAnyEvents } = this.buildPayload();
    this.view.webview.postMessage({ type: 'update', events, severityCounts, hasAnyEvents });
  }

  refreshMeta(): void {
    if (this.view?.visible) {
      this.sendInit();
    }
  }
}

export function registerIssuesView(
  context: vscode.ExtensionContext,
  eventTracker: EventTracker,
  processTracker: ProcessTracker
): IssuesViewProvider {
  const provider = new IssuesViewProvider(eventTracker, processTracker);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('devstack.issues', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  return provider;
}
