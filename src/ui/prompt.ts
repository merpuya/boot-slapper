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

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    if (hidden) {
      // Mute the echo while the answer is typed; readline still receives the keystrokes.
      const orig = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.includes("\n")) orig.call(rl, "\n"); };
      out.write(question);
    }
    rl.question(hidden ? "" : question, (answer) => { rl.close(); resolve(answer); });
  });
}

export function ttyPrompter(): Prompter {
  return {
    secret: (label) => ask(`    ${label} (blank to skip): `, true),
    text: async (label, fallback) => {
      const a = (await ask(`    ${label}${fallback ? ` [${fallback}]` : ""}: `, false)).trim();
      return a || fallback || "";
    },
    confirm: async (label) => /^y(es)?$/i.test((await ask(`    ${label} [y/N] `, false)).trim()),
    gate: async (label) => { await ask(`    ${label} — press Enter when done `, false); },
  };
}
