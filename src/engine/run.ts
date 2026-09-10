import { withOpts, type Artifact, type Check, type Ctx } from "./artifact.ts";
import type { Profile } from "./profile.ts";
import { selectArtifacts, type Plan } from "./plan.ts";
export { resolvePlan } from "./plan.ts";

export interface RunResult { applied: string[]; failed: string[]; skipped: string[]; unchanged: string[]; checks: Record<string, Check[]> }

async function safeVerify(artifact: Artifact, c: Ctx, emit: Ctx["emit"]): Promise<Check[]> {
  try {
    return await artifact.verify(c);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const check: Check = { id: "verify", status: "error", message: `verify threw: ${error}` };
    emit({ type: "check:result", artifact: artifact.id, check });
    return [check];
  }
}

export async function applyPlan(plan: Plan, ctx: Ctx): Promise<RunResult> {
  const res: RunResult = { applied: [], failed: [], skipped: [], unchanged: [], checks: {} };
  const bad = new Map<string, string>(); // artifact id → why it can't be built on
  const planIds = new Set(plan.map((p) => p.artifact.id));

  for (const entry of plan) {
    const { artifact, state } = entry;
    const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[artifact.id]);
    if (state.kind === "blocked") {
      bad.set(artifact.id, "blocked");
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason: `blocked: ${state.reason}` });
      res.skipped.push(artifact.id);
      continue;
    }
    for (const r of artifact.requires) {
      if (!planIds.has(r)) {
        ctx.emit({ type: "note", level: "warn", message: `${artifact.id}: requires "${r}", which is not in this plan (--only/--skip) — proceeding anyway` });
      }
    }
    const upstream = artifact.requires.find((r) => bad.has(r));
    if (upstream) {
      const stored = bad.get(upstream)!;
      const describe = stored === "blocked" ? "is blocked" : stored === "failed" ? "failed" : `was skipped (${stored})`;
      const reason = `requires "${upstream}" which ${describe}`;
      bad.set(artifact.id, reason);
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason });
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
    else if (entry.steps.length > 0) {
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason: "all steps need an interactive session" });
      res.skipped.push(artifact.id);
    } else res.unchanged.push(artifact.id);
  }
  for (const entry of plan) {
    const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[entry.artifact.id]);
    const checks = await safeVerify(entry.artifact, c, ctx.emit);
    res.checks[entry.artifact.id] = checks;
  }
  return res;
}

export async function verifyAll(profile: Profile, ctx: Ctx): Promise<Record<string, Check[]>> {
  const out: Record<string, Check[]> = {};
  for (const artifact of selectArtifacts(profile)) {
    const c = withOpts(ctx, profile.options[artifact.id]);
    const checks = await safeVerify(artifact, c, ctx.emit);
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
