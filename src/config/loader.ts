import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  GroupConfig,
  GroupSchema,
  MergedConfig,
  ProfileSchema,
  UserProfilesSchema,
  WorkspaceConfigSchema,
} from './schema';
import { getUserProfilesPath, getWorkspaceConfigPath } from './paths';

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function substituteVariables(
  value: string,
  workspaceFolder: vscode.WorkspaceFolder | undefined
): string {
  const folder = workspaceFolder?.uri.fsPath ?? process.cwd();
  const basename = path.basename(folder);

  let result = value
    .replace(/\$\{workspaceFolder\}/g, folder)
    .replace(/\$\{workspaceFolderBasename\}/g, basename);

  result = result.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => {
    return process.env[name] ?? '';
  });

  return result;
}

function validateCwd(cwd: string, workspaceFolder: vscode.WorkspaceFolder | undefined): void {
  const config = vscode.workspace.getConfiguration('muster');
  const allowExternal = config.get<boolean>('allowExternalCwd', false);
  if (allowExternal) {
    return;
  }
  const folder = workspaceFolder?.uri.fsPath;
  if (!folder) {
    return;
  }
  const resolved = path.resolve(cwd);
  const normalizedFolder = path.resolve(folder);
  if (!resolved.startsWith(normalizedFolder)) {
    throw new Error(
      `Service cwd "${cwd}" is outside workspace. Set muster.allowExternalCwd to allow.`
    );
  }
}

export function resolveGroupPaths(
  group: GroupConfig,
  workspaceFolder: vscode.WorkspaceFolder | undefined
): GroupConfig {
  return {
    ...group,
    services: group.services.map((svc) => {
      const cwd = svc.cwd ? substituteVariables(svc.cwd, workspaceFolder) : undefined;
      if (cwd) {
        validateCwd(cwd, workspaceFolder);
      }
      return {
        ...svc,
        cwd,
        envFile: svc.envFile ? substituteVariables(svc.envFile, workspaceFolder) : undefined,
        command: substituteVariables(svc.command, workspaceFolder),
        python: svc.python?.venv
          ? { venv: substituteVariables(svc.python.venv, workspaceFolder) }
          : svc.python,
        node: svc.node,
        shell: svc.shell
          ? {
              prepend: svc.shell.prepend?.map((p) => substituteVariables(p, workspaceFolder)),
            }
          : undefined,
        env: svc.env
          ? Object.fromEntries(
              Object.entries(svc.env).map(([k, v]) => [k, substituteVariables(v, workspaceFolder)])
            )
          : undefined,
      };
    }),
  };
}

export function loadMergedConfig(
  workspaceFolder?: vscode.WorkspaceFolder
): MergedConfig {
  const userProfilesPath = getUserProfilesPath();
  const workspaceConfigPath = workspaceFolder
    ? getWorkspaceConfigPath(workspaceFolder.uri.fsPath)
    : null;

  const userRaw = readJsonFile(userProfilesPath);
  const workspaceRaw = workspaceConfigPath ? readJsonFile(workspaceConfigPath) : null;

  const userParsed = userRaw ? UserProfilesSchema.safeParse(userRaw) : null;
  const workspaceParsed = workspaceRaw ? WorkspaceConfigSchema.safeParse(workspaceRaw) : null;

  if (userRaw && userParsed && !userParsed.success) {
    throw new Error(`Invalid user profiles at ${userProfilesPath}: ${userParsed.error.message}`);
  }
  if (workspaceRaw && workspaceParsed && !workspaceParsed.success) {
    throw new Error(
      `Invalid workspace config at ${workspaceConfigPath}: ${workspaceParsed.error.message}`
    );
  }

  const userProfiles = userParsed?.success ? userParsed.data : { version: '1.0.0', profiles: [] };
  const workspaceConfig = workspaceParsed?.success
    ? workspaceParsed.data
    : { version: '1.0.0', groups: [] };

  const groupsMap = new Map<string, GroupConfig>();
  let extendedProfile: string | null = null;

  if (workspaceConfig.extends) {
    extendedProfile = workspaceConfig.extends;
    const profile = userProfiles.profiles.find((p) => p.name === workspaceConfig.extends);
    if (profile) {
      const parsed = ProfileSchema.parse(profile);
      for (const group of parsed.groups) {
        groupsMap.set(group.id, GroupSchema.parse(group));
      }
    }
  } else {
    for (const profile of userProfiles.profiles) {
      const parsed = ProfileSchema.safeParse(profile);
      if (parsed.success) {
        for (const group of parsed.data.groups) {
          if (!groupsMap.has(group.id)) {
            groupsMap.set(group.id, GroupSchema.parse(group));
          }
        }
      }
    }
  }

  for (const group of workspaceConfig.groups) {
    groupsMap.set(group.id, GroupSchema.parse(group));
  }

  const groups = Array.from(groupsMap.values()).map((g) =>
    resolveGroupPaths(g, workspaceFolder)
  );

  return {
    version: workspaceConfig.version ?? userProfiles.version ?? '1.0.0',
    groups,
    monitoring: workspaceConfig.monitoring,
    sources: {
      userProfilesPath: fs.existsSync(userProfilesPath) ? userProfilesPath : null,
      workspaceConfigPath:
        workspaceConfigPath && fs.existsSync(workspaceConfigPath) ? workspaceConfigPath : null,
      extendedProfile,
    },
  };
}

export function findGroup(config: MergedConfig, groupId: string): GroupConfig | undefined {
  return config.groups.find((g) => g.id === groupId);
}

export function findService(
  group: GroupConfig,
  serviceId: string
): GroupConfig['services'][number] | undefined {
  return group.services.find((s) => s.id === serviceId);
}

/** Load config from filesystem without VS Code APIs (for MCP server). */
export function loadMergedConfigFromPaths(
  workspaceRoot: string | null,
  allowExternalCwd = false
): MergedConfig {
  const userProfilesPath = getUserProfilesPath();
  const workspaceConfigPath = workspaceRoot ? getWorkspaceConfigPath(workspaceRoot) : null;

  const userRaw = readJsonFile(userProfilesPath);
  const workspaceRaw = workspaceConfigPath ? readJsonFile(workspaceConfigPath) : null;

  const userParsed = userRaw ? UserProfilesSchema.safeParse(userRaw) : null;
  const workspaceParsed = workspaceRaw ? WorkspaceConfigSchema.safeParse(workspaceRaw) : null;

  const userProfiles = userParsed?.success ? userParsed.data : { version: '1.0.0', profiles: [] };
  const workspaceConfig = workspaceParsed?.success
    ? workspaceParsed.data
    : { version: '1.0.0', groups: [] };

  const groupsMap = new Map<string, GroupConfig>();
  let extendedProfile: string | null = null;

  if (workspaceConfig.extends) {
    extendedProfile = workspaceConfig.extends;
    const profile = userProfiles.profiles.find((p) => p.name === workspaceConfig.extends);
    if (profile) {
      for (const group of ProfileSchema.parse(profile).groups) {
        groupsMap.set(group.id, GroupSchema.parse(group));
      }
    }
  } else {
    for (const profile of userProfiles.profiles) {
      const parsed = ProfileSchema.safeParse(profile);
      if (parsed.success) {
        for (const group of parsed.data.groups) {
          if (!groupsMap.has(group.id)) {
            groupsMap.set(group.id, GroupSchema.parse(group));
          }
        }
      }
    }
  }

  for (const group of workspaceConfig.groups) {
    groupsMap.set(group.id, GroupSchema.parse(group));
  }

  const fakeFolder = workspaceRoot
    ? ({ uri: { fsPath: workspaceRoot } } as vscode.WorkspaceFolder)
    : undefined;

  const groups = Array.from(groupsMap.values()).map((g) => {
    if (allowExternalCwd) {
      return {
        ...g,
        services: g.services.map((svc) => ({
          ...svc,
          cwd: svc.cwd && fakeFolder ? substituteVariables(svc.cwd, fakeFolder) : svc.cwd,
          envFile:
            svc.envFile && fakeFolder ? substituteVariables(svc.envFile, fakeFolder) : svc.envFile,
          command: fakeFolder ? substituteVariables(svc.command, fakeFolder) : svc.command,
        })),
      };
    }
    return resolveGroupPaths(g, fakeFolder);
  });

  return {
    version: workspaceConfig.version ?? userProfiles.version ?? '1.0.0',
    groups,
    monitoring: workspaceConfig.monitoring,
    sources: {
      userProfilesPath: fs.existsSync(userProfilesPath) ? userProfilesPath : null,
      workspaceConfigPath:
        workspaceConfigPath && fs.existsSync(workspaceConfigPath) ? workspaceConfigPath : null,
      extendedProfile,
    },
  };
}
