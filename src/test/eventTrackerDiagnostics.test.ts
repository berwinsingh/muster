import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { EventTracker } from '../monitoring/eventTracker';
import { ProcessTracker } from '../orchestration/processTracker';

const vscodeMock = require('vscode') as {
  languages: {
    onDidChangeDiagnostics: () => { dispose: () => void };
    getDiagnostics: () => [];
  };
  workspace: {
    workspaceFolders?: Array<{ uri: { fsPath: string } }>;
    getConfiguration: () => { get: <T>(_key: string, defaultValue?: T) => T };
  };
  EventEmitter: new <T>() => {
    event: T;
    fire: (value: T) => void;
    dispose: () => void;
  };
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

describe('EventTracker constructor resilience', () => {
  it('does not throw when workspace config cwd is outside workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'muster-event-tracker-'));
    mkdirSync(join(root, '.vscode'), { recursive: true });
    writeFileSync(
      join(root, '.vscode', 'muster.json'),
      JSON.stringify(
        {
          version: '1.0.0',
          groups: [
            {
              id: 'dev',
              label: 'Development',
              layout: 'dedicated',
              order: 'parallel',
              services: [
                {
                  id: 'api',
                  name: 'API',
                  command: 'npm run dev',
                  cwd: '/tmp/outside-workspace',
                },
              ],
            },
          ],
        },
        null,
        2
      )
    );

    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
    vscodeMock.workspace.getConfiguration = () => ({
      get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
    });

    const tracker = new ProcessTracker();
    assert.doesNotThrow(() => new EventTracker(tracker));
  });
});
