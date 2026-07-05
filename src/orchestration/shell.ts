import { ServiceConfig } from '../config/schema';
import { buildPrependCommands } from '../config/runtimeDetect';

/**
 * Builds the final shell command for a service, prepending environment setup
 * (venv activation, nvm use, custom shell.prepend lines) before the main command.
 */
export function buildServiceCommand(service: ServiceConfig): string {
  const prepend = buildPrependCommands(service);
  if (prepend.length === 0) {
    return service.command;
  }
  return [...prepend, service.command].join(' && ');
}
