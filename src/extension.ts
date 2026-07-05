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

let logChannel: vscode.OutputChannel | undefined;

/** Internal diagnostic logger. Lazily creates the "DevStack" output channel. */
export function devstackLog(message: string): void {
  try {
    if (!logChannel) {
      logChannel = vscode.window.createOutputChannel('DevStack');
    }
    logChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  } catch {
    // Logging must never throw into activate().
  }
}

function devstackLogError(phase: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  devstackLog(`ERROR during ${phase}: ${detail}`);
  try {
    void vscode.window.showErrorMessage(`DevStack: ${phase} failed — see "DevStack" output channel.`);
  } catch {
    // ignore
  }
}

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
  devstackLog('activate start');
  devstackLog(`extensionPath=${context.extensionPath}`);
  devstackLog(`workspaceFolders=${vscode.workspace.workspaceFolders?.length ?? 0}`);

  // Keep the output channel alive for the session.
  if (logChannel) {
    context.subscriptions.push(logChannel);
  } else {
    logChannel = vscode.window.createOutputChannel('DevStack');
    context.subscriptions.push(logChannel);
    devstackLog('output channel created (late)');
  }

  try {
    registerWelcomeCommands(context);
    devstackLog('step ok: registerWelcomeCommands');
  } catch (err) {
    devstackLogError('registerWelcomeCommands', err);
  }

  try {
    registerConfigCommands(context);
    devstackLog('step ok: registerConfigCommands');
  } catch (err) {
    devstackLogError('registerConfigCommands', err);
  }

  try {
    tracker = new ProcessTracker();
    runner = new GroupRunner(tracker);
    context.subscriptions.push(tracker);
    devstackLog('step ok: ProcessTracker/GroupRunner');
  } catch (err) {
    devstackLogError('ProcessTracker/GroupRunner', err);
  }

  try {
    if (tracker) {
      eventTracker = new EventTracker(tracker);
      context.subscriptions.push(eventTracker);
      devstackLog('step ok: EventTracker');
    } else {
      devstackLog('SKIP EventTracker: tracker missing');
    }
  } catch (err) {
    devstackLogError('EventTracker', err);
  }

  // Register sidebar views before optional services so panels always have providers.
  try {
    if (runner && tracker) {
      treeProvider = registerTreeView(context, runner, tracker, eventTracker);
      devstackLog('step ok: registerTreeView (devstack.groups)');
    } else {
      devstackLog('SKIP registerTreeView: runner/tracker missing');
    }
  } catch (err) {
    devstackLogError('registerTreeView', err);
  }

  try {
    if (eventTracker && tracker) {
      issuesView = registerIssuesView(context, eventTracker, tracker);
      devstackLog('step ok: registerIssuesView (devstack.issues)');
    } else {
      devstackLog('SKIP registerIssuesView: eventTracker/tracker missing');
    }
  } catch (err) {
    devstackLogError('registerIssuesView', err);
  }

  try {
    statusBar = registerStatusBar(context, runner!);
    devstackLog('step ok: registerStatusBar');
  } catch (err) {
    devstackLogError('registerStatusBar', err);
  }

  try {
    registerMcpProvider(context);
    devstackLog('step ok: registerMcpProvider');
  } catch (err) {
    devstackLog('MCP provider registration skipped (non-fatal): ' + (err instanceof Error ? err.message : String(err)));
  }

  try {
    const ipc = startIpcServer(runner!, tracker!);
    context.subscriptions.push({ dispose: () => ipc.dispose() });
    devstackLog('step ok: startIpcServer');
  } catch (err) {
    devstackLog('IPC server skipped (non-fatal): ' + (err instanceof Error ? err.message : String(err)));
  }

  try {
    void updateDevStackContext();
    devstackLog('step ok: updateDevStackContext (async)');
  } catch (err) {
    devstackLogError('updateDevStackContext', err);
  }

  try {
    treeProvider?.refresh();
    devstackLog('step ok: initial treeProvider.refresh');
  } catch (err) {
    devstackLogError('treeProvider.refresh', err);
  }

  try {
    watchWorkspaceConfig(context);
    devstackLog('step ok: watchWorkspaceConfig');
  } catch (err) {
    devstackLogError('watchWorkspaceConfig', err);
  }

  try {
    tracker?.onDidChange(() => {
      statusBar?.update();
      treeProvider?.refresh();
    });
    devstackLog('step ok: tracker.onDidChange wiring');
  } catch (err) {
    devstackLogError('tracker.onDidChange wiring', err);
  }

  // Log config snapshot so we can prove whether the file is being found/parsed.
  try {
    const folder = getDevStackWorkspaceFolder();
    const cfgPath = folder ? `${folder.uri.fsPath}/.vscode/devstack.json` : '<no workspace>';
    const hasFile = hasWorkspaceConfigFile(folder);
    let groupCount = -1;
    try {
      groupCount = loadMergedConfig(folder).groups.length;
    } catch (e) {
      devstackLog(`config load threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    devstackLog(`config snapshot: folder=${folder?.name ?? 'none'} path=${cfgPath} hasFile=${hasFile} groups=${groupCount}`);
  } catch (err) {
    devstackLogError('config snapshot', err);
  }

  try {
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
    devstackLog('step ok: register runtime commands');
  } catch (err) {
    devstackLogError('register runtime commands', err);
  }

  devstackLog('activate complete');
}

export function deactivate(): void {
  // disposables cleaned up via context.subscriptions
}
