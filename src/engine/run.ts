import { withOpts, type Check, type Ctx } from "./artifact.ts";
import type { Profile } from "./profile.ts";
import { selectArtifacts, type Plan } from "./plan.ts";
export { resolvePlan } from "./plan.ts";

export interface RunResult { applied: string[]; failed: string[]; skipped: string[]; checks: Record<string, Check[]> }

export async function applyPlan(plan: Plan, ctx: Ctx): Promise<RunResult> {
  const res: RunResult = { applied: [], failed: [], skipped: [], checks: {} };
  const bad = new Map<string, string>(); // artifact id → why it can't be built on

  for (const entry of plan) {
    const { artifact, state } = entry;
    const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[artifact.id]);
    if (state.kind === "blocked") {
      bad.set(artifact.id, "blocked");
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason: `blocked: ${state.reason}` });
      res.skipped.push(artifact.id);
      continue;
    }
    const upstream = artifact.requires.find((r) => bad.has(r));
    if (upstream) {
      bad.set(artifact.id, `requires "${upstream}"`);
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason: `requires "${upstream}" which ${bad.get(upstream) === "blocked" ? "is blocked" : "failed"}` });
      res.skipped.push(artifact.id);
      continue;
    }
    const runnable = entry.steps.filter((s) => {
      if (s.interactive && !ctx.interactive) {
        ctx.emit({ type: "note", level: "warn", message: `${artifact.id}: skipping "${s.title}" — needs an interactive session` });
        return false;
      }
      return true;
    });
    let failed = false;
    for (const step of runnable) {
      ctx.emit({ type: "step:start", artifact: artifact.id, step });
      try {
        await artifact.apply(c, [step]);
        ctx.emit({ type: "step:done", artifact: artifact.id, step, ok: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        ctx.emit({ type: "step:done", artifact: artifact.id, step, ok: false, error });
        failed = true;
        break;
      }
    }
    if (failed) { bad.set(artifact.id, "failed"); res.failed.push(artifact.id); }
    else if (runnable.length > 0) res.applied.push(artifact.id);
  }
  for (const entry of plan) {
    const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[entry.artifact.id]);
    const checks = await entry.artifact.verify(c);
    for (const check of checks) ctx.emit({ type: "check:result", artifact: entry.artifact.id, check });
    res.checks[entry.artifact.id] = checks;
  }
  return res;
}

export async function verifyAll(profile: Profile, ctx: Ctx): Promise<Record<string, Check[]>> {
  const out: Record<string, Check[]> = {};
  for (const artifact of selectArtifacts(profile)) {
    const c = withOpts(ctx, profile.options[artifact.id]);
    const checks = await artifact.verify(c);
    for (const check of checks) ctx.emit({ type: "check:result", artifact: artifact.id, check });
    out[artifact.id] = checks;
  }
  return out;
}

export function worstStatus(checks: Record<string, Check[]>): "ok" | "warn" | "error" {
  const all = Object.values(checks).flat();
  if (all.some((c) => c.status === "error")) return "error";
  if (all.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
