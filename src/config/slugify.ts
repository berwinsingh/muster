import { GroupConfig } from './schema';
import type { WritableWorkspaceConfig } from './payload';

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;

export function slugifyId(text: string, fallback = 'item'): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function shortSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function ensureUniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  while (used.has(candidate)) {
    candidate = `${base}-${shortSuffix()}`;
  }
  used.add(candidate);
  return candidate;
}

function normalizeEntityId(raw: string, label: string, used: Set<string>, fallback: string): string {
  const trimmed = raw.trim();
  if (trimmed && VALID_ID.test(trimmed) && !used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }

  const source = trimmed || label || fallback;
  const base = slugifyId(source, fallback);
  return ensureUniqueId(base, used);
}

/** Slugify group/service ids that contain spaces or invalid characters before persisting. */
export function normalizeConfigIds(config: WritableWorkspaceConfig): WritableWorkspaceConfig {
  const usedGroupIds = new Set<string>();

  const groups: GroupConfig[] = config.groups.map((group, groupIndex) => {
    const groupId = normalizeEntityId(group.id, group.label, usedGroupIds, `group-${groupIndex + 1}`);
    const usedServiceIds = new Set<string>();
    const idMap = new Map<string, string>();

    for (const [serviceIndex, service] of group.services.entries()) {
      const newId = normalizeEntityId(
        service.id,
        service.name,
        usedServiceIds,
        `service-${serviceIndex + 1}`
      );
      idMap.set(service.id, newId);
    }

    const services = group.services.map((service) => ({
      ...service,
      id: idMap.get(service.id) ?? service.id,
      dependsOn: service.dependsOn?.map((dep) => idMap.get(dep) ?? dep),
    }));

    return {
      ...group,
      id: groupId,
      services,
    };
  });

  return {
    ...config,
    groups,
  };
}
