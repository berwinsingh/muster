/**
 * Glue between a group's config and its on-disk log store: pick the
 * retention window, build the store, prune what has aged out. Kept separate
 * from LogStore so the store stays a pure, config-agnostic file layer.
 */
import { GroupConfig } from '../config/schema';
import { DEFAULT_RETENTION, LogStore, Retention, parseRetention } from './store';

/**
 * Resolve a group's retention window. An unset field means "use the
 * default"; a set-but-unparseable value is reported to `onWarn` and also
 * falls back to the default, so a typo never silently disables retention.
 */
export function resolveRetention(
  group: Pick<GroupConfig, 'logRetention'>,
  onWarn?: (message: string) => void
): Retention {
  if (group.logRetention === undefined) {
    return parseRetention(DEFAULT_RETENTION)!;
  }
  const parsed = parseRetention(group.logRetention);
  if (parsed === null) {
    onWarn?.(
      `logRetention "${group.logRetention}" is not a valid window (e.g. "7d", "48h", "none") — keeping the ${DEFAULT_RETENTION} default`
    );
    return parseRetention(DEFAULT_RETENTION)!;
  }
  return parsed;
}

/**
 * Build a store for a workspace and prune this group's aged-out history up
 * front, so a long-idle project doesn't accumulate months of logs.
 */
export function openGroupLogStore(
  workspaceRoot: string,
  group: GroupConfig,
  onWarn?: (message: string) => void
): { store: LogStore; retention: Retention } {
  const store = new LogStore({ workspaceRoot });
  const retention = resolveRetention(group, onWarn);
  store.prune(retention);
  return { store, retention };
}
