import * as vscode from 'vscode';
import { loadMergedConfig } from '../config/loader';
import { GroupConfig } from '../config/schema';

export async function pickGroup(
  placeHolder = 'Select a server group'
): Promise<GroupConfig | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  let config;
  try {
    config = loadMergedConfig(folder);
  } catch (err) {
    vscode.window.showErrorMessage(`DevStack config error: ${err}`);
    return undefined;
  }

  if (config.groups.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No DevStack groups configured yet.',
      'Create Group',
      'Import Example',
      'Open Visual Editor'
    );
    if (choice === 'Create Group') {
      await vscode.commands.executeCommand('devstack.createGroup');
    } else if (choice === 'Import Example') {
      await vscode.commands.executeCommand('devstack.importExample');
    } else if (choice === 'Open Visual Editor') {
      await vscode.commands.executeCommand('devstack.openVisualEditor');
    }
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    config.groups.map((g) => ({
      label: g.label,
      description: g.id,
      detail: `${g.services.length} services · ${g.layout} · ${g.order}`,
      group: g,
    })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true }
  );

  return picked?.group;
}

export async function pickService(
  group: GroupConfig
): Promise<GroupConfig['services'][number] | undefined> {
  const picked = await vscode.window.showQuickPick(
    group.services.map((s) => ({
      label: s.name,
      description: s.id,
      detail: s.command,
      service: s,
    })),
    { placeHolder: `Select a service in ${group.label}` }
  );
  return picked?.service;
}

export async function resolveGroupId(groupId?: string): Promise<string | undefined> {
  if (groupId) {
    return groupId;
  }
  const group = await pickGroup();
  return group?.id;
}
