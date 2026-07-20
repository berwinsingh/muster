/**
 * Pure config mutations shared by the CLI (via IPC) and the extension UI.
 * Each returns a new config object and throws a clear Error on conflicts;
 * no vscode, no filesystem — so the rules are unit-tested in isolation.
 */
import { GroupSchema, ServiceSchema } from './schema';
import type { GroupConfig, MonitoringConfig, ServiceConfig } from './schema';

export type WorkspaceConfigLike = {
  version: string;
  groups: GroupConfig[];
  monitoring?: MonitoringConfig;
};

export type ServiceInput = {
  id: string;
  name?: string;
  command?: string;
  commands?: string[];
  cwd?: string;
  port?: number;
  python?: { venv: string };
  node?: { version: string };
};

export type GroupInput = {
  id: string;
  label?: string;
  layout?: 'dedicated' | 'aggregated' | 'split';
  order?: 'parallel' | 'sequence';
  service: ServiceInput;
};

function buildService(input: ServiceInput): ServiceConfig {
  return ServiceSchema.parse({
    id: input.id,
    name: input.name ?? input.id,
    ...(input.commands ? { commands: input.commands } : { command: input.command }),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.port !== undefined ? { port: input.port } : {}),
    ...(input.python ? { python: input.python } : {}),
    ...(input.node ? { node: input.node } : {}),
  });
}

export function createGroup(config: WorkspaceConfigLike, input: GroupInput): WorkspaceConfigLike {
  if (config.groups.some((g) => g.id === input.id)) {
    throw new Error(`Group "${input.id}" already exists`);
  }
  const group = GroupSchema.parse({
    id: input.id,
    label: input.label ?? input.id,
    layout: input.layout ?? 'dedicated',
    order: input.order ?? 'parallel',
    services: [buildService(input.service)],
  });
  return { ...config, groups: [...config.groups, group] };
}

export function addService(
  config: WorkspaceConfigLike,
  groupId: string,
  service: ServiceInput
): WorkspaceConfigLike {
  const group = config.groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Unknown group "${groupId}"`);
  }
  if (group.services.some((s) => s.id === service.id)) {
    throw new Error(`Service "${service.id}" already exists in "${groupId}"`);
  }
  const updated = { ...group, services: [...group.services, buildService(service)] };
  return { ...config, groups: config.groups.map((g) => (g.id === groupId ? updated : g)) };
}

export type GroupPatch = {
  label?: string;
  layout?: GroupConfig['layout'];
  order?: GroupConfig['order'];
};

export type ServicePatch = {
  name?: string;
  command?: string;
  commands?: string[];
  /** For optional fields, `null` clears the value; `undefined` keeps it. */
  cwd?: string | null;
  port?: number | null;
  python?: { venv: string } | null;
  node?: { version: string } | null;
};

export function updateGroup(
  config: WorkspaceConfigLike,
  groupId: string,
  patch: GroupPatch
): WorkspaceConfigLike {
  const group = config.groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Unknown group "${groupId}"`);
  }
  const merged: Record<string, unknown> = { ...group };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  const updated = GroupSchema.parse(merged);
  return { ...config, groups: config.groups.map((g) => (g.id === groupId ? updated : g)) };
}

export function updateService(
  config: WorkspaceConfigLike,
  groupId: string,
  serviceId: string,
  patch: ServicePatch
): WorkspaceConfigLike {
  const group = config.groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Unknown group "${groupId}"`);
  }
  const service = group.services.find((s) => s.id === serviceId);
  if (!service) {
    throw new Error(`Unknown service "${serviceId}" in "${groupId}"`);
  }

  const merged: Record<string, unknown> = { ...service };
  if (patch.name !== undefined) merged.name = patch.name;
  // command and commands are mutually exclusive — setting one clears the other.
  if (patch.command !== undefined) {
    merged.command = patch.command;
    delete merged.commands;
  }
  if (patch.commands !== undefined) {
    merged.commands = patch.commands;
    delete merged.command;
  }
  for (const key of ['cwd', 'port', 'python', 'node'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  const updated = ServiceSchema.parse(merged);
  const nextGroup = {
    ...group,
    services: group.services.map((s) => (s.id === serviceId ? updated : s)),
  };
  return { ...config, groups: config.groups.map((g) => (g.id === groupId ? nextGroup : g)) };
}

export function deleteGroup(config: WorkspaceConfigLike, groupId: string): WorkspaceConfigLike {
  if (!config.groups.some((g) => g.id === groupId)) {
    throw new Error(`Unknown group "${groupId}"`);
  }
  return { ...config, groups: config.groups.filter((g) => g.id !== groupId) };
}

export function deleteService(
  config: WorkspaceConfigLike,
  groupId: string,
  serviceId: string
): WorkspaceConfigLike {
  const group = config.groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Unknown group "${groupId}"`);
  }
  if (!group.services.some((s) => s.id === serviceId)) {
    throw new Error(`Unknown service "${serviceId}" in "${groupId}"`);
  }
  if (group.services.length === 1) {
    throw new Error(
      `Cannot remove the last service of "${groupId}" — delete the group instead`
    );
  }
  const updated = { ...group, services: group.services.filter((s) => s.id !== serviceId) };
  return { ...config, groups: config.groups.map((g) => (g.id === groupId ? updated : g)) };
}
