import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';
import {
  editConfigTarget,
  editorCommand,
  findServiceLine,
  resolveEditor,
} from '../cli/editConfig';

const CONFIG = {
  version: '1.0.0',
  groups: [
    {
      id: 'org',
      label: 'Org',
      layout: 'dedicated',
      order: 'parallel',
      services: [
        { id: 'web', name: 'Web', command: 'npm run dev' },
        { id: 'python-ai', name: 'Python AI', command: 'uvicorn main:app' },
      ],
    },
  ],
};

/** A workspace whose $EDITOR replaces the config with `next` (or leaves it). */
function workspace(next?: unknown): { root: string; env: NodeJS.ProcessEnv } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-edit-'));
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.vscode', 'muster.json'),
    JSON.stringify(CONFIG, null, 2)
  );
  const editor = path.join(root, 'fake-editor.js');
  fs.writeFileSync(
    editor,
    next === undefined
      ? 'process.exit(0);\n'
      : `require('fs').writeFileSync(process.argv[2], ${JSON.stringify(
          typeof next === 'string' ? next : JSON.stringify(next, null, 2)
        )});\n`
  );
  return { root, env: { PATH: process.env.PATH, EDITOR: `${process.execPath} ${editor}` } };
}

describe('finding a service in the config file', () => {
  const source = JSON.stringify(CONFIG, null, 2);

  test('points at the service, not the group', () => {
    const line = findServiceLine(source, 'org', 'python-ai');
    assert.match(source.split('\n')[line - 1], /"id": "python-ai"/);
  });

  test('points at the group when no service is given', () => {
    const line = findServiceLine(source, 'org');
    assert.match(source.split('\n')[line - 1], /"id": "org"/);
  });

  test('falls back to line 1 rather than guessing', () => {
    assert.equal(findServiceLine(source, 'nope', 'web'), 1);
  });

  test('an unknown service still lands inside its group', () => {
    assert.equal(findServiceLine(source, 'org', 'ghost'), findServiceLine(source, 'org'));
  });
});

describe('editor command lines', () => {
  test('vim-family editors take +LINE before the file', () => {
    assert.deepEqual(editorCommand('vim', '/w/muster.json', 12), {
      cmd: 'vim',
      args: ['+12', '/w/muster.json'],
    });
  });

  test('VS Code forks get --wait, or we redraw over the edit', () => {
    const { cmd, args } = editorCommand('code', '/w/muster.json', 12);
    assert.equal(cmd, 'code');
    assert.ok(args.includes('--wait'));
    assert.deepEqual(args.slice(-2), ['--goto', '/w/muster.json:12']);
  });

  test('an explicit --wait is not doubled up', () => {
    const { args } = editorCommand('code --wait', '/w/muster.json', 3);
    assert.equal(args.filter((a) => a === '--wait').length, 1);
  });

  test('unknown editors just get the path — a wrong flag is worse', () => {
    assert.deepEqual(editorCommand('my-editor', '/w/muster.json', 12), {
      cmd: 'my-editor',
      args: ['/w/muster.json'],
    });
  });

  test('a full path to a known editor is still recognized', () => {
    assert.deepEqual(editorCommand('/usr/bin/nano', '/w/muster.json', 5).args, [
      '+5',
      '/w/muster.json',
    ]);
  });
});

describe('choosing an editor', () => {
  test('VISUAL wins over EDITOR', () => {
    assert.equal(resolveEditor({ VISUAL: 'nvim', EDITOR: 'vi' }, () => true), 'nvim');
  });

  test('falls back to whatever is installed', () => {
    assert.equal(resolveEditor({}, (cmd) => cmd === 'vim'), 'vim');
  });

  test('reports nothing rather than spawning a missing command', () => {
    assert.equal(resolveEditor({}, () => false), null);
  });
});

describe('editing config from the dashboard', () => {
  test('a saved change is reported against the service it belongs to', () => {
    const { root, env } = workspace({
      ...CONFIG,
      groups: [
        {
          ...CONFIG.groups[0],
          services: [
            CONFIG.groups[0].services[0],
            { id: 'python-ai', name: 'Python AI', commands: ['. .venv/bin/activate', 'uvicorn main:app'] },
          ],
        },
      ],
    });
    try {
      const outcome = editConfigTarget(root, 'org', 'python-ai', env);
      assert.equal(outcome.message, 'org/python-ai saved');
      assert.equal(outcome.changed, true);
      assert.equal(outcome.valid, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('quitting the editor untouched is not reported as a change', () => {
    const { root, env } = workspace();
    try {
      const outcome = editConfigTarget(root, 'org', 'web', env);
      assert.equal(outcome.changed, false);
      assert.match(outcome.message, /unchanged/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a broken save is flagged, and the file is left as the user wrote it', () => {
    // Both `command` and `commands` — the schema refuses it. The user's
    // work stays on disk; reverting it would be worse than complaining.
    const broken = {
      ...CONFIG,
      groups: [
        {
          ...CONFIG.groups[0],
          services: [{ id: 'web', name: 'Web', command: 'a', commands: ['b'] }],
        },
      ],
    };
    const { root, env } = workspace(broken);
    try {
      const outcome = editConfigTarget(root, 'org', 'web', env);
      assert.equal(outcome.valid, false);
      assert.equal(outcome.changed, true);
      assert.match(outcome.message, /^⚠/);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(root, '.vscode', 'muster.json'), 'utf-8')),
        broken
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('unparseable JSON is reported, not thrown at the dashboard', () => {
    const { root, env } = workspace('{ this is not json');
    try {
      const outcome = editConfigTarget(root, 'org', 'web', env);
      assert.equal(outcome.valid, false);
      assert.match(outcome.message, /^⚠/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('says so when there is no editor to open', () => {
    const { root } = workspace();
    try {
      const outcome = editConfigTarget(root, 'org', 'web', { PATH: '' });
      assert.match(outcome.message, /\$EDITOR/);
      assert.equal(outcome.changed, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing config is a message, not a crash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-noconf-'));
    try {
      const outcome = editConfigTarget(root, 'org', 'web', {});
      assert.match(outcome.message, /muster\.json/);
      assert.equal(outcome.changed, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
