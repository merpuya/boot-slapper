import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepEqual, renderHooks, seedSettings, stableJson, type HooksBlock } from "../../../src/engine/settings.ts";

const template = JSON.parse(readFileSync("tests/fixtures/settings.template.sample.json", "utf8"));
const canonical = JSON.parse(readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8")).hooks as HooksBlock;
const allHooks = (b: HooksBlock) => Object.values(b).flatMap((gs) => gs.flatMap((g) => g.hooks));

describe("seedSettings", () => {
  it("seeds a missing settings.json wholesale", () => {
    const r = seedSettings(null, template);
    expect(r.next).toEqual(template);
    expect(r.added.sort()).toEqual(Object.keys(template).sort());
    expect(r.stale).toEqual([]);
  });
  it("fills only missing keys and never overwrites machine-local values", () => {
    const r = seedSettings({ model: "opus", permissions: { defaultMode: "plan" } }, template);
    expect(r.next.model).toBe("opus");
    expect(r.next.permissions).toEqual({ defaultMode: "plan" });
    expect(r.added.sort()).toEqual(["askUserQuestionTimeout", "statusLine", "theme", "tui"]);
  });
  it("reconciles drifted MANAGED keys (statusLine) and reports them as stale", () => {
    const r = seedSettings({ ...template, statusLine: { type: "command", command: "bash /mnt/c/old.sh" } }, template);
    expect(r.stale).toEqual(["statusLine"]);
    expect(r.next.statusLine).toEqual(template.statusLine);
  });
  it("is a no-op when everything is present", () => {
    const r = seedSettings({ ...template, hooks: { x: [] } }, template);
    expect(r.added).toEqual([]); expect(r.stale).toEqual([]);
    expect(r.next).toEqual({ ...template, hooks: { x: [] } });
  });
  it("refuses a template that carries hooks", () => {
    expect(() => seedSettings({}, { ...template, hooks: {} })).toThrow(/hooks are owned by canonical-hooks.json/);
  });
});

describe("renderHooks", () => {
  it("darwin: keeps everything, strips `platforms`, keeps shell form", () => {
    const r = renderHooks(canonical, { platform: "darwin" });
    expect(Object.keys(r).sort()).toEqual(["Notification", "PreToolUse", "SessionStart"]);
    expect(allHooks(r)).toHaveLength(5);
    expect(allHooks(r).every((h) => !("platforms" in h) && !("args" in h))).toBe(true);
  });
  it("win32: drops darwin-only hooks, drops emptied groups/events, rewrites node hooks to exec form", () => {
    const r = renderHooks(canonical, { platform: "win32", nodeExe: "C:\\Program Files\\nodejs\\node.exe", homeWin: "C:\\Users\\test" });
    expect(Object.keys(r).sort()).toEqual(["PreToolUse", "SessionStart"]);
    expect(r.PreToolUse).toHaveLength(1);
    expect(r.PreToolUse[0].hooks[0]).toEqual({
      type: "command", timeout: 5,
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\test\\.claude\\scripts\\pretool-write-untracked-guard.mjs"],
    });
    const start = r.SessionStart[0].hooks;
    expect(start[0]).toEqual({ type: "command", command: "$HOME/.claude/scripts/dotclaude-self-update.sh", timeout: 15 });
    expect(start[1]).toEqual({
      type: "command", timeout: 30,
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\test\\.claude\\scripts\\memory-auto-sync.mjs", "start"],
    });
    expect(JSON.stringify(r)).not.toContain("cc-status");
  });
  it("win32 without nodeExe/homeWin leaves shell form untouched (filter still applies)", () => {
    const r = renderHooks(canonical, { platform: "win32" });
    expect(allHooks(r).every((h) => !("args" in h))).toBe(true);
    expect(JSON.stringify(r)).not.toContain("cc-status");
  });
  it("linux: same as win32 filter, no exec rewrite", () => {
    const r = renderHooks(canonical, { platform: "linux" });
    expect(Object.keys(r).sort()).toEqual(["PreToolUse", "SessionStart"]);
    expect(allHooks(r).every((h) => !("args" in h))).toBe(true);
  });
});

describe("helpers", () => {
  it("stableJson ends with a newline and deepEqual compares structurally", () => {
    expect(stableJson({ a: 1 })).toBe('{\n  "a": 1\n}\n');
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
