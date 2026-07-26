/**
 * Turning raw stdin chunks into dashboard events.
 *
 * A chunk is not one keypress. It can hold several mouse reports, a mouse
 * report followed by keys, several arrow sequences from key repeat, or a
 * block of pasted text. Pulling this apart is fiddly enough to be worth
 * testing on its own, away from a terminal.
 */
const MOUSE_EVENT = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
/** One CSI key sequence (arrows, home/end, F-keys) at the head of a chunk. */
const KEY_SEQUENCE = /^\x1b\[[0-9;]*[A-Za-z~]/;

export type InputToken =
  | { kind: 'mouse'; button: number; x: number; y: number; press: boolean }
  | { kind: 'key'; key: string };

export function tokenizeInput(chunk: string): InputToken[] {
  const tokens: InputToken[] = [];
  let rest = chunk;

  while (rest.length > 0) {
    const mouse = MOUSE_EVENT.exec(rest);
    if (mouse) {
      tokens.push({
        kind: 'mouse',
        button: parseInt(mouse[1], 10),
        x: parseInt(mouse[2], 10),
        y: parseInt(mouse[3], 10),
        press: mouse[4] === 'M',
      });
      rest = rest.slice(mouse[0].length);
      continue;
    }

    // Holding ↓ delivers several arrow sequences in one chunk. Treating the
    // chunk as a single chord drops all but the first, and the cursor
    // appears to stick after one row. Peel them off one at a time — but
    // only when more follows: a lone sequence, and any chunk with no escape
    // in it (pasted text, which the filter and palette accept wholesale),
    // has to arrive intact.
    const sequence = KEY_SEQUENCE.exec(rest);
    if (sequence && rest.length > sequence[0].length) {
      tokens.push({ kind: 'key', key: sequence[0] });
      rest = rest.slice(sequence[0].length);
      continue;
    }

    tokens.push({ kind: 'key', key: rest });
    return tokens;
  }

  return tokens;
}
