import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { getDevStackWorkspaceFolder } from '../config/workspaceFolder';
import {
  EVENT_SEVERITIES,
  EventDateRange,
  EventFilters,
  EventSeverity,
} from '../monitoring/eventFilters';
import { DevStackEvent, EventTracker, revealEvent } from '../monitoring/eventTracker';
import { ProcessTracker } from '../orchestration/processTracker';

/** Must match package.json contributes.views id exactly. */
export const ISSUES_VIEW_ID = 'devstack.issues';

type IssuesFilters = {
  dateRange: EventDateRange;
  severity: EventSeverity | 'all';
  groupId: string;
  serviceId: string;
  category: string;
};

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setFilters'; filters: unknown }
  | { type: 'clear' }
  | { type: 'reveal'; eventId: string }
  | { type: 'refresh' };

const DEFAULT_FILTERS: IssuesFilters = {
  dateRange: 'all',
  severity: 'all',
  groupId: 'all',
  serviceId: 'all',
  category: 'all',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function normalizeFilters(value: unknown): IssuesFilters {
  if (!isRecord(value)) {
    return { ...DEFAULT_FILTERS };
  }

  const dateRange = ['today', '3d', 'maxDays', 'all'].includes(String(value.dateRange))
    ? (value.dateRange as EventDateRange)
    : DEFAULT_FILTERS.dateRange;
  const severityValue = String(value.severity);
  const severity = severityValue === 'all' || EVENT_SEVERITIES.includes(severityValue as EventSeverity)
    ? (severityValue as EventSeverity | 'all')
    : DEFAULT_FILTERS.severity;

  return {
    dateRange,
    severity,
    groupId: readString(value.groupId, 'all'),
    serviceId: readString(value.serviceId, 'all'),
    category: readString(value.category, 'all'),
  };
}

function getIssuesHtml(webview: vscode.Webview): string {
  const nonce = 'devstack-events-view';
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
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
    html, body { height: 100%; }
    body {
      display: flex;
      flex-direction: column;
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: 12px;
    }
    button, select { font: inherit; }
    .filters {
      flex: 0 0 auto;
      padding: 10px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border));
    }
    .label {
      margin: 0 0 5px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .segments, .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 9px; }
    .segment, .chip {
      min-height: 26px;
      padding: 3px 8px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      color: var(--vscode-foreground);
      background: transparent;
      cursor: pointer;
    }
    .segment:hover, .chip:hover { background: var(--vscode-list-hoverBackground); }
    .segment.active, .chip.active {
      border-color: var(--vscode-focusBorder);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .chip { display: inline-flex; align-items: center; gap: 5px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
    .error .dot, .event.error { --severity-color: var(--vscode-errorForeground); }
    .warning .dot, .event.warning { --severity-color: var(--vscode-editorWarning-foreground, #cca700); }
    .info .dot, .event.info { --severity-color: var(--vscode-editorInfo-foreground, #3794ff); }
    .other .dot, .event.other { --severity-color: var(--vscode-descriptionForeground); }
    .chip .dot { background: var(--severity-color, var(--vscode-descriptionForeground)); }
    .count { opacity: .75; }
    .selects { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    select {
      width: 100%;
      min-width: 0;
      padding: 5px 7px;
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
      border-radius: 2px;
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
    }
    .categories:empty { display: none; }
    .toolbar {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .toolbar button {
      flex: 1;
      padding: 5px 8px;
      border: 0;
      border-radius: 2px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
    }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .summary {
      flex: 0 0 auto;
      padding: 6px 10px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .events { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .date-header {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 6px 10px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background);
      font-weight: 600;
      cursor: pointer;
    }
    .date-body.collapsed { display: none; }
    .event {
      display: grid;
      grid-template-columns: 53px 8px minmax(0, 1fr);
      gap: 7px;
      padding: 7px 10px;
      border-left: 2px solid transparent;
      cursor: pointer;
    }
    .event:hover, .event:focus {
      outline: none;
      border-left-color: var(--severity-color);
      background: var(--vscode-list-hoverBackground);
    }
    .time { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; }
    .event-dot { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--severity-color); }
    .content { min-width: 0; }
    .meta { overflow: hidden; color: var(--vscode-descriptionForeground); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .message { margin-top: 2px; overflow-wrap: anywhere; line-height: 1.35; }
    .badge { margin-left: 4px; padding: 1px 4px; border-radius: 3px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
    .empty { padding: 30px 15px; color: var(--vscode-descriptionForeground); text-align: center; }
  </style>
</head>
<body>
  <section class="filters">
    <p class="label">Date</p>
    <div class="segments" id="dateSegments">
      <button class="segment" data-range="today">Today</button>
      <button class="segment" data-range="3d">3 days</button>
      <button class="segment" data-range="maxDays" id="maxDays">7 days</button>
      <button class="segment" data-range="all">All</button>
    </div>
    <p class="label">Level</p>
    <div class="chips" id="severityChips">
      <button class="chip" data-severity="all">All</button>
      <button class="chip error" data-severity="error"><span class="dot"></span>Error <span class="count" id="errorCount">0</span></button>
      <button class="chip warning" data-severity="warning"><span class="dot"></span>Warning <span class="count" id="warningCount">0</span></button>
      <button class="chip info" data-severity="info"><span class="dot"></span>Info <span class="count" id="infoCount">0</span></button>
      <button class="chip other" data-severity="other"><span class="dot"></span>Other <span class="count" id="otherCount">0</span></button>
    </div>
    <div class="chips categories" id="categoryChips"></div>
    <div class="selects">
      <div><p class="label">Group</p><select id="groupId"><option value="all">All groups</option></select></div>
      <div><p class="label">Service</p><select id="serviceId"><option value="all">All services</option></select></div>
    </div>
  </section>
  <div class="toolbar">
    <button id="refresh">Refresh</button>
    <button id="clear">Clear events</button>
  </div>
  <div class="summary" id="summary">0 events</div>
  <main class="events" id="events"></main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let filters = { dateRange: 'all', severity: 'all', groupId: 'all', serviceId: 'all', category: 'all' };
    let groups = [];
    let categories = [];
    const collapsedDates = new Set();

    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function setActive(selector, attribute, value) {
      document.querySelectorAll(selector).forEach((element) => {
        element.classList.toggle('active', element.dataset[attribute] === value);
      });
    }

    function updateServiceOptions(reset) {
      const serviceSelect = document.getElementById('serviceId');
      const group = groups.find((candidate) => candidate.id === filters.groupId);
      const services = group ? group.services : [];
      const valid = services.some((service) => service.id === filters.serviceId);
      if (reset || !valid) filters.serviceId = 'all';
      serviceSelect.innerHTML = '<option value="all">All services</option>' + services.map((service) =>
        '<option value="' + esc(service.id) + '">' + esc(service.name) + '</option>'
      ).join('');
      serviceSelect.value = filters.serviceId;
    }

    function renderFilters(message) {
      filters = Object.assign({}, filters, message.filters || {});
      groups = message.groupsMeta || [];
      categories = (message.monitoringMeta && message.monitoringMeta.categories) || [];
      document.getElementById('maxDays').textContent = ((message.monitoringMeta && message.monitoringMeta.maxDays) || 7) + ' days';

      const groupSelect = document.getElementById('groupId');
      if (!groups.some((group) => group.id === filters.groupId)) filters.groupId = 'all';
      groupSelect.innerHTML = '<option value="all">All groups</option>' + groups.map((group) =>
        '<option value="' + esc(group.id) + '">' + esc(group.label) + '</option>'
      ).join('');
      groupSelect.value = filters.groupId;
      updateServiceOptions(false);

      if (!categories.includes(filters.category)) filters.category = 'all';
      document.getElementById('categoryChips').innerHTML = categories.length
        ? '<button class="chip' + (filters.category === 'all' ? ' active' : '') + '" data-category="all">All categories</button>' +
          categories.map((category) => '<button class="chip' + (filters.category === category ? ' active' : '') + '" data-category="' + esc(category) + '">' + esc(category) + '</button>').join('')
        : '';

      setActive('.segment', 'range', filters.dateRange);
      setActive('#severityChips .chip', 'severity', filters.severity);
    }

    function dateKey(timestamp) {
      const date = new Date(timestamp);
      return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate();
    }

    function dateLabel(timestamp) {
      const date = new Date(timestamp);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const difference = Math.round((today.getTime() - day.getTime()) / 86400000);
      if (difference === 0) return 'Today';
      if (difference === 1) return 'Yesterday';
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    }

    function formatTime(timestamp) {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function reveal(eventId) {
      vscode.postMessage({ type: 'reveal', eventId });
    }

    function renderEvents(message) {
      const events = message.events || [];
      const counts = message.severityCounts || {};
      document.getElementById('errorCount').textContent = counts.error || 0;
      document.getElementById('warningCount').textContent = counts.warning || 0;
      document.getElementById('infoCount').textContent = counts.info || 0;
      document.getElementById('otherCount').textContent = counts.other || 0;
      document.getElementById('summary').textContent = events.length + (events.length === 1 ? ' event' : ' events');

      const container = document.getElementById('events');
      if (!events.length) {
        container.innerHTML = '<div class="empty">' + (message.hasAnyEvents
          ? 'No events match the selected filters.'
          : 'No events yet. Run a service through DevStack to begin capturing output.') + '</div>';
        return;
      }

      const grouped = new Map();
      events.forEach((event) => {
        const key = dateKey(event.timestamp);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(event);
      });

      container.innerHTML = '';
      grouped.forEach((items, key) => {
        const section = document.createElement('section');
        const header = document.createElement('div');
        const body = document.createElement('div');
        header.className = 'date-header';
        body.className = 'date-body' + (collapsedDates.has(key) ? ' collapsed' : '');
        header.textContent = (collapsedDates.has(key) ? '› ' : '⌄ ') + dateLabel(items[0].timestamp) + ' (' + items.length + ')';
        header.addEventListener('click', () => {
          if (collapsedDates.has(key)) collapsedDates.delete(key); else collapsedDates.add(key);
          body.classList.toggle('collapsed');
          header.textContent = (collapsedDates.has(key) ? '› ' : '⌄ ') + dateLabel(items[0].timestamp) + ' (' + items.length + ')';
        });

        items.forEach((event) => {
          const row = document.createElement('div');
          row.className = 'event ' + event.severity;
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          const category = event.category ? '<span class="badge">' + esc(event.category) + '</span>' : '';
          row.innerHTML = '<span class="time">' + formatTime(event.timestamp) + '</span>' +
            '<span class="event-dot"></span>' +
            '<div class="content"><div class="meta">' + esc(event.groupLabel) + ' / ' + esc(event.serviceName) + category + '<span class="badge">' + esc(event.source) + '</span></div>' +
            '<div class="message">' + esc(event.message) + '</div></div>';
          row.addEventListener('click', () => reveal(event.id));
          row.addEventListener('keydown', (keyboardEvent) => {
            if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') reveal(event.id);
          });
          body.appendChild(row);
        });

        section.appendChild(header);
        section.appendChild(body);
        container.appendChild(section);
      });
    }

    function sendFilters() {
      vscode.postMessage({ type: 'setFilters', filters });
    }

    document.getElementById('dateSegments').addEventListener('click', (event) => {
      const button = event.target.closest('.segment');
      if (!button) return;
      filters.dateRange = button.dataset.range;
      setActive('.segment', 'range', filters.dateRange);
      sendFilters();
    });
    document.getElementById('severityChips').addEventListener('click', (event) => {
      const button = event.target.closest('.chip');
      if (!button) return;
      filters.severity = button.dataset.severity;
      setActive('#severityChips .chip', 'severity', filters.severity);
      sendFilters();
    });
    document.getElementById('categoryChips').addEventListener('click', (event) => {
      const button = event.target.closest('.chip');
      if (!button) return;
      filters.category = button.dataset.category;
      setActive('#categoryChips .chip', 'category', filters.category);
      sendFilters();
    });
    document.getElementById('groupId').addEventListener('change', (event) => {
      filters.groupId = event.target.value;
      updateServiceOptions(true);
      sendFilters();
    });
    document.getElementById('serviceId').addEventListener('change', (event) => {
      filters.serviceId = event.target.value;
      sendFilters();
    });
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'init') renderFilters(message);
      if (message.type === 'init' || message.type === 'update') renderEvents(message);
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export class IssuesViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private disposed = false;
  private filters: IssuesFilters = { ...DEFAULT_FILTERS };
  private readonly eventSubscription: vscode.Disposable;

  constructor(
    private readonly eventTracker: EventTracker,
    private readonly processTracker: ProcessTracker
  ) {
    this.eventSubscription = eventTracker.onDidChange(() => this.pushUpdate());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.disposed = false;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getIssuesHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (this.disposed) {
        return;
      }
      if (message.type === 'ready') {
        this.sendInit();
      } else if (message.type === 'setFilters') {
        this.filters = normalizeFilters(message.filters);
        this.pushUpdate();
      } else if (message.type === 'clear') {
        this.eventTracker.clearEvents();
      } else if (message.type === 'refresh') {
        this.eventTracker.refreshMonitoringConfig();
        this.sendInit();
      } else if (message.type === 'reveal') {
        const selectedEvent = this.eventTracker.getEvents().find((event) => event.id === message.eventId);
        if (selectedEvent) {
          await revealEvent(selectedEvent, this.processTracker);
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendInit();
      }
    });
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    setTimeout(() => this.sendInit(), 100);
  }

  private getGroupsMeta(): Array<{
    id: string;
    label: string;
    services: Array<{ id: string; name: string }>;
  }> {
    try {
      return loadMergedConfig(getDevStackWorkspaceFolder()).groups.map((group) => ({
        id: group.id,
        label: group.label,
        services: group.services.map((service) => ({ id: service.id, name: service.name })),
      }));
    } catch {
      return [];
    }
  }

  private buildPayload(): {
    events: DevStackEvent[];
    severityCounts: Record<EventSeverity, number>;
    hasAnyEvents: boolean;
  } {
    const countFilters: Omit<EventFilters, 'severity'> = {
      dateRange: this.filters.dateRange,
      groupId: this.filters.groupId,
      serviceId: this.filters.serviceId,
      category: this.filters.category,
    };
    return {
      events: this.eventTracker.getFilteredEvents(this.filters),
      severityCounts: this.eventTracker.getSeverityCounts(countFilters),
      hasAnyEvents: this.eventTracker.hasAnyEvents(),
    };
  }

  private sendInit(): void {
    if (!this.view || this.disposed) {
      return;
    }
    const payload = this.buildPayload();
    void this.view.webview.postMessage({
      type: 'init',
      filters: this.filters,
      groupsMeta: this.getGroupsMeta(),
      monitoringMeta: this.eventTracker.getMonitoringMeta(),
      ...payload,
    });
  }

  pushUpdate(): void {
    if (!this.view || this.disposed) {
      return;
    }
    void this.view.webview.postMessage({ type: 'update', ...this.buildPayload() });
  }

  refreshMeta(): void {
    this.sendInit();
  }

  dispose(): void {
    this.disposed = true;
    this.view = undefined;
    this.eventSubscription.dispose();
  }
}

export function registerIssuesView(
  context: vscode.ExtensionContext,
  eventTracker: EventTracker,
  processTracker: ProcessTracker
): IssuesViewProvider {
  const provider = new IssuesViewProvider(eventTracker, processTracker);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(ISSUES_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  return provider;
}
