import { describe, expect, it } from "vitest";
import type { Plan } from "../../../src/engine/plan.ts";
import { initialModel, reduce, stateLabel, summary, type Action, type Model } from "../../../src/ui/tui/model.ts";

const plan = [{ artifact: { id: "a", portability: "portable" }, state: { kind: "absent" }, steps: [{ id: "a.1", title: "one" }, { id: "a.2", title: "two", interactive: true }], opts: {} }] as unknown as Plan;
const run = (actions: Action[], m: Model = initialModel()) => actions.reduce(reduce, m);

describe("tui model", () => {
  it("plan:resolved seeds rows with pending steps; step events move them along; a skip marks the rest", () => {
    let m = run([{ type: "plan:resolved", plan }]);
    expect(m.rows[0]).toMatchObject({ id: "a", portability: "portable", state: { kind: "absent" }, steps: [{ id: "a.1", status: "pending", interactive: false }, { id: "a.2", status: "pending", interactive: true }] });
    m = run([{ type: "step:start", artifact: "a", step: plan[0].steps[0] }, { type: "step:done", artifact: "a", step: plan[0].steps[0], ok: true }], m);
    expect(m.rows[0].steps.map((s) => s.status)).toEqual(["ok", "pending"]);
    m = run([{ type: "artifact:skipped", id: "a", reason: "needs a tty" }], m);
    expect(m.rows[0]).toMatchObject({ skipped: "needs a tty", steps: [{ status: "ok" }, { status: "skipped" }] });
  });
  it("a failed step keeps its error; checks and notes accumulate; unknown artifacts are upserted; summary counts", () => {
    const m = run([
      { type: "plan:resolved", plan },
      { type: "step:done", artifact: "a", step: plan[0].steps[0], ok: false, error: "boom" },
      { type: "check:result", artifact: "a", check: { id: "x", status: "error", message: "bad" } },
      { type: "check:result", artifact: "b", check: { id: "y", status: "warn", message: "meh" } },
      { type: "note", level: "warn", message: "careful" },
    ]);
    expect(m.rows[0].steps[0]).toMatchObject({ status: "failed", error: "boom" });
    expect(m.rows.map((r) => [r.id, r.portability])).toEqual([["a", "portable"], ["b", null]]);
    expect(summary(m.rows)).toEqual({ ok: 0, warn: 1, error: 1 });
    expect(m.notes).toEqual([{ level: "warn", message: "careful" }]);
  });
  it("artifacts/phase/exit actions and stateLabel", () => {
    const m = run([{ type: "artifacts", list: [{ id: "p", portability: "device-bound" }] }, { type: "phase", phase: "verifying" }, { type: "exit", code: 1 }]);
    expect(m).toMatchObject({ phase: "done", exitCode: 1, rows: [{ id: "p", portability: "device-bound", checks: [] }] });
    expect(run([{ type: "phase", phase: "aborted" }, { type: "exit", code: 3 }])).toMatchObject({ phase: "aborted", exitCode: 3 });
    expect(stateLabel(null)).toBe("…");
    expect(stateLabel({ kind: "present" })).toBe("present");
    expect(stateLabel({ kind: "drifted", details: ["a", "b"] })).toBe("drifted — a; b");
    expect(stateLabel({ kind: "blocked", reason: "no node" })).toBe("blocked — no node");
  });
});
