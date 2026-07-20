/**
 * Command palette model: every action available from the current dashboard
 * state, plus fuzzy matching over them. Pure — the TUI renders and executes,
 * tests assert on behavior.
 */
import type { Row } from './render';

export type PaletteAction = {
  label: string;
  kind: 'run' | 'stop' | 'restart' | 'logs' | 'logs-group' | 'filter-clear' | 'quit';
  groupId?: string;
  serviceId?: string;
};

export function buildActions(rows: Row[], hasFilter: boolean): PaletteAction[] {
  const actions: PaletteAction[] = [];
  for (const row of rows) {
    if (row.kind === 'group') {
      const g = row.group.id;
      actions.push(
        { label: `run ${g}`, kind: 'run', groupId: g },
        { label: `stop ${g}`, kind: 'stop', groupId: g },
        { label: `restart ${g}`, kind: 'restart', groupId: g },
        { label: `logs ${g} (all services)`, kind: 'logs-group', groupId: g }
      );
    } else {
      const target = `${row.group.id}/${row.serviceId}`;
      actions.push(
        { label: `run ${target}`, kind: 'run', groupId: row.group.id, serviceId: row.serviceId },
        { label: `stop ${target}`, kind: 'stop', groupId: row.group.id, serviceId: row.serviceId },
        { label: `restart ${target}`, kind: 'restart', groupId: row.group.id, serviceId: row.serviceId },
        { label: `logs ${target}`, kind: 'logs', groupId: row.group.id, serviceId: row.serviceId }
      );
    }
  }
  if (hasFilter) {
    actions.push({ label: 'clear filter', kind: 'filter-clear' });
  }
  actions.push({ label: 'quit', kind: 'quit' });
  return actions;
}

/**
 * Case-insensitive subsequence match ("stp web" hits "stop split-demo/web").
 * Spaces in the query are treated as wildcards like the rest of the gap.
 * Lower score = better (earlier, tighter matches win).
 */
export function fuzzyScore(query: string, label: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const l = label.toLowerCase();
  let score = 0;
  let li = 0;
  for (const ch of q) {
    const found = l.indexOf(ch, li);
    if (found === -1) return null;
    score += found - li;
    li = found + 1;
  }
  return score + li * 0.01;
}

export function matchActions(actions: PaletteAction[], query: string, limit = 8): PaletteAction[] {
  return actions
    .map((action) => ({ action, score: fuzzyScore(query, action.label) }))
    .filter((entry): entry is { action: PaletteAction; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.action);
}
