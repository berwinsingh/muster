import * as assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { promptMissingCreateFields } from '../cli/quickCreate';

/** Drive the prompt with scripted answers, capturing what it printed. */
async function run(
  groupId: string | undefined,
  command: string | undefined,
  answers: string[]
): Promise<{ result: Awaited<ReturnType<typeof promptMissingCreateFields>>; output: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => {
    text += String(chunk);
  });

  const done = promptMissingCreateFields(groupId, command, { input, output });
  // readline/promises drops lines that arrive while no question is
  // pending, so pace the answers one per event-loop turn.
  for (const answer of answers) {
    input.write(answer + '\n');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }
  input.end();
  return { result: await done, output: text };
}

describe('muster create prompts only for what is missing', () => {
  it('asks for the command when only the group id was given', async () => {
    const { result, output } = await run('web', undefined, ['npm run dev']);
    assert.deepEqual(result, { groupId: 'web', command: 'npm run dev' });
    assert.match(output, /Command to run/);
    // The group id was supplied, so it must not be asked for again.
    assert.doesNotMatch(output, /Group name/);
  });

  it('asks for the group id when only the command was given, guessing a default', async () => {
    // Empty answer accepts the default, derived from the command's first word.
    const { result, output } = await run(undefined, 'pnpm dev', ['']);
    assert.deepEqual(result, { groupId: 'pnpm', command: 'pnpm dev' });
    assert.match(output, /Group name/);
    assert.doesNotMatch(output, /Command to run/);
  });

  it('asks for both when neither was given', async () => {
    const { result, output } = await run(undefined, undefined, ['npm start', 'backend']);
    assert.deepEqual(result, { groupId: 'backend', command: 'npm start' });
    assert.match(output, /Command to run/);
    assert.match(output, /Group name/);
  });

  it('slugifies a group name typed with spaces and capitals', async () => {
    const { result } = await run(undefined, 'npm start', ['My API Server']);
    assert.ok(result);
    assert.equal(result!.groupId, 'my-api-server');
  });

  it('aborts (returns null) when the command is left empty', async () => {
    // Nothing to create without a command — must not write a broken group.
    const { result, output } = await run('web', undefined, ['']);
    assert.equal(result, null);
    assert.match(output, /a group needs a command/i);
  });

  it('aborts when the input stream closes mid-question rather than hanging', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const result = promptMissingCreateFields('web', undefined, { input, output });
    input.end(); // stands in for Ctrl+C / a closed pipe
    assert.equal(await result, null);
  });
});
