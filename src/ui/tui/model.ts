import type { Check, Portability, State, Step } from "../../engine/artifact.ts";
import type { EngineEvent } from "../../engine/events.ts";
import type { Plan } from "../../engine/plan.ts";

export type Phase = "planning" | "confirm" | "applying" | "verifying" | "done" | "aborted";
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";
export interface StepRow { id: string; title: string; interactive: boolean; status: StepStatus; error?: string }
export interface ArtifactRow { id: string; portability: Portability | null; state: State | null; steps: StepRow[]; skipped?: string; checks: Check[] }
export interface Note { level: "info" | "warn" | "error"; message: string }
export interface Model { phase: Phase; rows: ArtifactRow[]; notes: Note[]; exitCode: number | null }
export type Action =
  | EngineEvent
  | { type: "plan:resolved"; plan: Plan }
  | { type: "artifacts"; list: Array<{ id: string; portability: Portability }> }
  | { type: "phase"; phase: Phase }
  | { type: "exit"; code: number };

export const initialModel = (): Model => ({ phase: "planning", rows: [], notes: [], exitCode: null });

export function stateLabel(s: State | null): string {
  if (!s) return "…";
  if (s.kind === "blocked") return `blocked — ${s.reason}`;
  const d = "details" in s && s.details?.length ? ` — ${s.details.join("; ")}` : "";
  return `${s.kind}${d}`;
}

const upsert = (rows: ArtifactRow[], id: string, f: (r: ArtifactRow) => ArtifactRow): ArtifactRow[] => {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return [...rows, f({ id, portability: null, state: null, steps: [], checks: [] })];
  return rows.map((r, j) => (j === i ? f(r) : r));
};
const setStep = (r: ArtifactRow, step: Step, patch: Partial<StepRow>): ArtifactRow => {
  const i = r.steps.findIndex((s) => s.id === step.id);
  const base: StepRow = i < 0 ? { id: step.id, title: step.title, interactive: !!step.interactive, status: "pending" } : r.steps[i];
  const next = { ...base, ...patch };
  return { ...r, steps: i < 0 ? [...r.steps, next] : r.steps.map((s, j) => (j === i ? next : s)) };
};

export function reduce(m: Model, a: Action): Model {
  switch (a.type) {
    case "plan:resolved": return { ...m, rows: a.plan.map((p) => ({ id: p.artifact.id, portability: p.artifact.portability, state: p.state, steps: p.steps.map((s) => ({ id: s.id, title: s.title, interactive: !!s.interactive, status: "pending" as const })), checks: [] })) };
    case "artifacts": return { ...m, rows: a.list.map((x) => ({ id: x.id, portability: x.portability, state: null, steps: [], checks: [] })) };
    case "phase": return { ...m, phase: a.phase };
    case "exit": return { ...m, exitCode: a.code, phase: m.phase === "aborted" ? "aborted" : "done" };
    case "artifact:detected": return { ...m, rows: upsert(m.rows, a.id, (r) => ({ ...r, state: a.state })) };
    case "artifact:skipped": return { ...m, rows: upsert(m.rows, a.id, (r) => ({ ...r, skipped: a.reason, steps: r.steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped" as const } : s)) })) };
    case "step:start": return { ...m, rows: upsert(m.rows, a.artifact, (r) => setStep(r, a.step, { status: "running" })) };
    case "step:done": return { ...m, rows: upsert(m.rows, a.artifact, (r) => setStep(r, a.step, a.ok ? { status: "ok" } : { status: "failed", error: a.error ?? "failed" })) };
    case "prompt:needed": return m;
    case "check:result": return { ...m, rows: upsert(m.rows, a.artifact, (r) => ({ ...r, checks: [...r.checks, a.check] })) };
    case "note": return { ...m, notes: [...m.notes, { level: a.level, message: a.message }] };
  }
}

export function summary(rows: ArtifactRow[]): { ok: number; warn: number; error: number } {
  const all = rows.flatMap((r) => r.checks);
  return { ok: all.filter((c) => c.status === "ok").length, warn: all.filter((c) => c.status === "warn").length, error: all.filter((c) => c.status === "error").length };
}
