import * as vscode from 'vscode';

export function assertWorkspaceTrusted(action: string): boolean {
  if (vscode.workspace.isTrusted) {
    return true;
  }
  vscode.window.showWarningMessage(
    `Muster: Cannot ${action} in an untrusted workspace. Trust this workspace first.`
  );
  return false;
}

export async function withTrust<T>(
  action: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (!assertWorkspaceTrusted(action)) {
    return undefined;
  }
  return fn();
}

export function validateGroupId(
  groupId: string,
  knownIds: string[]
): boolean {
  if (!knownIds.includes(groupId)) {
    vscode.window.showErrorMessage(
      `Muster: Unknown group "${groupId}". Commands must reference config-defined groups only.`
    );
    return false;
  }
  return true;
}

export function validateServiceId(
  serviceId: string,
  knownIds: string[]
): boolean {
  if (!knownIds.includes(serviceId)) {
    vscode.window.showErrorMessage(
      `Muster: Unknown service "${serviceId}". Commands must reference config-defined services only.`
    );
    return false;
  }
  return true;
}
