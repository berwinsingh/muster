import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { MonitoringConfig } from '../config/schema';
import { ProcessTracker } from '../orchestration/processTracker';
import {
  compilePatterns,
  diagnosticSeverityToEventSeverity,
  resolveMonitoringConfig,
} from './patterns';
import { matchTerminalLine } from './matchLine';
import { getDevStackWorkspaceFolder } from '../config/workspaceFolder';

export type DevStackEvent = {
  id: string;
  timestamp: number;
  groupId: string;
  serviceId: string;
  groupLabel: string;
  serviceName: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: 'terminal' | 'diagnostics';
  patternId?: string;
  category?: string;
  location?: {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  };
};

const MAX_EVENTS = 500;

export class EventTracker implements vscode.Disposable {
  private readonly events: DevStackEvent[] = [];
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private eventCounter = 0;
  private monitoring: MonitoringConfig | undefined;

  constructor(tracker: ProcessTracker) {
    this.disposables.push(
      tracker.onDidAppendOutput(({ groupId, serviceId, line }) => {
        this.processTerminalLine(groupId, serviceId, line);
      }),
      vscode.languages.onDidChangeDiagnostics(() => {
        this.processDiagnostics();
      })
    );

    this.refreshMonitoringConfig();
    this.processDiagnostics();
  }

  refreshMonitoringConfig(): void {
    try {
      const config = loadMergedConfig(getDevStackWorkspaceFolder());
      this.monitoring = config.monitoring;
    } catch {
      this.monitoring = undefined;
    }
  }

  private nextId(): string {
    this.eventCounter += 1;
    return `evt-${Date.now()}-${this.eventCounter}`;
  }

  private getServiceMeta(
    groupId: string,
    serviceId: string
  ): { groupLabel: string; serviceName: string } {
    try {
      const config = loadMergedConfig(getDevStackWorkspaceFolder());
      const group = config.groups.find((g) => g.id === groupId);
      const service = group?.services.find((s) => s.id === serviceId);
      return {
        groupLabel: group?.label ?? groupId,
        serviceName: service?.name ?? serviceId,
      };
    } catch {
      return { groupLabel: groupId, serviceName: serviceId };
    }
  }

  private addEvent(event: Omit<DevStackEvent, 'id'>): void {
    this.events.unshift({ ...event, id: this.nextId() });
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    this.onDidChangeEmitter.fire();
  }

  private processTerminalLine(groupId: string, serviceId: string, line: string): void {
    const resolved = resolveMonitoringConfig(this.monitoring);
    const patterns = compilePatterns(
      resolved.patterns.filter((p) => p.sources.includes('terminal'))
    );

    const bestMatch = matchTerminalLine(line, patterns);
    if (!bestMatch) {
      return;
    }

    const meta = this.getServiceMeta(groupId, serviceId);
    this.addEvent({
      timestamp: Date.now(),
      groupId,
      serviceId,
      groupLabel: meta.groupLabel,
      serviceName: meta.serviceName,
      severity: bestMatch.severity,
      message: line.trim(),
      source: 'terminal',
      patternId: bestMatch.id,
      category: bestMatch.category,
    });
  }

  private processDiagnostics(): void {
    const resolved = resolveMonitoringConfig(this.monitoring);
    if (!resolved.includeDiagnostics) {
      return;
    }

    const folder = getDevStackWorkspaceFolder();
    if (!folder) {
      return;
    }

    // Replace prior diagnostic events on each refresh
    const terminalEvents = this.events.filter((e) => e.source === 'terminal');
    this.events.length = 0;
    this.events.push(...terminalEvents);

    let config;
    try {
      config = loadMergedConfig(folder);
    } catch {
      return;
    }

    for (const group of config.groups) {
      for (const service of group.services) {
        const cwd = service.cwd ?? folder.uri.fsPath;
        const uri = vscode.Uri.file(cwd);
        const diagnostics = vscode.languages.getDiagnostics(uri);

        for (const diag of diagnostics) {
          const severity = diagnosticSeverityToEventSeverity(diag.severity);
          if (!severity) {
            continue;
          }

          this.addEvent({
            timestamp: Date.now(),
            groupId: group.id,
            serviceId: service.id,
            groupLabel: group.label,
            serviceName: service.name,
            severity,
            message: diag.message,
            source: 'diagnostics',
            location: {
              uri: uri.fsPath,
              range: {
                start: diag.range.start,
                end: diag.range.end,
              },
            },
          });
        }
      }
    }
  }

  getEvents(): DevStackEvent[] {
    return [...this.events];
  }

  hasAnyEvents(): boolean {
    return this.events.length > 0;
  }

  getFilteredEvents(filters: {
    dateRange?: 'today' | '3d' | 'maxDays' | 'all';
    severity?: 'error' | 'warning' | 'info' | 'all';
    groupId?: string;
    serviceId?: string;
    category?: string;
  }): DevStackEvent[] {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const maxDays = resolveMonitoringConfig(this.monitoring).maxDays;

    return this.events.filter((event) => {
      const age = now - event.timestamp;
      if (filters.dateRange === 'today' && age > dayMs) {
        return false;
      }
      if (filters.dateRange === '3d' && age > 3 * dayMs) {
        return false;
      }
      if (filters.dateRange === 'maxDays' && age > maxDays * dayMs) {
        return false;
      }
      if (filters.severity && filters.severity !== 'all' && event.severity !== filters.severity) {
        return false;
      }
      if (filters.groupId && filters.groupId !== 'all' && event.groupId !== filters.groupId) {
        return false;
      }
      if (filters.serviceId && filters.serviceId !== 'all' && event.serviceId !== filters.serviceId) {
        return false;
      }
      if (filters.category && filters.category !== 'all') {
        if (!event.category || event.category !== filters.category) {
          return false;
        }
      }
      return true;
    });
  }

  getMonitoringMeta(): { maxDays: number; categories: string[] } {
    const resolved = resolveMonitoringConfig(this.monitoring);
    const categories = [
      ...new Set(
        resolved.patterns
          .map((p) => p.category)
          .filter((c): c is string => Boolean(c))
      ),
    ].sort();
    return { maxDays: resolved.maxDays, categories };
  }

  getSeverityCounts(
    filters: Omit<Parameters<EventTracker['getFilteredEvents']>[0], 'severity'>
  ): Record<'error' | 'warning' | 'info', number> {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const event of this.getFilteredEvents({ ...filters, severity: 'all' })) {
      counts[event.severity] += 1;
    }
    return counts;
  }

  getServiceEventCount(
    groupId: string,
    serviceId: string,
    severity?: 'error' | 'warning' | 'info'
  ): number {
    return this.events.filter((e) => {
      if (e.groupId !== groupId || e.serviceId !== serviceId) {
        return false;
      }
      if (severity && e.severity !== severity) {
        return false;
      }
      return true;
    }).length;
  }

  clearEvents(): void {
    this.events.length = 0;
    this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.onDidChangeEmitter.dispose();
  }
}

export async function revealEvent(event: DevStackEvent, tracker: ProcessTracker): Promise<void> {
  if (event.source === 'diagnostics' && event.location) {
    const uri = vscode.Uri.file(event.location.uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(
      event.location.range.start.line,
      event.location.range.start.character,
      event.location.range.end.line,
      event.location.range.end.character
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    return;
  }

  const tracked = tracker.getService(event.groupId, event.serviceId);
  if (tracked?.terminal) {
    tracked.terminal.show();
  }
}
