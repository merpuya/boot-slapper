import { describe, expect, it } from "vitest";
import type { Artifact, Ctx, Step } from "../../../src/engine/artifact.ts";
import { InteractiveRequired } from "../../../src/engine/artifact.ts";
import type { EngineEvent } from "../../../src/engine/events.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "../../../src/engine/run.ts";
import { resolveEnv, probeEnv } from "../../../src/engine/env.ts";
import { selectStore } from "../../../src/engine/secrets/store.ts";
import type { Profile } from "../../../src/engine/profile.ts";

async function makeCtx(interactive = false): Promise<{ ctx: Ctx; events: EngineEvent[] }> {
  const io = new FakeIo();
  const env = resolveEnv(await probeEnv(io), "gateway", "code");
  const events: EngineEvent[] = [];
  const ctx: Ctx = {
    env, io, secrets: selectStore(env, io), interactive, opts: {},
    prompt: {
      secret: async (l) => { if (!interactive) throw new InteractiveRequired(l); return "v"; },
      text: async (l) => { if (!interactive) throw new InteractiveRequired(l); return "v"; },
      confirm: async () => true, gate: async () => {},
    },
    emit: (e) => events.push(e),
  };
  return { ctx, events };
}

function art(id: string, o: { requires?: string[]; absent?: boolean; blocked?: boolean; detectThrows?: boolean; planThrows?: boolean; steps?: Step[]; failOn?: string; applied?: string[]; verifyThrows?: boolean }): Artifact {
  return {
    id, requires: o.requires ?? [], surfaces: ["code"], portability: "portable",
    detect: async () => {
      if (o.detectThrows) throw new Error(`detect boom ${id}`);
      if (o.blocked) return { kind: "blocked", reason: `${id} is blocked` };
      return o.absent ? { kind: "absent" } : { kind: "present" };
    },
    plan: (_c, s) => {
      if (o.planThrows) throw new Error(`plan boom ${id}`);
      return s.kind === "absent" ? (o.steps ?? [{ id: `${id}.do`, title: `do ${id}` }]) : [];
    },
    apply: async (_c, steps) => {
      for (const s of steps) { if (s.id === o.failOn) throw new Error(`boom ${s.id}`); o.applied?.push(s.id); }
    },
    verify: async () => {
      if (o.verifyThrows) throw new Error("verify boom");
      return [{ id: `${id}.ok`, status: "ok", message: "fine" }];
    },
  };
}

const profile = (artifacts: Artifact[]): Profile => ({ name: "t", provider: "gateway", surfaces: ["code"], artifacts, options: {} });

describe("resolvePlan", () => {
  it("emits detected states and empty steps for present artifacts", async () => {
    const { ctx, events } = await makeCtx();
    const plan = await resolvePlan(profile([art("a", {}), art("b", { absent: true })]), ctx);
    expect(plan.map((p) => [p.artifact.id, p.state.kind, p.steps.length])).toEqual([["a", "present", 0], ["b", "absent", 1]]);
    expect(events.filter((e) => e.type === "artifact:detected")).toHaveLength(2);
  });
  it("honours --only and --skip", async () => {
    const { ctx } = await makeCtx();
    const p = profile([art("a", {}), art("b", {}), art("c", {})]);
    expect((await resolvePlan(p, ctx, { only: ["b"] })).map((e) => e.artifact.id)).toEqual(["b"]);
    expect((await resolvePlan(p, ctx, { skip: ["b"] })).map((e) => e.artifact.id)).toEqual(["a", "c"]);
  });
  it("excludes artifacts for surfaces the profile does not target", async () => {
    const { ctx } = await makeCtx();
    const d: Artifact = { ...art("d", {}), surfaces: ["desktop"] };
    expect((await resolvePlan(profile([art("a", {}), d]), ctx)).map((e) => e.artifact.id)).toEqual(["a"]);
  });
  it("a throwing detect yields blocked and its sibling still plans normally", async () => {
    const { ctx, events } = await makeCtx();
    const a = art("a", { detectThrows: true });
    const b = art("b", { absent: true });
    const plan = await resolvePlan(profile([a, b]), ctx);
    expect(plan.map((p) => [p.artifact.id, p.state])).toEqual([
      ["a", { kind: "blocked", reason: "detect threw: detect boom a" }],
      ["b", { kind: "absent" }],
    ]);
    expect(plan[0].steps).toEqual([]);
    expect(events.filter((e) => e.type === "artifact:detected")).toHaveLength(2);
  });
  it("a throwing plan yields blocked and its sibling still plans normally", async () => {
    const { ctx } = await makeCtx();
    const a = art("a", { absent: true, planThrows: true });
    const b = art("b", { absent: true });
    const plan = await resolvePlan(profile([a, b]), ctx);
    expect(plan[0]).toMatchObject({ state: { kind: "blocked", reason: "plan threw: plan boom a" }, steps: [] });
    expect(plan[1]).toMatchObject({ state: { kind: "absent" } });
    expect(plan[1].steps.length).toBeGreaterThan(0);
  });
});

describe("applyPlan", () => {
  it("applies in order, skips dependents of a failed artifact, and still verifies everything", async () => {
    const { ctx, events } = await makeCtx();
    const applied: string[] = [];
    const a = art("a", { absent: true, applied, steps: [{ id: "a.1", title: "" }, { id: "a.2", title: "" }], failOn: "a.2" });
    const b = art("b", { absent: true, applied, requires: ["a"] });
    const c = art("c", { absent: true, applied });
    const res = await applyPlan(await resolvePlan(profile([a, b, c]), ctx), ctx);
    expect(applied).toEqual(["a.1", "c.do"]);
    expect(res.failed).toEqual(["a"]);
    expect(res.skipped).toEqual(["b"]);
    expect(res.applied).toEqual(["c"]);
    expect(Object.keys(res.checks).sort()).toEqual(["a", "b", "c"]);
    const done = events.filter((e) => e.type === "step:done") as Extract<EngineEvent, { type: "step:done" }>[];
    expect(done.find((e) => e.step.id === "a.2")?.ok).toBe(false);
    expect(done.find((e) => e.step.id === "a.2")?.error).toMatch(/boom a.2/);
    expect(events.find((e) => e.type === "artifact:skipped")).toMatchObject({ id: "b", reason: 'requires "a" which failed' });
  });
  it("skips interactive steps headlessly with a warning instead of failing", async () => {
    const { ctx, events } = await makeCtx(false);
    const applied: string[] = [];
    const a = art("a", { absent: true, applied, steps: [{ id: "a.ask", title: "ask", interactive: true }, { id: "a.2", title: "" }] });
    const res = await applyPlan(await resolvePlan(profile([a]), ctx), ctx);
    expect(applied).toEqual(["a.2"]);
    expect(res.failed).toEqual([]);
    expect(events.find((e) => e.type === "note" && e.level === "warn")).toBeTruthy();
  });
  it("a throwing verify becomes an error check instead of aborting the run", async () => {
    const { ctx } = await makeCtx();
    const a = art("a", { verifyThrows: true });
    const b = art("b", {});
    const res = await applyPlan(await resolvePlan(profile([a, b]), ctx), ctx);
    expect(res.checks.a).toEqual([{ id: "verify", status: "error", message: "verify threw: verify boom" }]);
    expect(res.checks.b[0].status).toBe("ok");
    const all = await verifyAll(profile([a, b]), ctx);
    expect(all.a[0].id).toBe("verify");
  });
  it("present artifacts land in unchanged so the accounting sums to the plan length", async () => {
    const { ctx } = await makeCtx();
    const plan = await resolvePlan(profile([art("a", {}), art("b", { absent: true })]), ctx);
    const res = await applyPlan(plan, ctx);
    expect(res.unchanged).toEqual(["a"]);
    expect(res.applied).toEqual(["b"]);
    expect(res.applied.length + res.failed.length + res.skipped.length + res.unchanged.length).toBe(plan.length);
  });
  it("a three-deep chain: blocked prereqs → skipped b → c's reason mentions 'was skipped'", async () => {
    const { ctx, events } = await makeCtx();
    const prereqs = art("prereqs", { blocked: true });
    const b = art("b", { requires: ["prereqs"] });
    const c = art("c", { requires: ["b"] });
    const res = await applyPlan(await resolvePlan(profile([prereqs, b, c]), ctx), ctx);
    expect(res.skipped).toEqual(["prereqs", "b", "c"]);
    const skippedEvents = events.filter((e) => e.type === "artifact:skipped") as Extract<EngineEvent, { type: "artifact:skipped" }>[];
    expect(skippedEvents.find((e) => e.id === "b")?.reason).toBe('requires "prereqs" which is blocked');
    expect(skippedEvents.find((e) => e.id === "c")?.reason).toMatch(/was skipped/);
  });
  it("an artifact whose only steps are interactive-and-headless-filtered is skipped, not unchanged", async () => {
    const { ctx, events } = await makeCtx(false);
    const a = art("a", { absent: true, steps: [{ id: "a.ask", title: "ask", interactive: true }] });
    const res = await applyPlan(await resolvePlan(profile([a]), ctx), ctx);
    expect(res.unchanged).toEqual([]);
    expect(res.skipped).toEqual(["a"]);
    expect(events).toContainEqual({ type: "artifact:skipped", id: "a", reason: "all steps need an interactive session" });
    expect(res.applied.length + res.failed.length + res.skipped.length + res.unchanged.length).toBe(1);
  });
  it("warns, but proceeds, when --only cuts a requires edge", async () => {
    const { ctx, events } = await makeCtx();
    const applied: string[] = [];
    const p = profile([art("a", { absent: true, applied }), art("b", { absent: true, applied, requires: ["a"] })]);
    const res = await applyPlan(await resolvePlan(p, ctx, { only: ["b"] }), ctx);
    expect(applied).toEqual(["b.do"]);
    expect(res.applied).toEqual(["b"]);
    expect(events).toContainEqual({ type: "note", level: "warn", message: 'b: requires "a", which is not in this plan (--only/--skip) — proceeding anyway' });
  });
  it("hands each artifact its own profile options via PlanEntry.opts, not ctx.opts", async () => {
    const { ctx } = await makeCtx();
    const seen: unknown[] = [];
    const a: Artifact = { ...art("a", { absent: true }), apply: async (c) => { seen.push(c.opts); }, verify: async (c) => { seen.push(c.opts); return []; } };
    const p: Profile = { ...profile([a]), options: { a: { flag: 1 } } };
    const plan = await resolvePlan(p, ctx);
    expect(plan[0].opts).toEqual({ flag: 1 });
    await applyPlan(plan, { ...ctx, opts: {} });
    expect(seen).toEqual([{ flag: 1 }, { flag: 1 }]);
  });
  it("emits one check:result per check from verify, in both drivers", async () => {
    const { ctx, events } = await makeCtx();
    const a = art("a", {});
    await applyPlan(await resolvePlan(profile([a]), ctx), ctx);
    expect(events.filter((e) => e.type === "check:result")).toEqual([{ type: "check:result", artifact: "a", check: { id: "a.ok", status: "ok", message: "fine" } }]);
    events.length = 0;
    await verifyAll(profile([a]), ctx);
    expect(events.filter((e) => e.type === "check:result")).toHaveLength(1);
  });
});

describe("verifyAll / worstStatus", () => {
  it("collects checks per artifact and folds to the worst status", async () => {
    const { ctx } = await makeCtx();
    const checks = await verifyAll(profile([art("a", {}), art("b", {})]), ctx);
    expect(checks.a[0].status).toBe("ok");
    expect(worstStatus(checks)).toBe("ok");
    expect(worstStatus({ x: [{ id: "x", status: "warn", message: "" }], y: [{ id: "y", status: "error", message: "" }] })).toBe("error");
  });
});
