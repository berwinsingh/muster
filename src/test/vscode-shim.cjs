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
  },
};

Module.prototype.require = function (id, ...args) {
  if (id === 'vscode') {
    return vscodeMock;
  }
  return originalRequire.call(this, id, ...args);
};
