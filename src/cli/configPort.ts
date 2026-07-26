/**
 * The dashboard's write access to .vscode/muster.json.
 *
 * The TUI runs against remote sources too, whose config isn't a path we
 * own, so it never touches the filesystem itself — it holds a ConfigPort
 * or nothing at all. This is the local implementation: read fresh, apply
 * one of the shared pure mutations, save, and tell the caller whether the
 * change reached the running processes or has to wait for a restart.
 */
import type { GroupConfig } from '../config/schema';
import {
  GroupPatch,
  ServiceInput,
  ServicePatch,
  addService,
  deleteGroup,
  deleteService,
  updateGroup,
  updateService,
} from '../config/mutate';
import { editConfigTarget } from './editConfig';
import { openLocalConfig, saveLocalConfig } from './localConfig';

export type ConfigChange =
  | { kind: 'service'; groupId: string; serviceId: string; patch: ServicePatch }
  | { kind: 'group'; groupId: string; patch: GroupPatch }
  | { kind: 'add-service'; groupId: string; service: ServiceInput }
  | { kind: 'delete-service'; groupId: string; serviceId: string }
  | { kind: 'delete-group'; groupId: string };

export interface ConfigPort {
  /** The group as configured, or null if it's gone from the file. */
  group(groupId: string): GroupConfig | null;
  /** Apply a change and report the outcome. Throws a message worth showing. */
  update(change: ConfigChange): string;
  /** The `$EDITOR` escape hatch, for the fields no form covers. */
  openInEditor(groupId: string, serviceId?: string): string;
}

/** A short description of what changed, for the dashboard's flash line. */
function describe(change: ConfigChange): string {
  switch (change.kind) {
    case 'service':
      return `${change.groupId}/${change.serviceId} saved`;
    case 'group':
      return `${change.groupId} saved`;
    case 'add-service':
      return `added ${change.service.id} to ${change.groupId}`;
    case 'delete-service':
      return `removed ${change.serviceId} from ${change.groupId}`;
    case 'delete-group':
      return `deleted ${change.groupId}`;
  }
}

/**
 * @param reload applies the saved config to the group's supervisor, and
 *   returns false when it can't — something is still running from the old
 *   definition, so the change waits for a restart rather than pretending.
 */
export function localConfigPort(root: string, reload: (groupId: string) => boolean): ConfigPort {
  return {
    group(groupId) {
      // Read through every time: `e` can drop to $EDITOR, and the file may
      // also be edited in another window while the dashboard is up.
      const local = openLocalConfig(root);
      return local?.config.groups.find((g) => g.id === groupId) ?? null;
    },

    update(change) {
      const local = openLocalConfig(root);
      if (!local) throw new Error('no .vscode/muster.json to write to');

      let next = local.config;
      switch (change.kind) {
        case 'service':
          next = updateService(next, change.groupId, change.serviceId, change.patch);
          break;
        case 'group':
          next = updateGroup(next, change.groupId, change.patch);
          break;
        case 'add-service':
          next = addService(next, change.groupId, change.service);
          break;
        case 'delete-service':
          next = deleteService(next, change.groupId, change.serviceId);
          break;
        case 'delete-group':
          next = deleteGroup(next, change.groupId);
          break;
      }
      saveLocalConfig(local.root, next);

      const message = describe(change);
      if (change.kind === 'delete-group') return message;
      return reload(change.groupId)
        ? message
        : `${message} — restart ${change.groupId} to apply`;
    },

    openInEditor(groupId, serviceId) {
      const outcome = editConfigTarget(root, groupId, serviceId);
      if (!outcome.changed || !outcome.valid) return outcome.message;
      return reload(groupId)
        ? `${outcome.message} — reloaded`
        : `${outcome.message} — restart ${groupId} to apply`;
    },
  };
}
