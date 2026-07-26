import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';
import { localConfigPort } from '../cli/configPort';

const CONFIG = {
  version: '1.0.0',
  groups: [
    {
      id: 'org',
      label: 'Org',
      layout: 'dedicated',
      order: 'parallel',
      services: [
        { id: 'python-ai', name: 'Python AI', command: 'uvicorn main:app' },
        { id: 'web', name: 'Web', command: 'pnpm dev' },
      ],
    },
  ],
};

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-port-'));
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, '.vscode', 'muster.json'), JSON.stringify(CONFIG, null, 2));
  return root;
}

function read(root: string): typeof CONFIG {
  return JSON.parse(fs.readFileSync(path.join(root, '.vscode', 'muster.json'), 'utf-8'));
}

describe('the dashboard writing to config', () => {
  test('a service patch lands on disk', () => {
    const root = workspace();
    try {
      const port = localConfigPort(root, () => true);
      port.update({
        kind: 'service',
        groupId: 'org',
        serviceId: 'python-ai',
        patch: { commands: ['. venv/bin/activate', 'uvicorn main:app'] },
      });
      const svc = read(root).groups[0].services[0] as Record<string, unknown>;
      assert.deepEqual(svc.commands, ['. venv/bin/activate', 'uvicorn main:app']);
      assert.equal(svc.command, undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reads through on every call, so an edit made elsewhere is seen', () => {
    const root = workspace();
    try {
      const port = localConfigPort(root, () => true);
      assert.equal(port.group('org')?.services.length, 2);

      const external = read(root);
      external.groups[0].services.push({ id: 'worker', name: 'Worker', command: 'sleep 1' });
      fs.writeFileSync(
        path.join(root, '.vscode', 'muster.json'),
        JSON.stringify(external, null, 2)
      );
      assert.equal(port.group('org')?.services.length, 3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('says a restart is needed when the group is still running', () => {
    const root = workspace();
    try {
      const stale = localConfigPort(root, () => false);
      const message = stale.update({
        kind: 'service',
        groupId: 'org',
        serviceId: 'web',
        patch: { command: 'pnpm start' },
      });
      assert.match(message, /restart org to apply/);

      const live = localConfigPort(root, () => true);
      const applied = live.update({
        kind: 'service',
        groupId: 'org',
        serviceId: 'web',
        patch: { command: 'pnpm dev' },
      });
      assert.doesNotMatch(applied, /restart/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('adding and removing a service round-trips', () => {
    const root = workspace();
    try {
      const port = localConfigPort(root, () => true);
      port.update({
        kind: 'add-service',
        groupId: 'org',
        service: { id: 'worker', name: 'worker', command: 'npm run worker' },
      });
      assert.equal(port.group('org')?.services.length, 3);

      port.update({ kind: 'delete-service', groupId: 'org', serviceId: 'worker' });
      assert.equal(port.group('org')?.services.length, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejections come back as messages worth showing, and change nothing', () => {
    const root = workspace();
    try {
      const port = localConfigPort(root, () => true);
      assert.throws(
        () =>
          port.update({
            kind: 'add-service',
            groupId: 'org',
            service: { id: 'web', name: 'Web', command: 'x' },
          }),
        /already exists/
      );
      assert.throws(
        () => port.update({ kind: 'delete-service', groupId: 'nope', serviceId: 'web' }),
        /Unknown group/
      );
      assert.equal(port.group('org')?.services.length, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('the last service of a group is protected — delete the group instead', () => {
    const root = workspace();
    try {
      const port = localConfigPort(root, () => true);
      port.update({ kind: 'delete-service', groupId: 'org', serviceId: 'web' });
      assert.throws(
        () => port.update({ kind: 'delete-service', groupId: 'org', serviceId: 'python-ai' }),
        /delete the group instead/
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('deleting a group does not ask for a restart of something that is gone', () => {
    const root = workspace();
    try {
      const port = localConfigPort(root, () => false);
      const message = port.update({ kind: 'delete-group', groupId: 'org' });
      assert.doesNotMatch(message, /restart/);
      assert.equal(port.group('org'), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unknown group reads as null rather than throwing at the draw loop', () => {
    const root = workspace();
    try {
      assert.equal(localConfigPort(root, () => true).group('ghost'), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
