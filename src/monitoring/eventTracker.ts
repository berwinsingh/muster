import * as path from 'path';
import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { MonitoringConfig } from '../config/schema';
import { getMusterWorkspaceFolder } from '../config/workspaceFolder';
import { ProcessTracker } from '../orchestration/processTracker';
import {
  countEventsBySeverity,
  EventFilters,
  EventSeverity,
  filterEvents,
} from './eventFilters';
import { matchTerminalLine } from './matchLine';
import {
  compilePatterns,
  diagnosticSeverityToEventSeverity,
  resolveMonitoringConfig,
} from './patterns';

export type MusterEvent = {
  id: string;
  timestamp: number;
  groupId: string;
  serviceId: string;
  groupLabel: string;
  serviceName: string;
  severity: EventSeverity;
  message: string;
  source: 'terminal' | 'diagnostics';
  patternId?: string;
  category?: string;
  location?: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
};

const MAX_EVENTS = 500;

type ServiceMeta = {
  groupId: string;
  serviceId: string;
  groupLabel: string;
  serviceName: string;
  cwd: string;
};

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export class EventTracker implements vscode.Disposable {
  private readonly events: MusterEvent[] = [];
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private eventCounter = 0;
  private monitoring: MonitoringConfig | undefined;
  private terminalPatterns = compilePatterns(
    resolveMonitoringConfig(undefined).patterns.filter((pattern) =>
      pattern.sources.includes('terminal')
    )
  );

  constructor(tracker: ProcessTracker) {
    this.disposables.push(
      tracker.onDidAppendOutput(({ groupId, serviceId, line }) => {
        this.processTerminalLine(groupId, serviceId, line);
      }),
      vscode.languages.onDidChangeDiagnostics(() => {
        try {
          this.processDiagnostics();
        } catch (err) {
          console.warn('[Muster] Diagnostics scan skipped:', err);
        }
      })
    );

    this.refreshMonitoringConfig();
    try {
      this.processDiagnostics();
    } catch (err) {
      console.warn('[Muster] Initial diagnostics scan skipped:', err);
    }
  }

  refreshMonitoringConfig(): void {
    try {
      const config = loadMergedConfig(getMusterWorkspaceFolder());
      this.monitoring = config.monitoring;
    } catch {
      this.monitoring = undefined;
    }

    const resolved = resolveMonitoringConfig(this.monitoring);
    this.terminalPatterns = compilePatterns(
      resolved.patterns.filter((pattern) => pattern.sources.includes('terminal'))
    );
    this.processDiagnostics();
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
      const config = loadMergedConfig(getMusterWorkspaceFolder());
      const group = config.groups.find((candidate) => candidate.id === groupId);
      const service = group?.services.find((candidate) => candidate.id === serviceId);
      return {
        groupLabel: group?.label ?? groupId,
        serviceName: service?.name ?? serviceId,
      };
    } catch {
      return { groupLabel: groupId, serviceName: serviceId };
    }
  }

  private addEvent(event: Omit<MusterEvent, 'id'>, notify = true): void {
    this.events.unshift({ ...event, id: this.nextId() });
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    if (notify) {
      this.onDidChangeEmitter.fire();
    }
  }

  private processTerminalLine(groupId: string, serviceId: string, line: string): void {
    const message = line.trim();
    if (!message) {
      return;
    }

    const bestMatch = matchTerminalLine(message, this.terminalPatterns);
    const meta = this.getServiceMeta(groupId, serviceId);

    this.addEvent({
      timestamp: Date.now(),
      groupId,
      serviceId,
      groupLabel: meta.groupLabel,
      serviceName: meta.serviceName,
      severity: bestMatch?.severity ?? 'other',
      message,
      source: 'terminal',
      patternId: bestMatch?.id,
      category: bestMatch?.category ?? 'other',
    });
  }

  private getConfiguredServices(): ServiceMeta[] {
    const folder = getMusterWorkspaceFolder();
    if (!folder) {
      return [];
    }

    try {
      const config = loadMergedConfig(folder);
      return config.groups.flatMap((group) =>
        group.services.map((service) => ({
          groupId: group.id,
          serviceId: service.id,
          groupLabel: group.label,
          serviceName: service.name,
          cwd: service.cwd ?? folder.uri.fsPath,
        }))
      );
    } catch {
      return [];
    }
  }

  private findServiceForDiagnostic(uri: vscode.Uri, services: ServiceMeta[]): ServiceMeta | undefined {
    return services
      .filter((service) => isPathInside(uri.fsPath, service.cwd))
      .sort((left, right) => right.cwd.length - left.cwd.length)[0];
  }

  private processDiagnostics(): void {
    const resolved = resolveMonitoringConfig(this.monitoring);
    const terminalEvents = this.events.filter((event) => event.source === 'terminal');

    if (!resolved.includeDiagnostics) {
      if (terminalEvents.length !== this.events.length) {
        this.events.length = 0;
        this.events.push(...terminalEvents);
        this.onDidChangeEmitter.fire();
      }
      return;
    }

    const services = this.getConfiguredServices();
    if (!services.length) {
      return;
    }

    const diagnosticsEvents: Array<Omit<MusterEvent, 'id'>> = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      const service = this.findServiceForDiagnostic(uri, services);
      if (!service) {
        continue;
      }

      for (const diagnostic of diagnostics) {
        const severity = diagnosticSeverityToEventSeverity(diagnostic.severity);
        if (!severity) {
          continue;
        }

        diagnosticsEvents.push({
          timestamp: Date.now(),
          groupId: service.groupId,
          serviceId: service.serviceId,
          groupLabel: service.groupLabel,
          serviceName: service.serviceName,
          severity,
          message: diagnostic.message,
          source: 'diagnostics',
          category: 'diagnostics',
          location: {
            uri: uri.fsPath,
            range: {
              start: diagnostic.range.start,
              end: diagnostic.range.end,
            },
          },
        });
      }
    }

    this.events.length = 0;
    this.events.push(...terminalEvents);
    for (const diagnosticEvent of diagnosticsEvents) {
      this.addEvent(diagnosticEvent, false);
    }
    this.onDidChangeEmitter.fire();
  }

  getEvents(): MusterEvent[] {
    return [...this.events];
  }

  hasAnyEvents(): boolean {
    return this.events.length > 0;
  }

  getFilteredEvents(filters: EventFilters): MusterEvent[] {
    return filterEvents(this.events, filters, {
      maxDays: resolveMonitoringConfig(this.monitoring).maxDays,
    });
  }

  getMonitoringMeta(): { maxDays: number; categories: string[] } {
    const resolved = resolveMonitoringConfig(this.monitoring);
    const categories = new Set<string>();

    for (const pattern of resolved.patterns) {
      if (pattern.category) {
        categories.add(pattern.category);
      }
    }
    for (const event of this.events) {
      if (event.category) {
        categories.add(event.category);
      }
    }

    return { maxDays: resolved.maxDays, categories: [...categories].sort() };
  }

  getSeverityCounts(
    filters: Omit<EventFilters, 'severity'>
  ): Record<EventSeverity, number> {
    const events = this.getFilteredEvents({ ...filters, severity: 'all' });
    return countEventsBySeverity(events);
  }

  getServiceEventCount(
    groupId: string,
    serviceId: string,
    severity?: Exclude<EventSeverity, 'other'>
  ): number {
    return this.events.filter((event) => {
      if (event.groupId !== groupId || event.serviceId !== serviceId) {
        return false;
      }
      if (severity && event.severity !== severity) {
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
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeEmitter.dispose();
  }
}

export async function revealEvent(event: MusterEvent, tracker: ProcessTracker): Promise<void> {
  if (event.source === 'diagnostics' && event.location) {
    const uri = vscode.Uri.file(event.location.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
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
  tracked?.terminal?.show();
}
