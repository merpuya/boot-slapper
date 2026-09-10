import type { Check, State, Step } from "./artifact.ts";

export type EngineEvent =
  | { type: "artifact:detected"; id: string; state: State }
  | { type: "artifact:skipped"; id: string; reason: string }
  | { type: "step:start"; artifact: string; step: Step }
  | { type: "step:done"; artifact: string; step: Step; ok: boolean; error?: string }
  | { type: "prompt:needed"; artifact: string; step: Step }
  | { type: "check:result"; artifact: string; check: Check }
  | { type: "note"; level: "info" | "warn" | "error"; message: string };
