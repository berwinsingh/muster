/** Preload hook so bundled tests can require("vscode") outside the extension host. */
const Module = require('module');
const originalRequire = Module.prototype.require;

const vscodeMock = {
  Uri: {
    file: (fsPath) => ({ fsPath }),
    joinPath: (base, ...segments) => ({
      fsPath: [base.fsPath, ...segments].filter(Boolean).join('/').replace(/\/+/g, '/'),
    }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key, defaultValue) => defaultValue,
    }),
    fs: {
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
      createDirectory: async () => undefined,
    },
    workspaceFolders: undefined,
    createFileSystemWatcher: () => ({
      onDidChange: () => undefined,
      onDidCreate: () => undefined,
      onDidDelete: () => undefined,
      dispose: () => undefined,
    }),
  },
  window: {
    createTreeView: () => ({ dispose: () => undefined }),
    registerWebviewViewProvider: () => ({ dispose: () => undefined }),
  },
  languages: {
    onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
    getDiagnostics: () => [],
  },
  commands: {
    registerCommand: () => ({ dispose: () => undefined }),
    executeCommand: async () => undefined,
  },
  EventEmitter: class {
    event = () => undefined;
    fire() {
      return undefined;
    }
    dispose() {
      return undefined;
    }
  },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    constructor(id) {
      this.id = id;
    }
  },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  RelativePattern: class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
};

Module.prototype.require = function (id, ...args) {
  if (id === 'vscode') {
    return vscodeMock;
  }
  return originalRequire.call(this, id, ...args);
};
