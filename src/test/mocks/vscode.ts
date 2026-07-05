/** Minimal vscode stub for node --test bundles (real API is only in the extension host). */
export const Uri = {
  file: (fsPath: string) => ({ fsPath }),
  joinPath: (base: { fsPath: string }, ...segments: string[]) => {
    const parts = [base.fsPath, ...segments].filter(Boolean);
    return { fsPath: parts.join('/').replace(/\/+/g, '/') };
  },
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
  }),
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    createDirectory: async () => undefined,
  },
};

const vscode = { Uri, workspace };
export default vscode;