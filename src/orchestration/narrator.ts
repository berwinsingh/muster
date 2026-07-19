import * as vscode from 'vscode';

/**
 * The "Muster" orchestrator terminal: a read-only pseudoterminal that
 * narrates group lifecycle — launches, ready checks, dependency order,
 * final status — in one branded feed, matching the product's terminal
 * aesthetic. Service terminals stay untouched; this is the conductor's
 * score, not the instruments.
 *
 * Lazily created on first write; recreated automatically if the user
 * closes it. Disabled via the muster.orchestratorTerminal setting.
 */
export class MusterNarrator {
  private terminal: vscode.Terminal | undefined;
  private writeEmitter: vscode.EventEmitter<string> | undefined;
  private opened = false;
  private buffered: string[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((closed) => {
        if (closed === this.terminal) {
          this.terminal = undefined;
          this.writeEmitter = undefined;
          this.opened = false;
          this.buffered = [];
        }
      })
    );
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('muster')
      .get<boolean>('orchestratorTerminal', true);
  }

  private ensureTerminal(): void {
    if (this.terminal) {
      return;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    this.writeEmitter = writeEmitter;
    this.opened = false;

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        this.opened = true;
        for (const line of this.buffered) {
          writeEmitter.fire(line);
        }
        this.buffered = [];
      },
      close: () => {
        // closing is handled via onDidCloseTerminal above
      },
      handleInput: () => {
        // read-only narration feed
      },
    };

    this.terminal = vscode.window.createTerminal({ name: 'Muster', pty });
  }

  /** Write one narration line (no trailing newline needed). */
  writeLine(text: string): void {
    if (!this.isEnabled()) {
      return;
    }
    this.ensureTerminal();
    const payload = `${text}\r\n`;
    // Output fired before the pty opens is dropped by VS Code, so buffer it.
    if (this.opened && this.writeEmitter) {
      this.writeEmitter.fire(payload);
    } else {
      this.buffered.push(payload);
    }
  }

  /** Blank spacer line between runs. */
  writeGap(): void {
    this.writeLine('');
  }

  /** Bring the narrator into view without stealing focus. */
  reveal(): void {
    if (!this.isEnabled()) {
      return;
    }
    this.ensureTerminal();
    this.terminal?.show(true);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.terminal?.dispose();
    this.terminal = undefined;
  }
}
