import { resolveOrder, withOpts, type Artifact, type Ctx, type State, type Step } from "./artifact.ts";
import type { Profile } from "./profile.ts";

export interface PlanEntry { artifact: Artifact; state: State; steps: Step[]; opts: Record<string, unknown> }
export type Plan = PlanEntry[];

export function selectArtifacts(profile: Profile, filter: { only?: string[]; skip?: string[] } = {}): Artifact[] {
  const byId = new Map(profile.artifacts.map((a) => [a.id, a]));
  const wanted = new Set<string>();
  const pull = (a: Artifact) => {
    if (wanted.has(a.id)) return;
    wanted.add(a.id);
    for (const r of a.requires) { const dep = byId.get(r); if (dep) pull(dep); }     // an unknown id is left for resolveOrder to report
  };
  for (const a of profile.artifacts) if (a.surfaces.some((s) => profile.surfaces.includes(s))) pull(a);
  const ordered = resolveOrder(profile.artifacts.filter((a) => wanted.has(a.id)));
  return ordered.filter((a) => (!filter.only || filter.only.includes(a.id)) && !(filter.skip ?? []).includes(a.id));
}

export async function resolvePlan(profile: Profile, ctx: Ctx, filter: { only?: string[]; skip?: string[] } = {}): Promise<Plan> {
  const plan: Plan = [];
  for (const artifact of selectArtifacts(profile, filter)) {
    const opts = profile.options[artifact.id] ?? {};
    const c = withOpts(ctx, opts);
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
    plan.push({ artifact, state, steps, opts });
  }
  return plan;
}
