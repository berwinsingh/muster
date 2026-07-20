import { z } from 'zod';

export const PresentationSchema = z
  .object({
    group: z.string().optional(),
    reveal: z.boolean().optional(),
    focus: z.boolean().optional(),
  })
  .strict()
  .optional();

export const PythonConfigSchema = z
  .object({
    venv: z.string().optional(),
  })
  .strict()
  .optional();

export const NodeConfigSchema = z
  .object({
    version: z.string().optional(),
  })
  .strict()
  .optional();

export const ShellConfigSchema = z
  .object({
    prepend: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const ServiceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    command: z.string().min(1).optional(),
    commands: z.array(z.string().min(1)).min(1).optional(),
    cwd: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    env: z.record(z.string()).optional(),
    envFile: z.string().optional(),
    readyPattern: z.string().optional(),
    healthUrl: z.string().url().optional(),
    dependsOn: z.array(z.string()).optional(),
    delayMs: z.number().int().nonnegative().optional(),
    presentation: PresentationSchema,
    python: PythonConfigSchema,
    node: NodeConfigSchema,
    shell: ShellConfigSchema,
  })
  .strict()
  .refine((s) => Boolean(s.command) !== Boolean(s.commands), {
    message: 'Provide either "command" or "commands" (a list to run in sequence), not both',
  });

/**
 * The single shell command a service runs: `command` as-is, or the
 * `commands` list chained with `&&` so later steps only run when the
 * earlier ones succeed. `${port}` is substituted when `port` is set.
 */
export function effectiveCommand(service: {
  command?: string;
  commands?: string[];
  port?: number;
}): string {
  const joined = service.command ?? (service.commands ?? []).join(' && ');
  if (service.port !== undefined) {
    return joined.replace(/\$\{port\}/g, String(service.port));
  }
  return joined;
}

export const HooksSchema = z
  .object({
    preRun: z.array(z.string().min(1)).optional(),
    postStop: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .optional();

export const GroupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    layout: z.enum(['dedicated', 'aggregated', 'split']).default('dedicated'),
    order: z.enum(['parallel', 'sequence']).default('parallel'),
    keepExistingTerminals: z.boolean().optional(),
    hooks: HooksSchema,
    services: z.array(ServiceSchema).min(1),
  })
  .strict();

export const ProfileSchema = z
  .object({
    name: z.string().min(1),
    groups: z.array(GroupSchema).min(1),
  })
  .strict();

export const UserProfilesSchema = z
  .object({
    version: z.string().default('1.0.0'),
    profiles: z.array(ProfileSchema).default([]),
  })
  .strict();

export const MonitoringPatternSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['error', 'warning', 'info']),
    category: z.string().optional(),
    regex: z.string().min(1),
    sources: z.array(z.enum(['terminal', 'diagnostics'])).default(['terminal']),
  })
  .strict();

export const MonitoringSchema = z
  .object({
    maxDays: z.number().int().positive().default(7),
    patterns: z.array(MonitoringPatternSchema).default([]),
    includeDiagnostics: z.boolean().default(true),
  })
  .strict();

export const WorkspaceConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.string().default('1.0.0'),
    extends: z.string().optional(),
    groups: z.array(GroupSchema).default([]),
    monitoring: MonitoringSchema.optional(),
  })
  .strict();

export type ServiceConfig = z.infer<typeof ServiceSchema>;
export type GroupConfig = z.infer<typeof GroupSchema>;
export type ProfileConfig = z.infer<typeof ProfileSchema>;
export type UserProfilesFile = z.infer<typeof UserProfilesSchema>;
export type MonitoringPattern = z.infer<typeof MonitoringPatternSchema>;
export type MonitoringConfig = z.infer<typeof MonitoringSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export type MergedConfig = {
  version: string;
  groups: GroupConfig[];
  monitoring?: MonitoringConfig;
  sources: {
    userProfilesPath: string | null;
    workspaceConfigPath: string | null;
    extendedProfile: string | null;
  };
};

export type ServiceStatus = 'idle' | 'starting' | 'running' | 'failed' | 'stopped';

export type GroupStatus = {
  groupId: string;
  state: 'idle' | 'starting' | 'running' | 'partial' | 'stopped' | 'failed';
  services: Record<string, ServiceStatus>;
};
