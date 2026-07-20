/**
 * Direct .vscode/muster.json editing for when no VS Code extension is
 * reachable: the same mutations and validating serializer as the
 * extension's writer, over plain fs. Values are kept raw — no
 * ${workspaceFolder} substitution — so files round-trip untouched.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceConfigSchema } from '../config/schema';
import {
  WritableWorkspaceConfig,
  buildWorkspaceConfigPayload,
  getExampleConfig,
} from '../config/payload';
import { findConfigRoot } from './headlessConfig';

export type LocalConfig = {
  root: string;
  file: string;
  config: WritableWorkspaceConfig;
};

/** Load the nearest .vscode/muster.json (walking up from startDir), or null. */
export function openLocalConfig(startDir: string): LocalConfig | null {
  const root = findConfigRoot(startDir);
  if (!root) return null;
  const file = path.join(root, '.vscode', 'muster.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`Could not read ${file}: ${err instanceof Error ? err.message : err}`);
  }
  const parsed = WorkspaceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Invalid ${file}: ${first?.path.join('.')} ${first?.message}`);
  }
  return {
    root,
    file,
    config: {
      version: parsed.data.version ?? '1.0.0',
      groups: parsed.data.groups ?? [],
      monitoring: parsed.data.monitoring,
    },
  };
}

/** Validate, normalize ids, and write the config back to disk. */
export function saveLocalConfig(root: string, config: WritableWorkspaceConfig): string {
  const payload = buildWorkspaceConfigPayload(config);
  const dir = path.join(root, '.vscode');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'muster.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

/**
 * Scaffold a starter config. Joins an enclosing workspace if startDir is
 * inside one; otherwise startDir becomes the workspace root. Refuses to
 * touch a config that already has groups.
 */
export function initLocalConfig(startDir: string): string {
  const existing = openLocalConfig(startDir);
  if (existing) {
    if (existing.config.groups.length > 0) {
      throw new Error(
        `${existing.file} already has groups — nothing to initialize`
      );
    }
    return saveLocalConfig(existing.root, { ...getExampleConfig(), version: existing.config.version });
  }
  return saveLocalConfig(path.resolve(startDir), getExampleConfig());
}
