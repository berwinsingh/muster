/**
 * Pure decision + message helpers for the agent-confirmation gate.
 * Kept free of vscode imports so the branching is unit-testable; the
 * actual dialog lives in server.ts.
 *
 * Only agent-initiated writes are gated. The CLI and the extension's own
 * sidebar/command actions are direct user intent and never prompt — they
 * either don't set a source or don't pass through this path at all.
 */

export type ActionSource = 'agent' | 'cli' | undefined;

export function shouldConfirmAgentAction(source: ActionSource, settingEnabled: boolean): boolean {
  return settingEnabled && source === 'agent';
}

export function confirmationMessage(
  pathname: string,
  groupId: string,
  serviceId?: string
): string {
  const verb = pathname === '/run' ? 'start' : pathname === '/stop' ? 'stop' : 'restart';
  const target = serviceId ? `service "${serviceId}" in "${groupId}"` : `group "${groupId}"`;
  return `An AI agent wants to ${verb} the Muster ${target}.`;
}
