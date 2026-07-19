import * as vscode from 'vscode';

import { loadMergedConfig } from './config/loader';
import { getMusterWorkspaceFolder, hasWorkspaceConfigFile } from './config/workspaceFolder';
import { startIpcServer } from './ipc/server';
import { EventTracker } from './monitoring/eventTracker';
import { registerMcpProvider } from './mcpProvider';
import { GroupRunner } from './orchestration/groupRunner';
import { MusterNarrator } from './orchestration/narrator';
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
import { registerStatusBar, MusterStatusBar } from './ui/statusBar';
import { registerTreeView, MusterTreeProvider, MusterTreeItem, musterHasGroups } from './ui/treeView';
import { registerWelcomeCommands } from './ui/welcomeView';

let tracker: ProcessTracker | undefined;
let runner: GroupRunner | undefined;
let statusBar: MusterStatusBar | undefined;
let treeProvider: MusterTreeProvider | undefined;
let eventTracker: EventTracker | undefined;
let issuesView: ReturnType<typeof registerIssuesView> | undefined;

let logChannel: vscode.OutputChannel | undefined;

/** Internal diagnostic logger. Lazily creates the "Muster" output channel. */
export function musterLog(message: string): void {
  try {
    if (!logChannel) {
      logChannel = vscode.window.createOutputChannel('Muster');
    }
    logChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  } catch {
    // Logging must never throw into activate().
  }
}

function musterLogError(phase: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  musterLog(`ERROR during ${phase}: ${detail}`);
  try {
    void vscode.window.showErrorMessage(`Muster: ${phase} failed — see "Muster" output channel.`);
  } catch {
    // ignore
  }
}

function onConfigChanged(): void {
  void updateMusterContext();
  treeProvider?.refresh();
  eventTracker?.refreshMonitoringConfig();
  issuesView?.refreshMeta();
}

async function updateMusterContext(): Promise<void> {
  const folder = getMusterWorkspaceFolder();
  const hasConfigFile = hasWorkspaceConfigFile(folder);
  const hasGroups = musterHasGroups();

  await vscode.commands.executeCommand('setContext', 'muster.hasConfigFile', hasConfigFile);
  await vscode.commands.executeCommand('setContext', 'muster.hasGroups', hasGroups);
}

function watchWorkspaceConfig(context: vscode.ExtensionContext): void {
  const folder = getMusterWorkspaceFolder();
  if (!folder) {
    return;
  }

  const pattern = new vscode.RelativePattern(folder, '.vscode/muster.json');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const refresh = (): void => onConfigChanged();

  watcher.onDidChange(refresh);
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);
}

function registerConfigCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('muster.openConfig', () => openConfigEditor()),
    vscode.commands.registerCommand('muster.openVisualEditor', () =>
      openVisualConfigEditor(context, onConfigChanged)
    ),
    vscode.commands.registerCommand('muster.createGroup', () =>
      createGroupQuick(context, onConfigChanged)
    ),
    vscode.commands.registerCommand('muster.importExample', () =>
      importExampleConfig(context, onConfigChanged)
    ),
    vscode.commands.registerCommand('muster.editGroup', (item?: MusterTreeItem) => {
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
  musterLog('activate start');
  musterLog(`extensionPath=${context.extensionPath}`);
  musterLog(`workspaceFolders=${vscode.workspace.workspaceFolders?.length ?? 0}`);

  // Keep the output channel alive for the session.
  if (logChannel) {
    context.subscriptions.push(logChannel);
  } else {
    logChannel = vscode.window.createOutputChannel('Muster');
    context.subscriptions.push(logChannel);
    musterLog('output channel created (late)');
  }

  try {
    registerWelcomeCommands(context);
    musterLog('step ok: registerWelcomeCommands');
  } catch (err) {
    musterLogError('registerWelcomeCommands', err);
  }

  try {
    registerConfigCommands(context);
    musterLog('step ok: registerConfigCommands');
  } catch (err) {
    musterLogError('registerConfigCommands', err);
  }

  try {
    tracker = new ProcessTracker();
    const narrator = new MusterNarrator();
    runner = new GroupRunner(tracker, narrator);
    context.subscriptions.push(tracker, narrator);
    musterLog('step ok: ProcessTracker/GroupRunner');
  } catch (err) {
    musterLogError('ProcessTracker/GroupRunner', err);
  }

  try {
    if (tracker) {
      eventTracker = new EventTracker(tracker);
      context.subscriptions.push(eventTracker);
      musterLog('step ok: EventTracker');
    } else {
      musterLog('SKIP EventTracker: tracker missing');
    }
  } catch (err) {
    musterLogError('EventTracker', err);
  }

  // Register sidebar views before optional services so panels always have providers.
  try {
    if (runner && tracker) {
      treeProvider = registerTreeView(context, runner, tracker, eventTracker);
      musterLog('step ok: registerTreeView (muster.groups)');
    } else {
      musterLog('SKIP registerTreeView: runner/tracker missing');
    }
  } catch (err) {
    musterLogError('registerTreeView', err);
  }

  try {
    if (eventTracker && tracker) {
      issuesView = registerIssuesView(context, eventTracker, tracker);
      musterLog('step ok: registerIssuesView (muster.issues)');
    } else {
      musterLog('SKIP registerIssuesView: eventTracker/tracker missing');
    }
  } catch (err) {
    musterLogError('registerIssuesView', err);
  }

  try {
    statusBar = registerStatusBar(context, runner!);
    musterLog('step ok: registerStatusBar');
  } catch (err) {
    musterLogError('registerStatusBar', err);
  }

  try {
    registerMcpProvider(context);
    musterLog('step ok: registerMcpProvider');
  } catch (err) {
    musterLog('MCP provider registration skipped (non-fatal): ' + (err instanceof Error ? err.message : String(err)));
  }

  try {
    const ipc = startIpcServer(runner!, tracker!);
    context.subscriptions.push({ dispose: () => ipc.dispose() });
    musterLog('step ok: startIpcServer');
  } catch (err) {
    musterLog('IPC server skipped (non-fatal): ' + (err instanceof Error ? err.message : String(err)));
  }

  try {
    void updateMusterContext();
    musterLog('step ok: updateMusterContext (async)');
  } catch (err) {
    musterLogError('updateMusterContext', err);
  }

  try {
    treeProvider?.refresh();
    musterLog('step ok: initial treeProvider.refresh');
  } catch (err) {
    musterLogError('treeProvider.refresh', err);
  }

  try {
    watchWorkspaceConfig(context);
    musterLog('step ok: watchWorkspaceConfig');
  } catch (err) {
    musterLogError('watchWorkspaceConfig', err);
  }

  try {
    tracker?.onDidChange(() => {
      statusBar?.update();
      treeProvider?.refresh();
    });
    musterLog('step ok: tracker.onDidChange wiring');
  } catch (err) {
    musterLogError('tracker.onDidChange wiring', err);
  }

  // Log config snapshot so we can prove whether the file is being found/parsed.
  try {
    const folder = getMusterWorkspaceFolder();
    const cfgPath = folder ? `${folder.uri.fsPath}/.vscode/muster.json` : '<no workspace>';
    const hasFile = hasWorkspaceConfigFile(folder);
    let groupCount = -1;
    try {
      groupCount = loadMergedConfig(folder).groups.length;
    } catch (e) {
      musterLog(`config load threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    musterLog(`config snapshot: folder=${folder?.name ?? 'none'} path=${cfgPath} hasFile=${hasFile} groups=${groupCount}`);
  } catch (err) {
    musterLogError('config snapshot', err);
  }

  try {
    context.subscriptions.push(
      vscode.commands.registerCommand('muster.runGroup', async (groupId?: string) => {
        if (!assertWorkspaceTrusted('run server groups')) {
          return;
        }

        const id = await resolveGroupId(groupId);
        if (!id) {
          return;
        }

        const config = loadMergedConfig(getMusterWorkspaceFolder());
        if (!validateGroupId(id, config.groups.map((g) => g.id))) {
          return;
        }

        try {
          await runner!.runGroup(id);
          statusBar!.setLastGroup(id);
          statusBar!.update();
          treeProvider!.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`Muster: ${err}`);
        }
      }),

      vscode.commands.registerCommand('muster.stopGroup', async (groupId?: string) => {
        if (!assertWorkspaceTrusted('stop server groups')) {
          return;
        }

        const id = await resolveGroupId(groupId);
        if (!id) {
          return;
        }

        const config = loadMergedConfig(getMusterWorkspaceFolder());
        if (!validateGroupId(id, config.groups.map((g) => g.id))) {
          return;
        }

        try {
          await runner!.stopGroup(id);
          statusBar!.update();
          treeProvider!.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`Muster: ${err}`);
        }
      }),

      vscode.commands.registerCommand('muster.restartGroup', async (groupId?: string) => {
        if (!assertWorkspaceTrusted('restart server groups')) {
          return;
        }

        const id = await resolveGroupId(groupId);
        if (!id) {
          return;
        }

        const config = loadMergedConfig(getMusterWorkspaceFolder());
        if (!validateGroupId(id, config.groups.map((g) => g.id))) {
          return;
        }

        try {
          await runner!.restartGroup(id);
          statusBar!.setLastGroup(id);
          statusBar!.update();
          treeProvider!.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`Muster: ${err}`);
        }
      }),

      vscode.commands.registerCommand(
        'muster.runService',
        async (groupId?: string, serviceId?: string) => {
          if (!assertWorkspaceTrusted('run services')) {
            return;
          }

          const config = loadMergedConfig(getMusterWorkspaceFolder());
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
            vscode.window.showErrorMessage(`Muster: ${err}`);
          }
        }
      ),

      vscode.commands.registerCommand('muster.refresh', () => {
        treeProvider?.refresh();
        eventTracker?.refreshMonitoringConfig();
        issuesView?.refreshMeta();
      }),

      vscode.commands.registerCommand('muster.runGroupFromTree', async (item: MusterTreeItem) => {
        await vscode.commands.executeCommand('muster.runGroup', item.groupId);
      }),

      vscode.commands.registerCommand('muster.stopGroupFromTree', async (item: MusterTreeItem) => {
        await vscode.commands.executeCommand('muster.stopGroup', item.groupId);
      }),

      vscode.commands.registerCommand(
        'muster.restartGroupFromTree',
        async (item: MusterTreeItem) => {
          await vscode.commands.executeCommand('muster.restartGroup', item.groupId);
        }
      ),

      vscode.commands.registerCommand(
        'muster.runServiceFromTree',
        async (item: MusterTreeItem) => {
          const serviceId = item.nodeId.split(':')[1];
          await vscode.commands.executeCommand('muster.runService', item.groupId, serviceId);
        }
      )
    );
    musterLog('step ok: register runtime commands');
  } catch (err) {
    musterLogError('register runtime commands', err);
  }

  musterLog('activate complete');
}

export function deactivate(): void {
  // disposables cleaned up via context.subscriptions
}
