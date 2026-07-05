import * as vscode from 'vscode';

import { loadMergedConfig } from './config/loader';

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

import { registerTreeView, DevStackTreeProvider, DevStackTreeItem } from './ui/treeView';

import { registerWelcomeCommands } from './ui/welcomeView';



let tracker: ProcessTracker;

let runner: GroupRunner;

let statusBar: DevStackStatusBar;

let treeProvider: DevStackTreeProvider;

let eventTracker: EventTracker;

let issuesView: ReturnType<typeof registerIssuesView>;



function onConfigChanged(): void {

  treeProvider.refresh();

  eventTracker.refreshMonitoringConfig();

  issuesView.refreshMeta();

}



export function activate(context: vscode.ExtensionContext): void {

  tracker = new ProcessTracker();

  runner = new GroupRunner(tracker);

  eventTracker = new EventTracker(tracker);

  context.subscriptions.push(eventTracker);



  const ipc = startIpcServer(runner, tracker);

  context.subscriptions.push({ dispose: () => ipc.dispose() });



  registerMcpProvider(context);

  registerWelcomeCommands(context);

  treeProvider = registerTreeView(context, runner, tracker, eventTracker);

  issuesView = registerIssuesView(context, eventTracker, tracker);

  statusBar = registerStatusBar(context, runner);



  tracker.onDidChange(() => {

    statusBar.update();

    treeProvider.refresh();

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

      const config = loadMergedConfig(vscode.workspace.workspaceFolders?.[0]);

      if (!validateGroupId(id, config.groups.map((g) => g.id))) {

        return;

      }

      try {

        await runner.runGroup(id);

        statusBar.setLastGroup(id);

        statusBar.update();

        treeProvider.refresh();

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

      const config = loadMergedConfig(vscode.workspace.workspaceFolders?.[0]);

      if (!validateGroupId(id, config.groups.map((g) => g.id))) {

        return;

      }

      try {

        await runner.stopGroup(id);

        statusBar.update();

        treeProvider.refresh();

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

      const config = loadMergedConfig(vscode.workspace.workspaceFolders?.[0]);

      if (!validateGroupId(id, config.groups.map((g) => g.id))) {

        return;

      }

      try {

        await runner.restartGroup(id);

        statusBar.setLastGroup(id);

        statusBar.update();

        treeProvider.refresh();

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

        const config = loadMergedConfig(vscode.workspace.workspaceFolders?.[0]);

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

          await runner.runService(gid, sid);

          statusBar.setLastGroup(gid);

          statusBar.update();

          treeProvider.refresh();

        } catch (err) {

          vscode.window.showErrorMessage(`DevStack: ${err}`);

        }

      }

    ),



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

    }),



    vscode.commands.registerCommand('devstack.refresh', () => {

      treeProvider.refresh();

      eventTracker.refreshMonitoringConfig();

      issuesView.refreshMeta();

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


