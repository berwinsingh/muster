import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type CommandSuggestion = {
  label: string;
  command: string;
  cwd?: string;
  source: string;
};

const COMMON_COMMANDS: CommandSuggestion[] = [
  { label: 'npm run dev', command: 'npm run dev', source: 'common' },
  { label: 'pnpm dev', command: 'pnpm dev', source: 'common' },
  { label: 'yarn dev', command: 'yarn dev', source: 'common' },
  { label: 'npm start', command: 'npm start', source: 'common' },
  { label: 'uvicorn main:app --reload', command: 'uvicorn main:app --reload --port 8000', source: 'common' },
  { label: 'python manage.py runserver', command: 'python manage.py runserver', source: 'common' },
  { label: 'go run .', command: 'go run .', source: 'common' },
  { label: 'cargo run', command: 'cargo run', source: 'common' },
];

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

function scanPackageJson(dir: string, rel: string, out: CommandSuggestion[]): void {
  const pkgPath = path.join(dir, 'package.json');
  const raw = readJsonFile(pkgPath);
  if (!raw || typeof raw !== 'object' || !('scripts' in raw)) {
    return;
  }

  const scripts = (raw as { scripts?: Record<string, string> }).scripts;
  if (!scripts) {
    return;
  }

  const preferred = ['dev', 'start', 'serve', 'watch'];
  for (const key of preferred) {
    if (scripts[key]) {
      const manager = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : fs.existsSync(path.join(dir, 'yarn.lock'))
          ? 'yarn'
          : 'npm';
      out.push({
        label: `${rel}: ${key}`,
        command: `${manager} run ${key}`,
        cwd: `\${workspaceFolder}/${rel}`.replace(/\/\.$/, ''),
        source: 'package.json',
      });
    }
  }
}

function scanMakefile(dir: string, rel: string, out: CommandSuggestion[]): void {
  const makefilePath = path.join(dir, 'Makefile');
  if (!fs.existsSync(makefilePath)) {
    return;
  }

  try {
    const content = fs.readFileSync(makefilePath, 'utf-8');
    const targets = [...content.matchAll(/^([a-zA-Z0-9_.-]+):/gm)]
      .map((m) => m[1])
      .filter((t) => !t.startsWith('.') && t !== 'PHONY');

    for (const target of targets.slice(0, 8)) {
      out.push({
        label: `${rel}: make ${target}`,
        command: `make ${target}`,
        cwd: rel === '.' ? '${workspaceFolder}' : `\${workspaceFolder}/${rel}`,
        source: 'Makefile',
      });
    }
  } catch {
    // ignore
  }
}

function scanPyProject(dir: string, rel: string, out: CommandSuggestion[]): void {
  const pyproject = path.join(dir, 'pyproject.toml');
  if (!fs.existsSync(pyproject)) {
    return;
  }

  out.push({
    label: `${rel}: uvicorn`,
    command: 'uvicorn main:app --reload --port 8000',
    cwd: rel === '.' ? '${workspaceFolder}' : `\${workspaceFolder}/${rel}`,
    source: 'pyproject.toml',
  });

  if (fs.existsSync(path.join(dir, 'manage.py'))) {
    out.push({
      label: `${rel}: django runserver`,
      command: 'python manage.py runserver',
      cwd: rel === '.' ? '${workspaceFolder}' : `\${workspaceFolder}/${rel}`,
      source: 'django',
    });
  }
}

function scanGoMod(dir: string, rel: string, out: CommandSuggestion[]): void {
  if (!fs.existsSync(path.join(dir, 'go.mod'))) {
    return;
  }

  out.push({
    label: `${rel}: go run`,
    command: 'go run .',
    cwd: rel === '.' ? '${workspaceFolder}' : `\${workspaceFolder}/${rel}`,
    source: 'go.mod',
  });
}

function walkWorkspace(root: string, maxDepth = 3): Array<{ abs: string; rel: string }> {
  const results: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '.' }];
  const skip = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage']);

  function walk(current: string, rel: string, depth: number): void {
    if (depth >= maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) {
        continue;
      }
      const abs = path.join(current, entry.name);
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      results.push({ abs, rel: childRel });
      walk(abs, childRel, depth + 1);
    }
  }

  walk(root, '.', 0);
  return results;
}

export function scanCommandSuggestions(
  workspaceFolder: vscode.WorkspaceFolder | undefined
): CommandSuggestion[] {
  if (!workspaceFolder) {
    return COMMON_COMMANDS;
  }

  const root = workspaceFolder.uri.fsPath;
  const suggestions: CommandSuggestion[] = [...COMMON_COMMANDS];
  const seen = new Set<string>();

  for (const { abs, rel } of walkWorkspace(root)) {
    scanPackageJson(abs, rel, suggestions);
    scanMakefile(abs, rel, suggestions);
    scanPyProject(abs, rel, suggestions);
    scanGoMod(abs, rel, suggestions);
  }

  return suggestions.filter((s) => {
    const key = `${s.command}@${s.cwd ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
