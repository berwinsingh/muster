export const EVENT_SEVERITIES = ['error', 'warning', 'info', 'other'] as const;

export type EventSeverity = (typeof EVENT_SEVERITIES)[number];
export type EventDateRange = 'today' | '3d' | 'maxDays' | 'all';

export type EventFilters = {
  dateRange?: EventDateRange;
  severity?: EventSeverity | 'all';
  groupId?: string;
  serviceId?: string;
  category?: string;
};

export type FilterableEvent = {
  timestamp: number;
  severity: EventSeverity;
  groupId: string;
  serviceId: string;
  category?: string;
};

export type EventFilterOptions = {
  now?: number;
  maxDays: number;
};

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getEarliestTimestamp(
  dateRange: EventDateRange | undefined,
  now: number,
  maxDays: number
): number | undefined {
  const startToday = startOfLocalDay(now);

  switch (dateRange) {
    case 'today':
      return startToday;
    case '3d':
      return startToday - 2 * 24 * 60 * 60 * 1000;
    case 'maxDays':
      return startToday - Math.max(0, maxDays - 1) * 24 * 60 * 60 * 1000;
    case 'all':
    case undefined:
      return undefined;
  }
}

export function filterEvents<T extends FilterableEvent>(
  events: readonly T[],
  filters: EventFilters,
  options: EventFilterOptions
): T[] {
  const now = options.now ?? Date.now();
  const earliestTimestamp = getEarliestTimestamp(filters.dateRange, now, options.maxDays);

  return events.filter((event) => {
    if (earliestTimestamp !== undefined && event.timestamp < earliestTimestamp) {
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
    if (
      filters.category &&
      filters.category !== 'all' &&
      event.category !== filters.category
    ) {
      return false;
    }
    return true;
  });
}

export function countEventsBySeverity(
  events: readonly FilterableEvent[]
): Record<EventSeverity, number> {
  const counts: Record<EventSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
    other: 0,
  };

  for (const event of events) {
    counts[event.severity] += 1;
  }

  return counts;
}
