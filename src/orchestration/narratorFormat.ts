/**
 * Pure ANSI formatting for the Muster orchestrator terminal.
 * Kept free of vscode imports so it is unit-testable and reusable
 * by any pseudoterminal writer.
 */

const AMBER = '\x1b[38;5;215m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export const MUSTER_TAG = `${AMBER}[muster]${RESET}`;

export function formatRunHeader(groupId: string): string {
  return `${GREEN}❯${RESET} ${BOLD}muster run ${groupId}${RESET}`;
}

export function formatStarting(
  serviceCount: number,
  layout: string,
  order: string
): string {
  const services = serviceCount === 1 ? '1 service' : `${serviceCount} services`;
  return `${MUSTER_TAG} starting ${services} · layout: ${layout} · order: ${order}`;
}

export function formatServiceLaunch(serviceId: string, command: string): string {
  return `${MUSTER_TAG} ▶ ${BOLD}${serviceId}${RESET} ${DIM}— ${command}${RESET}`;
}

export function formatDelay(serviceId: string, delayMs: number): string {
  return `${MUSTER_TAG} ${DIM}⏱ delaying ${serviceId} ${delayMs}ms${RESET}`;
}

export function formatWaitingReady(serviceId: string, what: string): string {
  return `${MUSTER_TAG} ${DIM}waiting for ${what} on ${serviceId}…${RESET}`;
}

export function formatReadyMatched(serviceId: string, hasDependents: boolean): string {
  const tail = hasDependents ? ' → starting dependents' : '';
  return `${MUSTER_TAG} ready pattern matched on ${serviceId}${tail}`;
}

export function formatHealthOk(serviceId: string): string {
  return `${MUSTER_TAG} health check passed on ${serviceId}`;
}

export function formatAllRunning(groupId: string, running: number, total: number): string {
  return `${GREEN}✓${RESET} ${MUSTER_TAG} ${groupId} · ${GREEN}${running}/${total} services running${RESET}`;
}

export function formatPartial(groupId: string, running: number, total: number): string {
  return `${MUSTER_TAG} ${groupId} · ${running}/${total} services running`;
}

export function formatAggregatedHandoff(groupId: string, label: string): string {
  return `${MUSTER_TAG} ${groupId} running aggregated in terminal ${DIM}"Muster: ${label}"${RESET}`;
}

export function formatHook(line: string): string {
  return `${MUSTER_TAG} ${DIM}⚙ ${line}${RESET}`;
}

export function formatPortWarning(serviceId: string, port: number): string {
  return `${MUSTER_TAG} ${RED}⚠ port ${port} is already in use — ${serviceId} may fail to bind${RESET}`;
}

export function formatStopping(groupId: string): string {
  return `${MUSTER_TAG} ⏹ stopping ${groupId}…`;
}

export function formatStopped(groupId: string): string {
  return `${MUSTER_TAG} stopped ${groupId}`;
}

export function formatFailure(context: string, message: string): string {
  return `${RED}✗${RESET} ${MUSTER_TAG} ${RED}${context}: ${message}${RESET}`;
}

/** Strip ANSI escapes — used by tests and log capture. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
