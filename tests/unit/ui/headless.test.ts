import { describe, expect, it } from "vitest";
import { headlessReporter, renderChecksText, renderPlanSteps, renderPlanText, runLogWriter } from "../../../src/ui/headless.ts";
import { FakeIo } from "../../../src/engine/io.ts";

describe("headlessReporter", () => {
  it("renders events in bootstrap.sh style", () => {
    const lines: string[] = [];
    const report = headlessReporter({ write: (l) => lines.push(l) });
    report({ type: "artifact:detected", id: "claude-config", state: { kind: "drifted", details: ["behind origin"] } });
    report({ type: "step:start", artifact: "claude-config", step: { id: "claude-config.pull", title: "git pull --ff-only" } });
    report({ type: "step:done", artifact: "claude-config", step: { id: "claude-config.pull", title: "git pull --ff-only" }, ok: true });
    report({ type: "step:done", artifact: "x", step: { id: "x.1", title: "boom" }, ok: false, error: "exit 1" });
    report({ type: "step:done", artifact: "mct", step: { id: "mct.activate", title: "activate mct" }, ok: true, skipped: "no device id" });
    report({ type: "check:result", artifact: "prereqs", check: { id: "git", status: "ok", message: "prereq: git" } });
    report({ type: "check:result", artifact: "prereqs", check: { id: "claude", status: "warn", message: "claude not found" } });
    report({ type: "artifact:skipped", id: "gateway-launch", reason: 'requires "secrets" which failed' });
    expect(lines).toEqual([
      "==> claude-config: drifted — behind origin",
      "    … git pull --ff-only",
      "    ✓ git pull --ff-only",
      "    ✗ boom — exit 1",
      "    - activate mct — skipped: no device id",
      "==> prereqs",
      "    ✓ prereq: git",
      "    ! claude not found",
      '==> gateway-launch: skipped — requires "secrets" which failed',
    ]);
  });
});

describe("plan rendering", () => {
  const plan = [
    { artifact: { id: "a", portability: "portable" }, state: { kind: "absent", details: ["x"] }, steps: [{ id: "a.1", title: "do one" }, { id: "a.2", title: "ask", interactive: true }], opts: {} },
    { artifact: { id: "b", portability: "portable" }, state: { kind: "present" }, steps: [], opts: {} },
  ] as never;
  it("renderPlanSteps lists only the steps (no state lines the reporter already printed); empty when nothing to apply", () => {
    expect(renderPlanSteps(plan)).toBe("==> Steps to apply\n    → a: do one\n    → a: ask (interactive)\n");
    expect(renderPlanSteps([] as never)).toBe("");
    expect(renderPlanText(plan)).toContain("==> a [portable]: absent — x");
  });
});

describe("runLogWriter", () => {
  it("appends one JSON line per event under <dir>/<timestamp>.jsonl", async () => {
    const io = new FakeIo();
    const w = runLogWriter(io, "/h/.config/boot-slapper/runs", new Date("2026-09-10T01:02:03Z"));
    w.emit({ type: "note", level: "info", message: "hi" });
    w.emit({ type: "artifact:detected", id: "a", state: { kind: "present" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(w.path).toBe("/h/.config/boot-slapper/runs/2026-09-10T01-02-03Z.jsonl");
    const lines = io.files.get(w.path)!.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "note", message: "hi" });
    expect(lines[1]).toMatchObject({ type: "artifact:detected", id: "a" });
    expect(lines.every((l) => typeof l.ts === "string")).toBe(true);
  });
});

describe("renderChecksText", () => {
  it("groups by artifact and ends with the summary line", () => {
    const txt = renderChecksText({ prereqs: [{ id: "git", status: "ok", message: "prereq: git" }], secrets: [{ id: "x", status: "error", message: "missing" }] });
    expect(txt).toBe("==> prereqs\n    ✓ prereq: git\n==> secrets\n    ✗ missing\n==> Doctor: 1 check(s) FAILED\n");
  });
  it("info checks render with a dot and do not fail the summary", () => {
    expect(renderChecksText({ "desktop-mcp": [{ id: "managed", status: "info", message: "policy-owned: IT" }] })).toBe("==> desktop-mcp\n    · policy-owned: IT\n==> Doctor: all checks passed\n");
  });
});
