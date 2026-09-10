import { resolveOrder, withOpts, type Artifact, type Ctx, type State, type Step } from "./artifact.ts";
import type { Profile } from "./profile.ts";

export interface PlanEntry { artifact: Artifact; state: State; steps: Step[] }
export type Plan = PlanEntry[];

export function selectArtifacts(profile: Profile, filter: { only?: string[]; skip?: string[] } = {}): Artifact[] {
  const onSurface = profile.artifacts.filter((a) => a.surfaces.some((s) => profile.surfaces.includes(s)));
  const ordered = resolveOrder(onSurface);
  return ordered.filter((a) => (!filter.only || filter.only.includes(a.id)) && !(filter.skip ?? []).includes(a.id));
}

export async function resolvePlan(profile: Profile, ctx: Ctx, filter: { only?: string[]; skip?: string[] } = {}): Promise<Plan> {
  const plan: Plan = [];
  for (const artifact of selectArtifacts(profile, filter)) {
    const c = withOpts(ctx, profile.options[artifact.id]);
    let state: State;
    try {
      state = await artifact.detect(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state = { kind: "blocked", reason: `detect threw: ${msg}` };
    }
    let steps: Step[] = [];
    if (state.kind !== "blocked") {
      try {
        steps = artifact.plan(c, state);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        state = { kind: "blocked", reason: `plan threw: ${msg}` };
        steps = [];
      }
    }
    ctx.emit({ type: "artifact:detected", id: artifact.id, state });
    plan.push({ artifact, state, steps });
  }
  return plan;
}
