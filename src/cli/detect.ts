/**
 * Environment detection for CLI flows: which runtime a service needs
 * (from its command and project markers), what actually exists in its
 * cwd, and what should be persisted/activated. Wraps runtimeDetect with
 * human-readable notes for create/add/edit, `muster detect`, and the
 * headless supervisor.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  detectNodeRuntime,
  detectPythonVenvs,
  hasPythonProjectMarkers,
  isValidVenvDir,
  looksLikeNodeCommand,
  looksLikePythonCommand,
} from '../config/runtimeDetect';
import { A } from './render';

export type EnvReport = {
  needsPython: boolean;
  needsNode: boolean;
  /** Valid venv directories found in cwd (e.g. ['.venv']). */
  venvs: string[];
  nodeVersion?: string;
  nodeSource?: '.nvmrc' | 'package.json engines';
  /** What create/add/edit should persist on the service. */
  apply: { python?: { venv: string }; node?: { version: string } };
  /** Informational lines (colored, ready to print). */
  notes: string[];
  /** Things likely to break the service (subset also useful at run time). */
  warnings: string[];
};

const ok = (text: string): string => `${A.green}✓${A.reset} ${text}`;
const warn = (text: string): string => `${A.yellow}⚠${A.reset} ${text}`;
const info = (text: string): string => `${A.dim}·${A.reset} ${A.dim}${text}${A.reset}`;

/**
 * Inspect a service's command + cwd. `configured` (existing python/node
 * settings) always wins over detection — we only report on it.
 */
export function detectServiceEnv(
  command: string,
  cwd: string,
  configured: { python?: { venv?: string }; node?: { version?: string } } = {}
): EnvReport {
  const needsPython = looksLikePythonCommand(command) || hasPythonProjectMarkers(cwd);
  const needsNode = looksLikeNodeCommand(command) || fs.existsSync(path.join(cwd, 'package.json'));
  const venvs = detectPythonVenvs(cwd);
  const nodeRuntime = detectNodeRuntime(cwd);

  const report: EnvReport = {
    needsPython,
    needsNode,
    venvs,
    apply: {},
    notes: [],
    warnings: [],
  };

  if (!needsPython && !needsNode) {
    report.notes.push(
      info('no environment needed — not a Python or Node command, runs as-is')
    );
    return report;
  }

  if (needsPython) {
    const configuredVenv = configured.python?.venv;
    if (configuredVenv) {
      const resolved = path.isAbsolute(configuredVenv) ? configuredVenv : path.join(cwd, configuredVenv);
      if (isValidVenvDir(resolved)) {
        report.notes.push(ok(`python: configured venv ${configuredVenv} exists — will be activated`));
      } else {
        const line = `python: configured venv ${configuredVenv} not found in ${cwd}`;
        report.notes.push(warn(line));
        report.warnings.push(line);
      }
    } else if (venvs.length > 0) {
      const chosen = venvs.includes('.venv') ? '.venv' : venvs[0];
      report.apply.python = { venv: chosen };
      report.notes.push(ok(`python: found virtualenv ${chosen} — will be activated automatically`));
    } else {
      const line = `python: no virtualenv in ${cwd} — create one (python -m venv .venv) or the command may fail`;
      report.notes.push(warn(line));
      report.warnings.push(line);
    }
  }

  if (needsNode) {
    const configuredVersion = configured.node?.version;
    if (configuredVersion) {
      report.notes.push(ok(`node: pinned to ${configuredVersion} — nvm use before start`));
    } else if (nodeRuntime.nvmrc) {
      report.nodeVersion = nodeRuntime.nvmrc;
      report.nodeSource = '.nvmrc';
      report.apply.node = { version: nodeRuntime.nvmrc.replace(/^v/, '') };
      report.notes.push(ok(`node: .nvmrc pins ${nodeRuntime.nvmrc} — nvm use before start`));
    } else if (nodeRuntime.engines) {
      report.nodeVersion = nodeRuntime.engines;
      report.nodeSource = 'package.json engines';
      report.notes.push(info(`node: package.json engines wants ${nodeRuntime.engines} — using the node on PATH`));
    } else {
      report.notes.push(info('node: no version pin (.nvmrc / engines) — using the node on PATH'));
    }
  }

  return report;
}
