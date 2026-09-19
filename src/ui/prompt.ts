import { createInterface } from "node:readline";
import { InteractiveRequired, type Prompter } from "../engine/artifact.ts";

export function headlessPrompter(): Prompter {
  return {
    secret: async (l) => { throw new InteractiveRequired(l); },
    text: async (l) => { throw new InteractiveRequired(l); },
    confirm: async (l) => { throw new InteractiveRequired(l); },
    gate: async (l) => { throw new InteractiveRequired(l); },
  };
}

/** Streams `ask` talks to. Injectable so the hidden-echo behaviour is testable without a real tty. */
export interface AskStreams { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }

/**
 * Ask one question, optionally muting the typed answer.
 *
 * `rl.question(question, …)` is given the real prompt even when hidden, so **readline owns the prompt
 * string** and redraws it correctly. The earlier version passed `""` and wrote the prompt by hand — so
 * readline, believing its prompt was empty, redrew an empty line over it (`ESC[1G ESC[0J`: cursor to
 * column 1, erase to end of screen) and erased the text that had just been printed. On most terminals
 * the write and the erase raced and the prompt usually survived; in Windows PowerShell the erase won
 * every time, leaving `bs secrets set` waiting at a blank line with no visible prompt — it looked like
 * it had exited. Found 2026-09-18 on yogaNovo while storing a MeCP device token; this is the
 * `_writeToOutput` guard that was deferred in the Phase 1 cleanups.
 *
 * `_writeToOutput` is private readline API, hence the defensive shape: echo any write carrying the
 * prompt (initial draw and every redraw), collapse a write containing a newline to a bare newline, and
 * drop everything else — which is exactly the typed characters. If a future Node stops calling it, the
 * failure is a visible echo rather than a lost prompt.
 */
function ask(question: string, hidden: boolean, streams?: AskStreams): Promise<string> {
  return new Promise((resolve) => {
    const input = streams?.input ?? process.stdin;
    const output = streams?.output ?? process.stdout;
    const rl = createInterface({ input, output, terminal: true });
    if (hidden) {
      const priv = rl as unknown as { _writeToOutput: (s: string) => void };
      const orig = priv._writeToOutput;
      priv._writeToOutput = (s: string) => {
        if (s.includes(question)) orig.call(rl, question);
        else if (s.includes("\n")) orig.call(rl, "\n");
      };
    }
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

export function ttyPrompter(streams?: AskStreams): Prompter {
  return {
    secret: (label) => ask(`    ${label} (blank to skip): `, true, streams),
    text: async (label, fallback) => {
      const a = (await ask(`    ${label}${fallback ? ` [${fallback}]` : ""}: `, false, streams)).trim();
      return a || fallback || "";
    },
    confirm: async (label) => /^y(es)?$/i.test((await ask(`    ${label} [y/N] `, false, streams)).trim()),
    gate: async (label) => { await ask(`    ${label} — press Enter when done `, false, streams); },
  };
}
