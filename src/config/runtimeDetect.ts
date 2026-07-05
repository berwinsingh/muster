import * as fs from 'fs';
import * as path from 'path';
import { ServiceConfig } from './schema';

const VENV_DIR_NAMES = ['.venv', 'venv', 'env'];

const PYTHON_CMD_PATTERN =
  /\b(uvicorn|python3?|celery|django|flask|poetry|pipenv|gunicorn|hypercorn|fastapi)\b/i;
const NODE_CMD_PATTERN = /\b(npm|pnpm|yarn|node|bun|npx|tsx|vite)\b/i;

function isValidVenvDir(venvPath: string): boolean {
  try {
    if (!fs.existsSync(venvPath) || !fs.statSync(venvPath).isDirectory()) {
      return false;
    }
    const activateUnix = path.join(venvPath, 'bin', 'activate');
    const activateWin = path.join(venvPath, 'Scripts', 'activate');
    const activateWinBat = path.join(venvPath, 'Scripts', 'activate.bat');
    return fs.existsSync(activateUnix) || fs.existsSync(activateWin) || fs.existsSync(activateWinBat);
  } catch {
    return false;
  }
}

function hasPythonProjectMarkers(cwd: string): boolean {
  return (
    fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
    fs.existsSync(path.join(cwd, 'requirements.txt')) ||
    fs.existsSync(path.join(cwd, 'Pipfile')) ||
    fs.existsSync(path.join(cwd, 'setup.py'))
  );
}

export function detectPythonVenvs(cwd: string): string[] {
  const found: string[] = [];
  if (!fs.existsSync(cwd)) {
    return found;
  }

  for (const dir of VENV_DIR_NAMES) {
    const venvPath = path.join(cwd, dir);
    if (isValidVenvDir(venvPath)) {
      found.push(dir);
    }
  }

  return found;
}

export function detectNodeRuntime(cwd: string): { nvmrc?: string; engines?: string } {
  const result: { nvmrc?: string; engines?: string } = {};
  if (!fs.existsSync(cwd)) {
    return result;
  }

  const nvmrcPath = path.join(cwd, '.nvmrc');
  if (fs.existsSync(nvmrcPath)) {
    try {
      const version = fs.readFileSync(nvmrcPath, 'utf-8').trim();
      if (version) {
        result.nvmrc = version;
      }
    } catch {
      // ignore
    }
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        engines?: { node?: string };
      };
      if (pkg.engines?.node) {
        result.engines = pkg.engines.node;
      }
    } catch {
      // ignore
    }
  }

  return result;
}

export function getVenvActivateCommand(venvPath: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = venvPath.replace(/\\/g, '/');
  if (platform === 'win32') {
    const winPath = venvPath.replace(/\//g, '\\');
    return `${winPath}\\Scripts\\activate`;
  }
  return `source ${normalized}/bin/activate`;
}

export function buildPrependCommands(
  service: ServiceConfig,
  platform: NodeJS.Platform = process.platform
): string[] {
  const prepend: string[] = [...(service.shell?.prepend ?? [])];

  if (service.python?.venv) {
    const activate = getVenvActivateCommand(service.python.venv, platform);
    const hasActivate = prepend.some((p) => /activate/i.test(p));
    if (!hasActivate) {
      prepend.unshift(activate);
    }
  }

  if (service.node?.version) {
    const nvmCmd = `nvm use ${service.node.version}`;
    const hasNvm = prepend.some((p) => p.includes('nvm use'));
    if (!hasNvm) {
      prepend.unshift(nvmCmd);
    }
  }

  return prepend;
}

export function looksLikePythonCommand(command: string): boolean {
  return PYTHON_CMD_PATTERN.test(command);
}

export function looksLikeNodeCommand(command: string): boolean {
  return NODE_CMD_PATTERN.test(command);
}

export function suggestPrependForService(
  service: Pick<ServiceConfig, 'command' | 'python' | 'node' | 'shell'>,
  cwd: string,
  platform: NodeJS.Platform = process.platform
): { prepend: string[]; venvs: string[]; nodeRuntime: ReturnType<typeof detectNodeRuntime>; warning?: string } {
  const venvs = detectPythonVenvs(cwd);
  const nodeRuntime = detectNodeRuntime(cwd);
  const prepend: string[] = [...(service.shell?.prepend ?? [])];

  const command = service.command ?? '';
  const isPython = looksLikePythonCommand(command) || hasPythonProjectMarkers(cwd);
  const isNode = looksLikeNodeCommand(command) || fs.existsSync(path.join(cwd, 'package.json'));

  const selectedVenv = service.python?.venv ?? (venvs.includes('.venv') ? '.venv' : venvs[0]);
  if (selectedVenv && isPython) {
    const activate = getVenvActivateCommand(selectedVenv, platform);
    if (!prepend.some((p) => /activate/i.test(p))) {
      prepend.unshift(activate);
    }
  }

  const nodeVersion = service.node?.version ?? nodeRuntime.nvmrc ?? nodeRuntime.engines;
  if (nodeVersion && isNode) {
    const nvmCmd = `nvm use ${nodeVersion.replace(/^v/, '')}`;
    if (!prepend.some((p) => p.includes('nvm use'))) {
      prepend.unshift(nvmCmd);
    }
  }

  let warning: string | undefined;
  if (isPython && venvs.length === 0 && !service.python?.venv) {
    warning = 'No virtual environment detected — command may fail';
  } else if (isNode && !nodeRuntime.nvmrc && !nodeRuntime.engines && !service.node?.version) {
    warning = 'No Node version file detected — ensure the correct runtime is available';
  }

  return { prepend, venvs, nodeRuntime, warning };
}

export function venvPathFromActivateFile(activatePath: string): string {
  const normalized = activatePath.replace(/\\/g, '/');
  if (normalized.endsWith('/bin/activate') || normalized.endsWith('/Scripts/activate')) {
    return path.dirname(path.dirname(normalized));
  }
  if (normalized.endsWith('/Scripts/activate.bat')) {
    return path.dirname(path.dirname(normalized));
  }
  return activatePath;
}
