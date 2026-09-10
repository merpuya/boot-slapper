import type { Env, Surface } from "./env.ts";
import type { EngineEvent } from "./events.ts";
import type { Io } from "./io.ts";
import type { SecretRef, SecretStore } from "./secrets/store.ts";

export type Portability = "portable" | "translatable" | "device-bound" | "non-transferable";

export type State =
  | { kind: "absent"; details?: string[] }
  | { kind: "present" }
  | { kind: "drifted"; details: string[] }
  | { kind: "blocked"; reason: string };

export interface Step { id: string; title: string; interactive?: boolean; secret?: SecretRef }
export type CheckStatus = "ok" | "warn" | "error";
export interface Check { id: string; status: CheckStatus; message: string }

export class InteractiveRequired extends Error {
  constructor(label: string) { super(`interactive input required: ${label}`); this.name = "InteractiveRequired"; }
}

export interface Prompter {
  secret(label: string): Promise<string>;
  confirm(label: string): Promise<boolean>;
  gate(label: string): Promise<void>;
}

export interface Ctx {
  env: Env; io: Io; secrets: SecretStore; prompt: Prompter; interactive: boolean;
  opts: Record<string, unknown>;
  emit(e: EngineEvent): void;
}

export interface Artifact {
  id: string;
  surfaces: Surface[];
  portability: Portability;
  requires: string[];
  detect(ctx: Ctx): Promise<State>;
  plan(ctx: Ctx, state: State): Step[];
  apply(ctx: Ctx, steps: Step[]): Promise<void>;
  verify(ctx: Ctx): Promise<Check[]>;
}

export function withOpts(ctx: Ctx, opts: Record<string, unknown> | undefined): Ctx {
  return { ...ctx, opts: opts ?? {} };
}

/** Kahn's algorithm; peers keep declaration order so plans are stable. */
export function resolveOrder(artifacts: Artifact[]): Artifact[] {
  // Check for duplicate IDs before building dependency graph
  const seen = new Set<string>();
  for (const a of artifacts) {
    if (seen.has(a.id)) throw new Error(`duplicate artifact id "${a.id}"`);
    seen.add(a.id);
  }
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  for (const a of artifacts) for (const r of a.requires) {
    if (!byId.has(r)) throw new Error(`artifact "${a.id}" requires unknown artifact "${r}"`);
  }
  const indeg = new Map(artifacts.map((a) => [a.id, a.requires.length]));
  const out: Artifact[] = [];
  const ready = artifacts.filter((a) => a.requires.length === 0);
  while (ready.length) {
    const a = ready.shift()!;
    out.push(a);
    for (const b of artifacts) if (b.requires.includes(a.id)) {
      const n = indeg.get(b.id)! - 1; indeg.set(b.id, n);
      if (n === 0) ready.push(b);
    }
  }
  if (out.length !== artifacts.length) {
    const stuck = artifacts.filter((a) => !out.includes(a)).map((a) => a.id);
    throw new Error(`dependency cycle among artifacts: ${stuck.join(", ")}`);
  }
  return out;
}
