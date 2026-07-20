import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectServiceEnv } from '../cli/detect';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muster-detect-'));
}

function makeVenv(dir: string, name: string): void {
  fs.mkdirSync(path.join(dir, name, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'bin', 'activate'), '# venv');
}

function strip(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('detectServiceEnv', () => {
  test('python command + existing venv → auto-applies it', () => {
    const dir = tempDir();
    makeVenv(dir, '.venv');
    const report = detectServiceEnv('uvicorn main:app --reload', dir);
    assert.ok(report.needsPython);
    assert.deepEqual(report.apply.python, { venv: '.venv' });
    assert.equal(report.warnings.length, 0);
    assert.ok(report.notes.some((n) => strip(n).includes('will be activated')));
  });

  test('prefers .venv when several venvs exist', () => {
    const dir = tempDir();
    makeVenv(dir, 'env');
    makeVenv(dir, '.venv');
    const report = detectServiceEnv('python app.py', dir);
    assert.equal(report.apply.python?.venv, '.venv');
  });

  test('python project markers without a venv → warning', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'flask');
    const report = detectServiceEnv('flask run', dir);
    assert.ok(report.needsPython);
    assert.equal(report.apply.python, undefined);
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0], /no virtualenv/);
  });

  test('configured venv that exists is respected, not re-applied', () => {
    const dir = tempDir();
    makeVenv(dir, 'custom-env');
    const report = detectServiceEnv('python app.py', dir, { python: { venv: 'custom-env' } });
    assert.equal(report.apply.python, undefined);
    assert.equal(report.warnings.length, 0);
    assert.ok(report.notes.some((n) => strip(n).includes('custom-env')));
  });

  test('configured venv that is missing → warning', () => {
    const dir = tempDir();
    const report = detectServiceEnv('python app.py', dir, { python: { venv: '.venv' } });
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0], /not found/);
  });

  test('node command with .nvmrc → applies the pin', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, '.nvmrc'), 'v20.11.0\n');
    const report = detectServiceEnv('npm run dev', dir);
    assert.ok(report.needsNode);
    assert.deepEqual(report.apply.node, { version: '20.11.0' });
    assert.equal(report.warnings.length, 0);
  });

  test('engines range is informational, never applied as a pin', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=18' } }));
    const report = detectServiceEnv('npm start', dir);
    assert.equal(report.apply.node, undefined);
    assert.ok(report.notes.some((n) => strip(n).includes('>=18')));
  });

  test('non-python non-node command needs no environment', () => {
    const dir = tempDir();
    const report = detectServiceEnv('./bin/server --port 9000', dir);
    assert.ok(!report.needsPython);
    assert.ok(!report.needsNode);
    assert.deepEqual(report.apply, {});
    assert.equal(report.warnings.length, 0);
    assert.ok(report.notes.some((n) => strip(n).includes('no environment needed')));
  });

  test('go/rust projects with a package.json-free dir stay clean', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module example');
    const report = detectServiceEnv('go run ./cmd/server', dir);
    assert.deepEqual(report.apply, {});
    assert.equal(report.warnings.length, 0);
  });
});
