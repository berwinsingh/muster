import { effectiveCommand, ServiceConfig } from '../config/schema';
import { buildPrependCommands } from '../config/runtimeDetect';

/**
 * Builds the final shell command for a service, prepending environment setup
 * (venv activation, nvm use, custom shell.prepend lines) before the main
 * command — which is either `command` or the `commands` list chained with &&.
 * Runtime prepends come only from explicit config (python.venv, node.version,
 * shell.prepend); nothing is auto-detected at launch time.
 */
export function buildServiceCommand(service: ServiceConfig): string {
  const main = effectiveCommand(service);
  const prepend = buildPrependCommands(service);
  if (prepend.length === 0) {
    return main;
  }
  return [...prepend, main].join(' && ');
}
