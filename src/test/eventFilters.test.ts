import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countEventsBySeverity,
  EventSeverity,
  filterEvents,
} from '../monitoring/eventFilters';

type TestEvent = {
  id: string;
  timestamp: number;
  severity: EventSeverity;
  groupId: string;
  serviceId: string;
  category?: string;
};

function event(
  id: string,
  severity: EventSeverity,
  timestamp: number,
  overrides: Partial<TestEvent> = {}
): TestEvent {
  return {
    id,
    timestamp,
    severity,
    groupId: 'app',
    serviceId: 'api',
    category: 'runtime',
    ...overrides,
  };
}

describe('event filters', () => {
  const now = new Date(2026, 6, 10, 12, 0, 0).getTime();
  const events = [
    event('error', 'error', new Date(2026, 6, 10, 10, 0, 0).getTime()),
    event('info', 'info', new Date(2026, 6, 10, 9, 0, 0).getTime()),
    event('other', 'other', new Date(2026, 6, 10, 8, 0, 0).getTime(), { category: 'other' }),
    event('yesterday', 'warning', new Date(2026, 6, 9, 23, 59, 0).getTime()),
    event('old', 'error', new Date(2026, 6, 6, 12, 0, 0).getTime()),
  ];

  it('filters error, info, and other independently', () => {
    assert.deepEqual(
      filterEvents(events, { severity: 'error' }, { now, maxDays: 7 }).map((item) => item.id),
      ['error', 'old']
    );
    assert.deepEqual(
      filterEvents(events, { severity: 'info' }, { now, maxDays: 7 }).map((item) => item.id),
      ['info']
    );
    assert.deepEqual(
      filterEvents(events, { severity: 'other' }, { now, maxDays: 7 }).map((item) => item.id),
      ['other']
    );
  });

  it('uses calendar-day boundaries for Today', () => {
    assert.deepEqual(
      filterEvents(events, { dateRange: 'today' }, { now, maxDays: 7 }).map((item) => item.id),
      ['error', 'info', 'other']
    );
  });

  it('includes the current day plus two previous calendar days for 3 days', () => {
    const result = filterEvents(events, { dateRange: '3d' }, { now, maxDays: 7 });
    assert.deepEqual(result.map((item) => item.id), ['error', 'info', 'other', 'yesterday']);
  });

  it('combines group, service, and category filters', () => {
    const scoped = [
      ...events,
      event('worker', 'error', now, { serviceId: 'worker', category: 'queue' }),
      event('web', 'error', now, { groupId: 'frontend', serviceId: 'web' }),
    ];
    const result = filterEvents(
      scoped,
      { groupId: 'app', serviceId: 'worker', category: 'queue' },
      { now, maxDays: 7 }
    );
    assert.deepEqual(result.map((item) => item.id), ['worker']);
  });

  it('counts every supported severity, including other', () => {
    assert.deepEqual(countEventsBySeverity(events), {
      error: 2,
      warning: 1,
      info: 1,
      other: 1,
    });
  });
});
