import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { EventTracker, revealEvent } from '../monitoring/eventTracker';
import { ProcessTracker } from '../orchestration/processTracker';

type IssuesFilters = {
  dateRange: 'today' | 'week' | 'all';
  severity: 'error' | 'warning' | 'info' | 'all';
  groupId: string;
  serviceId: string;
};

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setFilters'; filters: IssuesFilters }
  | { type: 'clear' }
  | { type: 'reveal'; eventId: string }
  | { type: 'refresh' };

function getIssuesHtml(webview: vscode.Webview): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-devstack-issues'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DevStack Events</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      margin: 0; padding: 8px;
    }
    .filters {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;
    }
    label { font-size: 0.7rem; color: var(--vscode-descriptionForeground); display: block; margin-bottom: 2px; }
    select {
      width: 100%; padding: 4px 6px; font-size: 0.8rem;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
    }
    .toolbar { display: flex; gap: 6px; margin-bottom: 8px; }
    button {
      flex: 1; padding: 4px 8px; font-size: 0.75rem;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 3px; cursor: pointer;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .count { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
    .events { list-style: none; padding: 0; margin: 0; }
    .event {
      padding: 8px; margin-bottom: 4px; border-radius: 4px; cursor: pointer;
      border-left: 3px solid var(--vscode-panel-border);
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .event:hover { background: var(--vscode-list-hoverBackground); }
    .event.error { border-left-color: var(--vscode-errorForeground); }
    .event.warning { border-left-color: var(--vscode-editorWarning-foreground, #cca700); }
    .event.info { border-left-color: var(--vscode-editorInfo-foreground, #3794ff); }
    .event-meta { font-size: 0.7rem; color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
    .event-msg { font-size: 0.8rem; word-break: break-word; }
    .empty { text-align: center; padding: 24px 8px; color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
    .badge {
      display: inline-block; padding: 0 5px; border-radius: 8px; font-size: 0.65rem;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      margin-left: 4px;
    }
  </style>
</head>
<body>
  <div class="filters">
    <div><label>Date</label><select id="dateRange"><option value="today">Today</option><option value="week">Last 7 days</option><option value="all" selected>All</option></select></div>
    <div><label>Severity</label><select id="severity"><option value="all">All</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select></div>
    <div><label>Group</label><select id="groupId"><option value="all">All groups</option></select></div>
    <div><label>Service</label><select id="serviceId"><option value="all">All services</option></select></div>
  </div>
  <div class="toolbar">
    <button id="refresh">Refresh</button>
    <button id="clear">Clear</button>
  </div>
  <div class="count" id="count"></div>
  <ul class="events" id="events"></ul>
  <div class="empty" id="empty" style="display:none">No events match the current filters.</div>
  <script nonce="devstack-issues">
    const vscode = acquireVsCodeApi();
    let filters = { dateRange: 'all', severity: 'all', groupId: 'all', serviceId: 'all' };
    let groupsMeta = [];

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

    function formatTime(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function renderFilters(meta) {
      groupsMeta = meta || [];
      const groupSel = document.getElementById('groupId');
      const prev = groupSel.value;
      groupSel.innerHTML = '<option value="all">All groups</option>' +
        groupsMeta.map(g => '<option value="' + esc(g.id) + '">' + esc(g.label) + '</option>').join('');
      groupSel.value = prev;

      updateServiceFilter();
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

    function renderEvents(events) {
      const list = document.getElementById('events');
      const empty = document.getElementById('empty');
      const count = document.getElementById('count');
      count.textContent = events.length + ' event' + (events.length !== 1 ? 's' : '');
      list.innerHTML = '';

      if (!events.length) {
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';

      events.forEach(ev => {
        const li = document.createElement('li');
        li.className = 'event ' + ev.severity;
        li.dataset.id = ev.id;
        li.innerHTML =
          '<div class="event-meta">' + formatTime(ev.timestamp) +
          ' · ' + esc(ev.groupLabel) + ' / ' + esc(ev.serviceName) +
          ' <span class="badge">' + esc(ev.source) + '</span></div>' +
          '<div class="event-msg">' + esc(ev.message) + '</div>';
        li.addEventListener('click', () => vscode.postMessage({ type: 'reveal', eventId: ev.id }));
        list.appendChild(li);
      });
    }

    function sendFilters() {
      filters = {
        dateRange: document.getElementById('dateRange').value,
        severity: document.getElementById('severity').value,
        groupId: document.getElementById('groupId').value,
        serviceId: document.getElementById('serviceId').value,
      };
      vscode.postMessage({ type: 'setFilters', filters });
    }

    ['dateRange','severity','groupId','serviceId'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        if (id === 'groupId') updateServiceFilter();
        sendFilters();
      });
    });

    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        renderFilters(msg.groupsMeta);
        renderEvents(msg.events);
      }
      if (msg.type === 'update') {
        renderEvents(msg.events);
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

  private sendInit(): void {
    if (!this.view) {
      return;
    }
    const events = this.eventTracker.getFilteredEvents(this.filters);
    this.view.webview.postMessage({
      type: 'init',
      groupsMeta: this.getGroupsMeta(),
      events,
    });
  }

  pushUpdate(): void {
    if (!this.view?.visible) {
      return;
    }
    const events = this.eventTracker.getFilteredEvents(this.filters);
    this.view.webview.postMessage({ type: 'update', events });
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
