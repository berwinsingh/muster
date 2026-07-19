import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { effectiveCommand, GroupSchema, ServiceSchema } from '../config/schema';
import { buildServiceCommand } from '../orchestration/shell';
import { buildServiceEnv } from '../config/env';
import { runHooks } from '../orchestration/hooks';

const base = { id: 'api', name: 'API' };

describe('stacked commands', () => {
  test('accepts a commands list and joins with &&', () => {
    const svc = ServiceSchema.parse({ ...base, commands: ['npm ci', 'npm run dev'] });
    assert.equal(effectiveCommand(svc), 'npm ci && npm run dev');
  });

  test('rejects a service with both command and commands', () => {
    assert.throws(() =>
      ServiceSchema.parse({ ...base, command: 'a', commands: ['b'] })
    );
  });

  test('rejects a service with neither command nor commands', () => {
    assert.throws(() => ServiceSchema.parse(base));
  });

  test('buildServiceCommand chains prepends before the joined list', () => {
    const svc = ServiceSchema.parse({
      ...base,
      commands: ['npm run build', 'npm run dev'],
      shell: { prepend: ['source .env.sh'] },
    });
    assert.equal(
      buildServiceCommand(svc),
      'source .env.sh && npm run build && npm run dev'
    );
  });
});

describe('nvm stays explicit', () => {
  test('no node.version means no nvm prepend at launch', () => {
    const svc = ServiceSchema.parse({ ...base, command: 'npm run dev' });
    assert.equal(buildServiceCommand(svc), 'npm run dev');
  });

  test('explicit node.version still prepends nvm use', () => {
    const svc = ServiceSchema.parse({
      ...base,
      command: 'npm run dev',
      node: { version: '20' },
    });
    assert.equal(buildServiceCommand(svc), 'nvm use 20 && npm run dev');
  });
});

describe('service port', () => {
  test('validates range and rejects nonsense', () => {
    ServiceSchema.parse({ ...base, command: 'x', port: 8000 });
    assert.throws(() => ServiceSchema.parse({ ...base, command: 'x', port: 0 }));
    assert.throws(() => ServiceSchema.parse({ ...base, command: 'x', port: 70000 }));
  });

  test('substitutes ${port} in the command', () => {
    const svc = ServiceSchema.parse({
      ...base,
      command: 'uvicorn main:app --port ${port}',
      port: 8000,
    });
    assert.equal(effectiveCommand(svc), 'uvicorn main:app --port 8000');
  });

  test('injects PORT env var without overriding explicit env', () => {
    const injected = buildServiceEnv({ port: 3000 });
    assert.equal(injected.PORT, '3000');

    const explicit = buildServiceEnv({ port: 3000, env: { PORT: '4000' } });
    assert.equal(explicit.PORT, '4000');
  });
});

describe('group hooks', () => {
  test('schema accepts preRun/postStop and rejects unknown keys', () => {
    GroupSchema.parse({
      id: 'g',
      label: 'G',
      hooks: { preRun: ['wg-quick up work'], postStop: ['wg-quick down work'] },
      services: [{ ...base, command: 'x' }],
    });
    assert.throws(() =>
      GroupSchema.parse({
        id: 'g',
        label: 'G',
        hooks: { onBoot: ['x'] },
        services: [{ ...base, command: 'x' }],
      })
    );
  });

  test('runHooks runs sequentially and narrates each command', async () => {
    const lines: string[] = [];
    await runHooks('preRun', ['true', 'true'], undefined, (l) => lines.push(l));
    assert.deepEqual(lines, ['preRun: true', 'preRun: true']);
  });

  test('runHooks throws on failure, identifying the command', async () => {
    await assert.rejects(
      () => runHooks('preRun', ['true', 'exit 3', 'true'], undefined, () => {}),
      /preRun hook failed \(exit 3\): exit 3/
    );
  });
});
