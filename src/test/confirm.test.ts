import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { confirmationMessage, shouldConfirmAgentAction } from '../ipc/confirm';

describe('agent confirmation gate', () => {
  test('prompts only for agent-sourced writes when the setting is on', () => {
    assert.equal(shouldConfirmAgentAction('agent', true), true);
  });

  test('never prompts for CLI or unmarked sources', () => {
    assert.equal(shouldConfirmAgentAction('cli', true), false);
    assert.equal(shouldConfirmAgentAction(undefined, true), false);
  });

  test('setting disabled suppresses the prompt even for agents', () => {
    assert.equal(shouldConfirmAgentAction('agent', false), false);
  });

  test('message names the verb and the target', () => {
    assert.equal(
      confirmationMessage('/run', 'full-stack'),
      'An AI agent wants to start the Muster group "full-stack".'
    );
    assert.equal(
      confirmationMessage('/stop', 'full-stack', 'web'),
      'An AI agent wants to stop the Muster service "web" in "full-stack".'
    );
    assert.equal(
      confirmationMessage('/restart', 'api-only'),
      'An AI agent wants to restart the Muster group "api-only".'
    );
  });
});
