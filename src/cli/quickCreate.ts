/**
 * Interactive fallback for `muster create` when the group id and/or
 * command weren't given as flags. Nobody should have to read `--help`
 * before they can try the tool for the first time — if the terminal can
 * prompt, it prompts; scripts and CI (no TTY, or every flag already given)
 * are untouched and stay flag-only.
 */
import * as readline from 'node:readline/promises';
import { slugifyId } from '../config/slugify';
import { A } from './render';

export type QuickCreateAnswers = { groupId: string; command: string };

export type QuickCreateIo = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

/** Ctrl+C or a closed stream mid-question aborts rather than hangs. */
function ask(rl: readline.Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = (): void => resolve(null);
    rl.once('close', onClose);
    rl.question(prompt).then(
      (answer) => {
        rl.removeListener('close', onClose);
        resolve(answer.trim());
      },
      () => {
        rl.removeListener('close', onClose);
        resolve(null);
      }
    );
  });
}

/**
 * Fill in whichever of {groupId, command} is missing by asking for it.
 * Returns null on Ctrl+C/abort or an empty command (nothing to create).
 */
export async function promptMissingCreateFields(
  groupId: string | undefined,
  command: string | undefined,
  io: QuickCreateIo = { input: process.stdin, output: process.stdout }
): Promise<QuickCreateAnswers | null> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  const out = (line = ''): void => {
    io.output.write(line + '\n');
  };

  try {
    out();
    out(`${A.amber}${A.bold} MUSTER ${A.reset} let's set up ${groupId ? `"${groupId}"` : 'a group'}.`);
    out(`${A.dim}Enter accepts the [default]; Ctrl+C cancels.${A.reset}`);
    out();

    let resolvedCommand = command;
    if (!resolvedCommand) {
      const commandRaw = await ask(rl, `Command to run ${A.dim}(e.g. "npm run dev")${A.reset}: `);
      if (commandRaw === null) return null;
      if (!commandRaw) {
        out(`${A.dim}Nothing to create — a group needs a command. See: muster help${A.reset}`);
        return null;
      }
      resolvedCommand = commandRaw;
    }

    let resolvedGroupId = groupId;
    if (!resolvedGroupId) {
      const firstWord = resolvedCommand.trim().split(/\s+/)[0] ?? '';
      const guess = slugifyId(firstWord, 'dev');
      const idRaw = await ask(rl, `Group name ${A.dim}[${guess}]${A.reset}: `);
      if (idRaw === null) return null;
      resolvedGroupId = slugifyId(idRaw || guess, 'dev');
    }

    return { groupId: resolvedGroupId, command: resolvedCommand };
  } finally {
    rl.close();
  }
}
