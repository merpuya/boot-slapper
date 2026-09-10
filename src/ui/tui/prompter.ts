import type { Prompter } from "../../engine/artifact.ts";

export type PendingKind = "secret" | "text" | "confirm" | "gate";
export interface Pending { kind: PendingKind; label: string; fallback?: string; submit(value: string): void }

/** A Prompter whose calls surface as a Pending for the UI to render; submit() clears it and settles the promise. */
export function bridgePrompter(onPending: (p: Pending | null) => void): Prompter {
  const ask = (kind: PendingKind, label: string, fallback?: string) => new Promise<string>((resolve) => {
    onPending({ kind, label, fallback, submit: (v) => { onPending(null); resolve(v); } });
  });
  return {
    secret: (label) => ask("secret", label),
    text: async (label, fallback) => { const v = (await ask("text", label, fallback)).trim(); return v || fallback || ""; },
    confirm: async (label) => /^y(es)?$/i.test((await ask("confirm", label)).trim()),
    gate: async (label) => { await ask("gate", label); },
  };
}
