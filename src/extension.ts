import * as vscode from 'vscode';

import { loadMergedConfig } from './config/loader';
import { getDevStackWorkspaceFolder, hasWorkspaceConfigFile } from './config/workspaceFolder';
import { startIpcServer } from './ipc/server';
import { EventTracker } from './monitoring/eventTracker';
import { registerMcpProvider } from './mcpProvider';
import { GroupRunner } from './orchestration/groupRunner';
import { ProcessTracker } from './orchestration/processTracker';
import { assertWorkspaceTrusted, validateGroupId, validateServiceId } from './security/trust';
import {
  createGroupQuick,
  editGroupInWizard,
  importExampleConfig,
  openVisualConfigEditor,
} from './ui/configWizard';
import { openConfigEditor } from './ui/configEditor';
import { registerIssuesView } from './ui/issuesView';
import { pickGroup, pickService, resolveGroupId } from './ui/quickPick';
import { registerStatusBar, DevStackStatusBar } from './ui/statusBar';
import { registerTreeView, DevStackTreeProvider, DevStackTreeItem, devStackHasGroups } from './ui/treeView';
import { registerWelcomeCommands } from './ui/welcomeView';

let tracker: ProcessTracker | undefined;
let runner: GroupRunner | undefined;
let statusBar: DevStackStatusBar | undefined;
let treeProvider: DevStackTreeProvider | undefined;
let eventTracker: EventTracker | undefined;
let issuesView: ReturnType<typeof registerIssuesView> | undefined;

function onConfigChanged(): void {
  void updateDevStackContext();
  treeProvider?.refresh();
  eventTracker?.refreshMonitoringConfig();
  issuesView?.refreshMeta();
}

async function updateDevStackContext(): Promise<void> {
  const folder = getDevStackWorkspaceFolder();
  const hasConfigFile = hasWorkspaceConfigFile(folder);
  const hasGroups = devStackHasGroups();

  await vscode.commands.executeCommand('setContext', 'devstack.hasConfigFile', hasConfigFile);
  await vscode.commands.executeCommand('setContext', 'devstack.hasGroups', hasGroups);
}

function watchWorkspaceConfig(context: vscode.ExtensionContext): void {
  const folder = getDevStackWorkspaceFolder();
  if (!folder) {
    return;
  }

  const pattern = new vscode.RelativePattern(folder, '.vscode/devstack.json');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const refresh = (): void => onConfigChanged();

  watcher.onDidChange(refresh);
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);
}

function registerConfigCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devstack.openConfig', () => openConfigEditor()),
    vscode.commands.registerCommand('devstack.openVisualEditor', () =>
      openVisualConfigEditor(context, onConfigChanged)
    ),
    vscode.commands.registerCommand('devstack.createGroup', () =>
      createGroupQuick(context, onConfigChanged)
    ),
    vscode.commands.registerCommand('devstack.importExample', () =>
      importExampleConfig(context, onConfigChanged)
    ),
    vscode.commands.registerCommand('devstack.editGroup', (item?: DevStackTreeItem) => {
      const groupId = item?.groupId;
      if (groupId) {
        editGroupInWizard(context, groupId, onConfigChanged);
      } else {
        void openVisualConfigEditor(context, onConfigChanged);
      }
    })
  );
}

export function activate(context: vscode.ExtensionContext): void {
  registerWelcomeCommands(context);
  registerConfigCommands(context);

  tracker = new ProcessTracker();
  runner = new GroupRunner(tracker);
  eventTracker = new EventTracker(tracker);
  context.subscriptions.push(tracker, eventTracker);

  const ipc = startIpcServer(runner, tracker);
  context.subscriptions.push({ dispose: () => ipc.dispose() });

  try {
    registerMcpProvider(context);
  } catch (err) {
    console.warn('[DevStack] MCP provider registration skipped:', err);
  }

  treeProvider = registerTreeView(context, runner, tracker, eventTracker);
  issuesView = registerIssuesView(context, eventTracker, tracker);
  statusBar = registerStatusBar(context, runner);

  void updateDevStackContext();
  treeProvider.refresh();
  watchWorkspaceConfig(context);

  tracker.onDidChange(() => {
    statusBar?.update();
    treeProvider?.refresh();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('devstack.runGroup', async (groupId?: string) => {
      if (!assertWorkspaceTrusted('run server groups')) {
        return;
      }

      const id = await resolveGroupId(groupId);
      if (!id) {
        return;
      }

      const config = loadMergedConfig(getDevStackWorkspaceFolder());
      if (!validateGroupId(id, config.groups.map((g) => g.id))) {
        return;
      }

      try {
        await runner!.runGroup(id);
        statusBar!.setLastGroup(id);
        statusBar!.update();
        treeProvider!.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`DevStack: ${err}`);
      }
    }),

    vscode.commands.registerCommand('devstack.stopGroup', async (groupId?: string) => {
      if (!assertWorkspaceTrusted('stop server groups')) {
        return;
      }

      const id = await resolveGroupId(groupId);
      if (!id) {
        return;
      }

      const config = loadMergedConfig(getDevStackWorkspaceFolder());
      if (!validateGroupId(id, config.groups.map((g) => g.id))) {
        return;
      }

      try {
        await runner!.stopGroup(id);
        statusBar!.update();
        treeProvider!.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`DevStack: ${err}`);
      }
    }),

    vscode.commands.registerCommand('devstack.restartGroup', async (groupId?: string) => {
      if (!assertWorkspaceTrusted('restart server groups')) {
        return;
      }

      const id = await resolveGroupId(groupId);
      if (!id) {
        return;
      }

      const config = loadMergedConfig(getDevStackWorkspaceFolder());
      if (!validateGroupId(id, config.groups.map((g) => g.id))) {
        return;
      }

      try {
        await runner!.restartGroup(id);
        statusBar!.setLastGroup(id);
        statusBar!.update();
        treeProvider!.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`DevStack: ${err}`);
      }
    }),

    vscode.commands.registerCommand(
      'devstack.runService',
      async (groupId?: string, serviceId?: string) => {
        if (!assertWorkspaceTrusted('run services')) {
          return;
        }

        const config = loadMergedConfig(getDevStackWorkspaceFolder());
        let gid = groupId;
        let sid = serviceId;

        if (!gid) {
          const group = await pickGroup('Select group for service');
          gid = group?.id;
        }
        if (!gid) {
          return;
        }

        const group = config.groups.find((g) => g.id === gid);
        if (!group || !validateGroupId(gid, config.groups.map((g) => g.id))) {
          return;
        }

        if (!sid) {
          const service = await pickService(group);
          sid = service?.id;
        }
        if (!sid || !validateServiceId(sid, group.services.map((s) => s.id))) {
          return;
        }

        try {
          await runner!.runService(gid, sid);
          statusBar!.setLastGroup(gid);
          statusBar!.update();
          treeProvider!.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`DevStack: ${err}`);
        }
      }
    ),

    vscode.commands.registerCommand('devstack.refresh', () => {
      treeProvider?.refresh();
      eventTracker?.refreshMonitoringConfig();
      issuesView?.refreshMeta();
    }),

    vscode.commands.registerCommand('devstack.runGroupFromTree', async (item: DevStackTreeItem) => {
      await vscode.commands.executeCommand('devstack.runGroup', item.groupId);
    }),

    vscode.commands.registerCommand('devstack.stopGroupFromTree', async (item: DevStackTreeItem) => {
      await vscode.commands.executeCommand('devstack.stopGroup', item.groupId);
    }),

    vscode.commands.registerCommand(
      'devstack.restartGroupFromTree',
      async (item: DevStackTreeItem) => {
        await vscode.commands.executeCommand('devstack.restartGroup', item.groupId);
      }
    ),

    vscode.commands.registerCommand(
      'devstack.runServiceFromTree',
      async (item: DevStackTreeItem) => {
        const serviceId = item.nodeId.split(':')[1];
        await vscode.commands.executeCommand('devstack.runService', item.groupId, serviceId);
      }
    )
  );
}

export function deactivate(): void {
  // disposables cleaned up via context.subscriptions
}
