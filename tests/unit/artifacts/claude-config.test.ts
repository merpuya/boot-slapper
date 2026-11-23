import { describe, expect, it } from "vitest";
import { claudeConfig } from "../../../src/artifacts/claude-config.ts";
import { makeCtx } from "../helpers.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { renderHooks, type HooksBlock } from "../../../src/engine/settings.ts";
import { readFileSync } from "node:fs";

const template = readFileSync("tests/fixtures/settings.template.sample.json", "utf8");
const canonical = readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8");
const opts = { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" };
const HEAD = "abc123\n";

/** Render fixture lines ("XY path", "XY old -> new", paths unquoted) the way `git status --porcelain` does: without -z a path
 *  holding a space is C-quoted; with -z entries are NUL-terminated, never quoted, and a rename is "XY new\0old\0". */
function porcelainOut(fixture: string, z: boolean): string {
  const q = (p: string) => (p.includes(" ") ? `"${p}"` : p);
  return fixture.split("\n").filter(Boolean).map((line) => {
    const code = line.slice(0, 2); const parts = line.slice(3).split(" -> ");
    if (z) return parts.length === 2 ? `${code} ${parts[1]}\0${parts[0]}\0` : `${code} ${parts[0]}\0`;
    return `${code} ${parts.map(q).join(" -> ")}\n`;
  }).join("");
}

/** A git fake: `state` decides what rev-parse/status/ls-remote answer. */
function gitFake(io: FakeIo, state: { checkout: boolean; porcelain?: string; remoteHead?: string }) {
  io.on((c, a) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "Hi merpuya! You've successfully authenticated" }));
  io.on((c) => c === "git", ({ args }) => {
    const sub = args[args.indexOf("-C") >= 0 ? 2 : 0];
    if (sub === "rev-parse" && args.includes("--show-toplevel")) return state.checkout ? { code: 0, stdout: "/h/.claude\n", stderr: "" } : { code: 128, stdout: "", stderr: "not a git repository" };
    if (sub === "rev-parse") return { code: 0, stdout: HEAD, stderr: "" };
    if (sub === "status") return { code: 0, stdout: porcelainOut(state.porcelain ?? "", args.includes("-z")), stderr: "" };
    if (sub === "ls-remote") return { code: 0, stdout: `${state.remoteHead ?? "abc123"}\trefs/heads/main\n`, stderr: "" };
    if (sub === "clone") { io.dirs.add("/h/.claude"); state.checkout = true; return { code: 0, stdout: "", stderr: "" }; }
    if (sub === "init") { state.checkout = true; return { code: 0, stdout: "", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  });
}
const REMEMBER = "/h/.remember/config.json";
const REMEMBER_OK = '{\n  "features": {\n    "plugin_promos": false\n  }\n}\n';
// The claude-remember config is in sync by default, so a test about something else never sees its drift.
const tracked = () => ({ "/h/.claude/scripts/settings.template.json": template, "/h/.claude/scripts/canonical-hooks.json": canonical, [REMEMBER]: REMEMBER_OK });

describe("claude-config", () => {
  it("fresh box: clone → seed settings → write hooks, then a second plan is empty", async () => {
    const { ctx, io } = await makeCtx({ opts, path: { node: "/usr/local/bin/node" } });
    gitFake(io, { checkout: false });
    const s1 = await claudeConfig.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: ["~/.claude absent — will clone", expect.stringMatching(/^remember config drift: /)] });
    const steps = claudeConfig.plan(ctx, s1);
    expect(steps.map((s) => s.id)).toEqual(["claude-config.clone", "claude-config.settings", "claude-config.hooks", "claude-config.remember"]);

    await claudeConfig.apply(ctx, [steps[0]]);
    expect(io.calls.find((c) => c.cmd === "git" && c.args[0] === "clone")?.args).toEqual(["clone", "--quiet", opts.sshUrl, "/h/.claude"]);
    // the clone "materialises" the tracked files
    for (const [p, s] of Object.entries(tracked())) if (p !== REMEMBER) io.files.set(p, s);   // ~/.remember is not part of the clone
    await claudeConfig.apply(ctx, [steps[1]]);
    const settings = JSON.parse(io.files.get("/h/.claude/settings.json")!);
    expect(settings.model).toBe("fable");
    expect(io.files.has("/h/.claude/settings.json.bak.pre-settings-template")).toBe(false); // nothing to back up on a seed
    await claudeConfig.apply(ctx, [steps[2]]);
    const after = JSON.parse(io.files.get("/h/.claude/settings.json")!);
    expect(Object.keys(after.hooks).sort()).toEqual(["Notification", "PreToolUse", "SessionStart"]);
    await claudeConfig.apply(ctx, [steps[3]]);
    expect(JSON.parse(io.files.get(REMEMBER)!)).toEqual({ features: { plugin_promos: false } });

    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
    expect(claudeConfig.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("existing non-checkout ~/.claude is adopted in place, never overwritten", async () => {
    const { ctx, io, events } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { "/h/.claude/CLAUDE.md": "local edits\n", ...tracked() } });
    gitFake(io, { checkout: false, porcelain: " M CLAUDE.md\n D skills/save/SKILL.md\n" });
    const s = await claudeConfig.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: ["~/.claude exists but is not a checkout — will adopt in place"] });
    const steps = claudeConfig.plan(ctx, s);
    expect(steps[0].id).toBe("claude-config.adopt");
    await claudeConfig.apply(ctx, [steps[0]]);
    const gitArgs = io.calls.filter((c) => c.cmd === "git").map((c) => c.args.slice(2).join(" "));
    expect(gitArgs).toContain("init -q -b main");
    expect(gitArgs).toContain(`remote add origin ${opts.sshUrl}`);
    expect(gitArgs).toContain("checkout -q -- skills/save/SKILL.md");  // restore the missing tracked file
    expect(gitArgs.some((a) => a.startsWith("checkout") && a.includes("CLAUDE.md"))).toBe(false); // never clobber the modified one
    expect(io.files.get("/h/.claude/CLAUDE.md")).toBe("local edits\n");
    expect(events.find((e) => e.type === "note" && /1 tracked file\(s\) .* differ/.test(e.message))).toBeTruthy();
  });

  // 2026-11-15, pa-book-pro: adopt left dotclaude's "…/link-percent/sp ace.md" fixture unrestored. Plain --porcelain C-quotes a
  // path with a space, so the quoted string went to `git checkout --` and matched nothing (exit ignored).
  it("adopt restores a missing tracked file whose path has a space, and a rename reports the new name", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: tracked() });
    gitFake(io, { checkout: false, porcelain: " D scripts/fixtures/sp ace.md\nR  old name.md -> new name.md\n" });
    await claudeConfig.apply(ctx, [claudeConfig.plan(ctx, await claudeConfig.detect(ctx))[0]]);
    expect(io.calls.filter((c) => c.cmd === "git" && c.args.includes("checkout")).map((c) => c.args.slice(c.args.indexOf("checkout")))).toEqual([["checkout", "-q", "--", "scripts/fixtures/sp ace.md"]]);
    const d = await claudeConfig.detect(ctx);
    expect(d.details?.find((x) => x.includes("tracked file(s) differ"))).toContain("NOT overwriting: new name.md");
  });

  it("checkout behind origin plans a pull; tracked modifications are reported, not fixed", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: {
      ...tracked(),
      "/h/.claude/settings.json": JSON.stringify({ ...JSON.parse(template), hooks: {} }),
    } });
    gitFake(io, { checkout: true, porcelain: " M CLAUDE.md\n", remoteHead: "ffffff" });
    const s = await claudeConfig.detect(ctx);
    expect(s.kind).toBe("drifted");
    expect((s as { details: string[] }).details).toEqual(expect.arrayContaining([
      expect.stringMatching(/behind origin/), expect.stringMatching(/1 tracked file\(s\) differ/), expect.stringMatching(/hooks block differs/),
    ]));
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).toEqual(["claude-config.pull", "claude-config.hooks"]);
  });

  it("hooks step backs up first and renders exec form on win32", async () => {
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home: "C:\\Users\\t", path: { node: "C:\\Program Files\\nodejs\\node.exe" }, files: {
      "C:\\Users\\t\\.claude\\scripts\\settings.template.json": template,
      "C:\\Users\\t\\.claude\\scripts\\canonical-hooks.json": canonical,
      "C:\\Users\\t\\.claude\\settings.json": JSON.stringify(JSON.parse(template)),
    } });
    await claudeConfig.apply(ctx, [{ id: "claude-config.hooks", title: "" }]);
    expect(io.files.has("C:\\Users\\t\\.claude\\settings.json.bak.pre-canonical-hooks")).toBe(true);
    const hooks = JSON.parse(io.files.get("C:\\Users\\t\\.claude\\settings.json")!).hooks;
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(hooks.PreToolUse[0].hooks[0].args[0]).toBe("C:\\Users\\t\\.claude\\scripts\\pretool-write-untracked-guard.mjs");
    expect(JSON.stringify(hooks)).not.toContain("cc-status");
  });

  it("verify mirrors the bootstrap doctor checks", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": "{not json" } });
    gitFake(io, { checkout: true });
    const checks = await claudeConfig.verify(ctx);
    // remember-config is checked whether or not settings.json is valid (bootstrap.sh doctor does the same)
    expect(checks.map((c) => [c.id, c.status])).toEqual([["checkout", "ok"], ["clean", "ok"], ["settings-valid", "error"], ["remember-config", "ok"]]);
  });

  it("ignores untracked files and reports renames by their new name", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": JSON.stringify(JSON.parse(template)) } });
    gitFake(io, { checkout: true, porcelain: "?? scratch.txt\nR  old.md -> new.md\n" });
    // settings.json lacks hooks, so drift is expected — but the only *file* drift reported must be the rename
    const s = await claudeConfig.detect(ctx);
    expect(s.kind).toBe("drifted");
    const details = (s as { details: string[] }).details;
    expect(details.find((d) => /tracked file\(s\) differ/.test(d))).toMatch(/1 tracked file\(s\) differ .*: new\.md$/);
    expect(details.join("\n")).not.toContain("scratch.txt");
  });

  // Gate-1 parity, 2026-09-16 on JCB-AL-ACA34: bootstrap.sh --doctor counts every porcelain line, so four never-committed
  // handoff notes (tracked by fleet convention since dotclaude c600e40) made it warn while bs said clean. "Clean vs origin"
  // means the working tree, untracked included — a fresh clone would lose those files. Detect's drift stays tracked-only
  // because the pull step can do nothing about an untracked path.
  it("verify's clean check counts untracked paths like the bash doctor; detect still plans nothing for them", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": JSON.stringify(JSON.parse(template)) } });
    gitFake(io, { checkout: true, porcelain: "?? .remember/handoffs/a.md\n?? .remember/handoffs/b.md\n" });
    const clean = (await claudeConfig.verify(ctx)).find((c) => c.id === "clean");
    expect(clean).toEqual({ id: "clean", status: "warn", message: "~/.claude has 2 changed path(s) — git -C ~/.claude status" });
    const s = await claudeConfig.detect(ctx);
    expect(JSON.stringify(s)).not.toContain("handoffs");
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).not.toContain("claude-config.pull");
  });

  it("treats non-object JSON in settings.json as invalid instead of crashing", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": "[1]" } });
    gitFake(io, { checkout: true });
    const s = await claudeConfig.detect(ctx);
    expect((s as { details: string[] }).details).toContain("settings.json is not valid JSON");
    expect((await claudeConfig.verify(ctx)).find((c) => c.id === "settings-valid")).toMatchObject({ status: "error" });
  });

  it("empty ls-remote stdout is treated as not behind, not as origin unreachable", async () => {
    const { ctx, io, events } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": JSON.stringify(JSON.parse(template)) } });
    io.on((c, a) => c === "git" && a.includes("ls-remote"), () => ({ code: 0, stdout: "", stderr: "" }));
    gitFake(io, { checkout: true });
    const s = await claudeConfig.detect(ctx);
    const details = s.kind === "drifted" ? s.details : [];
    expect(details.some((d) => d.startsWith("behind origin"))).toBe(false);
    expect(events.find((e) => e.type === "note" && /origin unreachable/.test(e.message))).toBeUndefined();
  });

  it("a timed-out ls-remote is treated like an unreachable origin: not behind, with a warn note", async () => {
    const { ctx, io, events } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": JSON.stringify(JSON.parse(template)) } });
    io.on((c, a) => c === "git" && a.includes("ls-remote"), () => ({ code: 124, stdout: "", stderr: "\n[timeout]" }));
    gitFake(io, { checkout: true });
    const s = await claudeConfig.detect(ctx);
    const details = s.kind === "drifted" ? s.details : [];
    expect(details.some((d) => d.startsWith("behind origin"))).toBe(false);
    expect(events.find((e) => e.type === "note" && e.level === "warn" && /origin unreachable/.test(e.message))).toBeTruthy();
    const call = io.calls.find((c) => c.cmd === "git" && c.args.includes("ls-remote"));
    expect(call?.opts.timeout).toBe(10_000);
  });

  it("every git exec sets GIT_TERMINAL_PROMPT=0 to prevent an interactive credential prompt from hanging", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": JSON.stringify(JSON.parse(template)) } });
    gitFake(io, { checkout: true, porcelain: " M CLAUDE.md\n" });
    await claudeConfig.detect(ctx);
    // exclude isCheckout's raw rev-parse --show-toplevel probe, which never touches the network and predates the git() helper
    const gitCalls = io.calls.filter((c) => c.cmd === "git" && c.args[0] === "-C" && !c.args.includes("--show-toplevel"));
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const c of gitCalls) expect(c.opts.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0" });
  });

  it("detect and verify never write", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": JSON.stringify({ ...JSON.parse(template), hooks: {} }) } });
    gitFake(io, { checkout: true, porcelain: " M CLAUDE.md\n", remoteHead: "ffffff" });
    await claudeConfig.detect(ctx);
    await claudeConfig.verify(ctx);
    expect(io.writes).toEqual([]);
    expect(io.calls.filter((c) => c.cmd === "git").map((c) => c.args[2])).not.toContain("fetch");
  });

  it("capture bundles exactly the tracked files under claude-config/ and never writes", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { "/h/.claude/CLAUDE.md": "rules\n", "/h/.claude/scripts/x.mjs": "js\n", "/h/.claude/untracked.txt": "no\n" } });
    io.on((c, a) => c === "git" && a.includes("ls-files"), () => ({ code: 0, stdout: "CLAUDE.md\0scripts/x.mjs\0deleted.md\0", stderr: "" }));
    gitFake(io, { checkout: true });
    const b = await claudeConfig.capture!(ctx);
    expect(b.files).toEqual([{ path: "claude-config/CLAUDE.md", content: "rules\n" }, { path: "claude-config/scripts/x.mjs", content: "js\n" }]);
    expect(io.writes).toEqual([]);
    const { ctx: plain, io: io2 } = await makeCtx({ opts, dirs: ["/h/.claude"] });
    gitFake(io2, { checkout: false });
    expect((await claudeConfig.capture!(plain)).files).toEqual([]);
  });
});

// Mirrors dotclaude scripts/tests/settings-template-env-merge.mjs, settings-template-allow-merge.mjs and remember-config-plugin-promos.mjs:
// the applier and its --check twin (here: detect/plan/apply and verify) agree, and nothing but apply writes.
describe("claude-config: managed env / permissions.allow sub-keys", () => {
  const KEY = "ENABLE_SOMETHING"; const ENTRY = "mcp__claude_ai_MeCP__bootstrap_context";
  const tmplWithSubKeys = JSON.stringify({ ...JSON.parse(template), env: { [KEY]: "0" }, permissions: { defaultMode: "auto", allow: [ENTRY] } });
  const LOCAL_ENV = { CLAUDE_CODE_ENABLE_TELEMETRY: "1", OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic dGVzdA==,X-Scope-OrgID=fleet one" };
  const settingsOf = (o: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(template), ...o }, null, 2) + "\n";
  const SP = "/h/.claude/settings.json";
  async function box(settings: string, tmpl = tmplWithSubKeys) {
    const c = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/scripts/settings.template.json": tmpl, [SP]: settings } });
    gitFake(c.io, { checkout: true });
    return c;
  }
  const hooksOf = () => renderHooks(JSON.parse(canonical).hooks as HooksBlock, { platform: "darwin" });

  it("a missing managed env key and allow entry is drift: detect names them, verify errors, plan seeds, and nothing is written until apply", async () => {
    const { ctx, io } = await box(settingsOf({ env: LOCAL_ENV, permissions: { defaultMode: "plan", allow: ["Bash(ls:*)"] }, hooks: hooksOf() }));
    const before = io.files.get(SP);
    const s = await claudeConfig.detect(ctx);
    expect(s.kind).toBe("drifted");
    expect((s as { details: string[] }).details.join("\n")).toMatch(new RegExp(`settings template drift.*env: \\[${KEY}\\].*allow: \\[${ENTRY}\\]`));
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).toEqual(["claude-config.settings"]);
    const t = (await claudeConfig.verify(ctx)).find((c) => c.id === "template-keys");
    expect(t?.status).toBe("error");
    expect(t?.message).toContain(`env.${KEY}`); expect(t?.message).toContain(ENTRY);
    expect(io.writes).toEqual([]); expect(io.files.get(SP)).toBe(before);
  });

  it("apply adds the env key and the allow entry, keeps every local value and order, backs up first; a second pass is clean", async () => {
    const local = settingsOf({ env: LOCAL_ENV, permissions: { defaultMode: "plan", allow: ["Bash(ls:*)"], deny: ["Bash(rm:*)"] }, hooks: hooksOf() });
    const { ctx, io } = await box(local);
    await claudeConfig.apply(ctx, [{ id: "claude-config.settings", title: "" }]);
    const after = JSON.parse(io.files.get(SP)!);
    expect(after.env).toEqual({ ...LOCAL_ENV, [KEY]: "0" });
    expect(Object.keys(after.env)).toEqual([...Object.keys(LOCAL_ENV), KEY]);
    expect(after.permissions).toEqual({ defaultMode: "plan", allow: ["Bash(ls:*)", ENTRY], deny: ["Bash(rm:*)"] });
    expect(io.files.get(SP + ".bak.pre-settings-template")).toBe(local);
    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
    const writes = io.writes.length;
    await claudeConfig.apply(ctx, [{ id: "claude-config.settings", title: "" }]);
    expect(io.writes.length).toBe(writes);   // re-apply is a no-op: nothing rewritten
  });

  it("a local-only env key and a local value for a template key are never touched", async () => {
    const local = settingsOf({ env: { ...LOCAL_ENV, [KEY]: "1" }, permissions: { allow: [ENTRY, "Bash(ls:*)"] }, hooks: hooksOf() });
    const { ctx, io } = await box(local);
    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
    await claudeConfig.apply(ctx, [{ id: "claude-config.settings", title: "" }]);
    expect(io.files.get(SP)).toBe(local);
    expect(io.writes).toEqual([]);
  });

  it("a template that lists no env key manages nothing: local-only env keys are not drift", async () => {
    const { ctx } = await box(settingsOf({ env: LOCAL_ENV, hooks: hooksOf() }), template);
    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
  });

  it("a non-object env refuses in detect and verify (error, never a crash), plans no settings step, and apply leaves the file alone", async () => {
    const local = settingsOf({ env: "OTEL=1", hooks: hooksOf() });
    const { ctx, io } = await box(local);
    const s = await claudeConfig.detect(ctx);
    expect(s.kind).toBe("drifted");
    expect((s as { details: string[] }).details.join("\n")).toMatch(/settings template refused: .*env is not an object/);
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).not.toContain("claude-config.settings");
    const t = (await claudeConfig.verify(ctx)).find((c) => c.id === "template-keys");
    expect(t).toMatchObject({ status: "error" }); expect(t?.message).toMatch(/^settings template drift: refusing: .*env is not an object/);
    await expect(claudeConfig.apply(ctx, [{ id: "claude-config.settings", title: "" }])).rejects.toThrow(/env is not an object/);
    expect(io.files.get(SP)).toBe(local); expect(io.writes).toEqual([]);
  });
});

describe("claude-config: ~/.remember/config.json features.plugin_promos", () => {
  const withoutRemember = () => { const f: Record<string, string> = { ...tracked(), "/h/.claude/settings.json": JSON.stringify({ ...JSON.parse(template), hooks: renderHooks(JSON.parse(canonical).hooks as HooksBlock, { platform: "darwin" }) }) }; delete f[REMEMBER]; return f; };
  async function box(config?: string, extra: Parameters<typeof makeCtx>[0] = {}) {
    const files = { ...withoutRemember(), ...(config === undefined ? {} : { [REMEMBER]: config }) };
    const c = await makeCtx({ opts, dirs: ["/h/.claude"], files, ...extra });
    gitFake(c.io, { checkout: true });
    return c;
  }
  const remember = { id: "claude-config.remember", title: "" };

  it("no ~/.remember at all: detect and verify report it without creating anything; apply creates the dir 0700 and a file holding only the one key", async () => {
    const { ctx, io } = await box();
    const s = await claudeConfig.detect(ctx);
    expect(s.kind).toBe("drifted");
    expect((s as { details: string[] }).details).toEqual([expect.stringMatching(/^remember config drift: .*features\.plugin_promos/)]);
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).toEqual(["claude-config.remember"]);
    const v = (await claudeConfig.verify(ctx)).find((c) => c.id === "remember-config");
    expect(v).toMatchObject({ status: "error" }); expect(v?.message).toMatch(/^remember config drift: /);
    expect(io.writes).toEqual([]); expect(io.dirs.has("/h/.remember")).toBe(false);
    await claudeConfig.apply(ctx, [remember]);
    expect(JSON.parse(io.files.get(REMEMBER)!)).toEqual({ features: { plugin_promos: false } });
    expect(io.files.get(REMEMBER)!.endsWith("\n")).toBe(true);
    expect(io.dirModes.get("/h/.remember")).toBe(0o700);   // the plugin keeps ~/.remember private; a dir we create must not be looser
    expect(io.modes.get(REMEMBER)).toBe(0o600);
    expect(io.files.has(REMEMBER + ".bak.pre-remember-config")).toBe(false);
    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
    expect((await claudeConfig.verify(ctx)).find((c) => c.id === "remember-config")).toMatchObject({ status: "ok" });
  });

  it("an existing config without the key: the key is added, every other key and value survive, the old file is backed up byte-for-byte", async () => {
    const existing = { data_dir: "~/.remember/{slug}", timezone: "America/New_York", features: { other_flag: true }, cooldowns: { git_backup_seconds: 900 } };
    const raw = JSON.stringify(existing, null, 2) + "\n";
    const { ctx, io } = await box(raw, { dirs: ["/h/.claude", "/h/.remember"] });
    expect((await claudeConfig.detect(ctx)).kind).toBe("drifted");
    expect(io.writes).toEqual([]);
    await claudeConfig.apply(ctx, [remember]);
    expect(JSON.parse(io.files.get(REMEMBER)!)).toEqual({ ...existing, features: { other_flag: true, plugin_promos: false } });
    expect(io.files.get(REMEMBER + ".bak.pre-remember-config")).toBe(raw);
    expect(io.dirModes.has("/h/.remember")).toBe(false);   // an existing directory is left as it is
  });

  it("a value already set (even true) is never overwritten, and apply of the step is then a no-op", async () => {
    const raw = '{"features":{"plugin_promos":true}}\n';
    const { ctx, io } = await box(raw);
    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
    await claudeConfig.apply(ctx, [remember]);
    expect(io.files.get(REMEMBER)).toBe(raw); expect(io.writes).toEqual([]);
  });

  it.each([["invalid JSON", '{"features": '], ["a non-object root", "[1,2]\n"], ["a non-object features", '{"features": "off"}\n']])(
    "%s is refused: reported as drift, no step planned, apply throws and the file is untouched", async (_label, body) => {
      const { ctx, io } = await box(body);
      const s = await claudeConfig.detect(ctx);
      expect(s.kind).toBe("drifted");
      expect((s as { details: string[] }).details.join("\n")).toMatch(/remember config refused: /);
      expect(claudeConfig.plan(ctx, s).map((x) => x.id)).not.toContain("claude-config.remember");
      expect((await claudeConfig.verify(ctx)).find((c) => c.id === "remember-config")).toMatchObject({ status: "error" });
      await expect(claudeConfig.apply(ctx, [remember])).rejects.toThrow();
      expect(io.files.get(REMEMBER)).toBe(body); expect(io.writes).toEqual([]);
    });

  it("a symlinked config.json is refused and its target is untouched", async () => {
    const { ctx, io } = await box(undefined, { links: { [REMEMBER]: "/h/elsewhere.json" } });
    io.files.set("/h/elsewhere.json", "{}\n");
    const s = await claudeConfig.detect(ctx);
    expect((s as { details: string[] }).details.join("\n")).toMatch(/remember config refused: .*symlink/);
    await expect(claudeConfig.apply(ctx, [remember])).rejects.toThrow(/symlink/);
    expect(io.files.get("/h/elsewhere.json")).toBe("{}\n"); expect(io.writes).toEqual([]);
  });

  it("a fresh box (no ~/.claude, no ~/.remember) plans the remember step after the clone/seed steps", async () => {
    const { ctx, io } = await makeCtx({ opts, path: { node: "/usr/local/bin/node" } });
    gitFake(io, { checkout: false });
    const s = await claudeConfig.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: ["~/.claude absent — will clone", expect.stringMatching(/^remember config drift: /)] });
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).toEqual(["claude-config.clone", "claude-config.settings", "claude-config.hooks", "claude-config.remember"]);
  });

  it("verify reports remember drift even when ~/.claude is not a checkout", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"] });
    gitFake(io, { checkout: false });
    expect((await claudeConfig.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["checkout", "error"], ["remember-config", "error"]]);
  });
});

