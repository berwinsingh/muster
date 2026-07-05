import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventTracker } from '../monitoring/eventTracker';
import { GroupRunner } from '../orchestration/groupRunner';
import { ProcessTracker } from '../orchestration/processTracker';
import { ISSUES_VIEW_ID, registerIssuesView } from '../ui/issuesView';
import { TREE_VIEW_ID, registerTreeView } from '../ui/treeView';

type RecordedCall = { name: string; args: unknown[] };

const recorded: RecordedCall[] = [];

const vscodeMock = require('vscode') as {
  window: {
    createTreeView: (...args: unknown[]) => { dispose: () => void };
    registerWebviewViewProvider: (...args: unknown[]) => { dispose: () => void };
  };
  EventEmitter: new <T>() => {
    event: T;
    fire: (value: T) => void;
    dispose: () => void;
  };
  TreeItem: new (label: string, collapsibleState: number) => {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    description?: string;
    iconPath?: unknown;
    tooltip?: string;
    command?: unknown;
  };
  TreeItemCollapsibleState: { None: number; Collapsed: number; Expanded: number };
  ThemeIcon: new (id: string, color?: unknown) => { id: string };
  ThemeColor: new (id: string) => { id: string };
  languages: { onDidChangeDiagnostics: () => { dispose: () => void }; getDiagnostics: () => [] };
  workspace: {
    workspaceFolders?: Array<{ uri: { fsPath: string } }>;
    getConfiguration: () => { get: <T>(_key: string, defaultValue?: T) => T };
    createFileSystemWatcher: () => {
      onDidChange: () => void;
      onDidCreate: () => void;
      onDidDelete: () => void;
      dispose: () => void;
    };
  };
  commands: { registerCommand: () => { dispose: () => void }; executeCommand: () => Promise<void> };
  Uri: { file: (path: string) => { fsPath: string } };
  RelativePattern: new (base: unknown, pattern: string) => { base: unknown; pattern: string };
};

vscodeMock.window.createTreeView = (...args: unknown[]) => {
  recorded.push({ name: 'createTreeView', args });
  return { dispose: () => undefined, onDidChangeSelection: { dispose: () => undefined } };
};

vscodeMock.window.registerWebviewViewProvider = (...args: unknown[]) => {
  recorded.push({ name: 'registerWebviewViewProvider', args });
  return { dispose: () => undefined };
};

vscodeMock.languages = {
  onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
  getDiagnostics: () => [],
};

vscodeMock.EventEmitter = class {
  event = () => undefined;
  fire() {
    return undefined;
  }
  dispose() {
    return undefined;
  }
} as unknown as typeof vscodeMock.EventEmitter;

vscodeMock.TreeItem = class {
  label: string;
  collapsibleState: number;
  constructor(label: string, collapsibleState: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
};

vscodeMock.TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
vscodeMock.ThemeIcon = class {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
};
vscodeMock.ThemeColor = class {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
};

vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: process.cwd() } }];
vscodeMock.workspace.createFileSystemWatcher = () => ({
  onDidChange: () => undefined,
  onDidCreate: () => undefined,
  onDidDelete: () => undefined,
  dispose: () => undefined,
});
vscodeMock.commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: async () => undefined,
};
vscodeMock.Uri = { file: (path: string) => ({ fsPath: path }) };
vscodeMock.RelativePattern = class {
  base: unknown;
  pattern: string;
  constructor(base: unknown, pattern: string) {
    this.base = base;
    this.pattern = pattern;
  }
};

describe('provider registration', () => {
  it('registerTreeView calls createTreeView with package view id', () => {
    recorded.length = 0;
    const context = { subscriptions: [] as Array<{ dispose: () => void }> };
    const tracker = new ProcessTracker();
    const runner = new GroupRunner(tracker);
    const eventTracker = new EventTracker(tracker);

    registerTreeView(context as never, runner, tracker, eventTracker);

    const treeCall = recorded.find((call) => call.name === 'createTreeView');
    assert.ok(treeCall, 'createTreeView should be called during registration');
    assert.equal(treeCall?.args[0], TREE_VIEW_ID);
    assert.equal(typeof (treeCall?.args[1] as { treeDataProvider?: unknown })?.treeDataProvider, 'object');
  });

  it('registerIssuesView calls registerWebviewViewProvider with package view id', () => {
    recorded.length = 0;
    const context = { subscriptions: [] as Array<{ dispose: () => void }> };
    const tracker = new ProcessTracker();
    const eventTracker = new EventTracker(tracker);

    registerIssuesView(context as never, eventTracker, tracker);

    const issuesCall = recorded.find((call) => call.name === 'registerWebviewViewProvider');
    assert.ok(issuesCall, 'registerWebviewViewProvider should be called during registration');
    assert.equal(issuesCall?.args[0], ISSUES_VIEW_ID);
    assert.equal(typeof issuesCall?.args[1], 'object');
  });
});
