import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepEqual, renderHooks, seedRememberConfig, seedSettings, SettingsRefusal, stableJson, type HooksBlock } from "../../../src/engine/settings.ts";

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

// Mirrors dotclaude scripts/tests/settings-template-env-merge.mjs and settings-template-allow-merge.mjs: `env` and
// `permissions` are seed-only top-level keys, so a new template sub-key never reached a box whose settings.json already had one.
describe("seedSettings: env sub-key merge (add-only)", () => {
  const KEY = "ENABLE_SOMETHING";
  const tmpl = { env: { [KEY]: "0" }, theme: "auto" };
  // Placeholder values shaped like the real exporter headers: '=' ',' and spaces.
  const LOCAL_ENV = { CLAUDE_CODE_ENABLE_TELEMETRY: "1", OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic dGVzdA==,X-Scope-OrgID=fleet one" };

  it("adds a template env key the existing env block lacks; local keys keep value and order, the new key is appended", () => {
    const r = seedSettings({ env: { ...LOCAL_ENV }, theme: "auto" }, tmpl);
    expect(r.envAdded).toEqual([KEY]);
    expect(r.added).toEqual([]);
    expect(r.next.env).toEqual({ ...LOCAL_ENV, [KEY]: "0" });
    expect(Object.keys(r.next.env as object)).toEqual([...Object.keys(LOCAL_ENV), KEY]);
  });
  it("never overwrites a key present locally, whatever its value", () => {
    const r = seedSettings({ env: { ...LOCAL_ENV, [KEY]: "1" }, theme: "auto" }, tmpl);
    expect(r.envAdded).toEqual([]);
    expect((r.next.env as Record<string, string>)[KEY]).toBe("1");
  });
  it("never removes a local-only key: the template is not an allowlist", () => {
    const r = seedSettings({ env: { ...LOCAL_ENV }, theme: "auto" }, { env: {}, theme: "auto" });
    expect(r.envAdded).toEqual([]);
    expect(r.next).toEqual({ env: LOCAL_ENV, theme: "auto" });
  });
  it("a settings.json without env gets the block seeded whole through the top-level path, not the sub-key path", () => {
    const r = seedSettings({ theme: "auto" }, tmpl);
    expect(r.added).toEqual(["env"]);
    expect(r.envAdded).toEqual([]);
    expect(r.next.env).toEqual({ [KEY]: "0" });
  });
  it("refuses a non-object env in settings.json, and a non-object env in the template", () => {
    expect(() => seedSettings({ env: "OTEL=1" }, tmpl)).toThrow(SettingsRefusal);
    expect(() => seedSettings({ env: ["x"] }, tmpl)).toThrow(/env is not an object/);
    expect(() => seedSettings({ env: {} }, { env: "x" })).toThrow(/template env is not an object/);
  });
  it("does not mutate its inputs", () => {
    const settings = { env: { ...LOCAL_ENV } };
    seedSettings(settings, tmpl);
    expect(settings).toEqual({ env: LOCAL_ENV });
    expect(tmpl).toEqual({ env: { [KEY]: "0" }, theme: "auto" });
  });
});

describe("seedSettings: permissions.allow union", () => {
  const E1 = "mcp__claude_ai_MeCP__bootstrap_context";
  const tmpl = { permissions: { defaultMode: "auto", allow: [E1] }, theme: "auto" };

  it("appends a missing template entry after the local ones and keeps every other permissions key", () => {
    const r = seedSettings({ permissions: { defaultMode: "plan", allow: ["Bash(ls:*)"], deny: ["Bash(rm:*)"] } }, tmpl);
    expect(r.allowAdded).toEqual([E1]);
    expect(r.next.permissions).toEqual({ defaultMode: "plan", allow: ["Bash(ls:*)", E1], deny: ["Bash(rm:*)"] });
  });
  it("creates permissions.allow when permissions exists without one", () => {
    const r = seedSettings({ permissions: { defaultMode: "plan" } }, tmpl);
    expect(r.allowAdded).toEqual([E1]);
    expect(r.next.permissions).toEqual({ defaultMode: "plan", allow: [E1] });
  });
  it("is a no-op when the entry is already there, wherever it sits; local-only entries are never removed", () => {
    const r = seedSettings({ permissions: { allow: ["Bash(ls:*)", E1, "Bash(cat:*)"] } }, tmpl);
    expect(r.allowAdded).toEqual([]);
    expect(r.next.permissions).toEqual({ allow: ["Bash(ls:*)", E1, "Bash(cat:*)"] });
  });
  it("a template with no allow list manages nothing", () => {
    const r = seedSettings({ permissions: { allow: ["x"] } }, { permissions: { defaultMode: "auto" } });
    expect(r.allowAdded).toEqual([]);
  });
  it("a settings.json without permissions gets the block seeded whole through the top-level path", () => {
    const r = seedSettings({ theme: "auto" }, tmpl);
    expect(r.added).toEqual(["permissions"]);
    expect(r.allowAdded).toEqual([]);
    expect(r.next.permissions).toEqual(tmpl.permissions);
  });
  it("refuses a non-object permissions or a non-list allow", () => {
    expect(() => seedSettings({ permissions: "all" }, tmpl)).toThrow(SettingsRefusal);
    expect(() => seedSettings({ permissions: { allow: "x" } }, tmpl)).toThrow(/permissions \/ permissions.allow is not an object \/ list/);
  });
});

describe("seedRememberConfig (features.plugin_promos, add-only)", () => {
  it("a missing file becomes just {features:{plugin_promos:false}}", () => {
    expect(seedRememberConfig(null)).toEqual({ next: { features: { plugin_promos: false } }, changed: true, existed: false });
  });
  it("adds the key to an existing config and keeps every other key, in place", () => {
    const cfg = { data_dir: "~/.remember/{slug}", timezone: "America/New_York", features: { other_flag: true }, cooldowns: { git_backup_seconds: 900 } };
    const r = seedRememberConfig(cfg);
    expect(r.changed).toBe(true); expect(r.existed).toBe(true);
    expect(r.next).toEqual({ ...cfg, features: { other_flag: true, plugin_promos: false } });
    expect(Object.keys(r.next)).toEqual(Object.keys(cfg));
  });
  it("adds a features object when the config has none", () => {
    expect(seedRememberConfig({ timezone: "UTC" }).next).toEqual({ timezone: "UTC", features: { plugin_promos: false } });
  });
  it("never overwrites a value already set, even true", () => {
    const r = seedRememberConfig({ features: { plugin_promos: true } });
    expect(r.changed).toBe(false);
    expect(r.next).toEqual({ features: { plugin_promos: true } });
  });
  it("refuses a non-object features", () => {
    expect(() => seedRememberConfig({ features: "off" })).toThrow(SettingsRefusal);
    expect(() => seedRememberConfig({ features: [1] })).toThrow(/features is not an object/);
  });
  it("does not mutate its input", () => {
    const cfg = { features: { other_flag: true } };
    seedRememberConfig(cfg);
    expect(cfg).toEqual({ features: { other_flag: true } });
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
