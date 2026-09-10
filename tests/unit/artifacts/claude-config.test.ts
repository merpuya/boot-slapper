import { describe, expect, it } from "vitest";
import { claudeConfig } from "../../../src/artifacts/claude-config.ts";
import { makeCtx } from "../helpers.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { readFileSync } from "node:fs";

const template = readFileSync("tests/fixtures/settings.template.sample.json", "utf8");
const canonical = readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8");
const opts = { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" };
const HEAD = "abc123\n";

/** A git fake: `state` decides what rev-parse/status/ls-remote answer. */
function gitFake(io: FakeIo, state: { checkout: boolean; porcelain?: string; remoteHead?: string }) {
  io.on((c, a) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "Hi merpuya! You've successfully authenticated" }));
  io.on((c) => c === "git", ({ args }) => {
    const sub = args[args.indexOf("-C") >= 0 ? 2 : 0];
    if (sub === "rev-parse" && args.includes("--show-toplevel")) return state.checkout ? { code: 0, stdout: "/h/.claude\n", stderr: "" } : { code: 128, stdout: "", stderr: "not a git repository" };
    if (sub === "rev-parse") return { code: 0, stdout: HEAD, stderr: "" };
    if (sub === "status") return { code: 0, stdout: state.porcelain ?? "", stderr: "" };
    if (sub === "ls-remote") return { code: 0, stdout: `${state.remoteHead ?? "abc123"}\trefs/heads/main\n`, stderr: "" };
    if (sub === "clone") { io.dirs.add("/h/.claude"); state.checkout = true; return { code: 0, stdout: "", stderr: "" }; }
    if (sub === "init") { state.checkout = true; return { code: 0, stdout: "", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  });
}
const tracked = () => ({ "/h/.claude/scripts/settings.template.json": template, "/h/.claude/scripts/canonical-hooks.json": canonical });

describe("claude-config", () => {
  it("fresh box: clone → seed settings → write hooks, then a second plan is empty", async () => {
    const { ctx, io } = await makeCtx({ opts, path: { node: "/usr/local/bin/node" } });
    gitFake(io, { checkout: false });
    const s1 = await claudeConfig.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: ["~/.claude absent — will clone"] });
    const steps = claudeConfig.plan(ctx, s1);
    expect(steps.map((s) => s.id)).toEqual(["claude-config.clone", "claude-config.settings", "claude-config.hooks"]);

    await claudeConfig.apply(ctx, [steps[0]]);
    expect(io.calls.find((c) => c.cmd === "git" && c.args[0] === "clone")?.args).toEqual(["clone", "--quiet", opts.sshUrl, "/h/.claude"]);
    // the clone "materialises" the tracked files
    for (const [p, s] of Object.entries(tracked())) io.files.set(p, s);
    await claudeConfig.apply(ctx, [steps[1]]);
    const settings = JSON.parse(io.files.get("/h/.claude/settings.json")!);
    expect(settings.model).toBe("fable");
    expect(io.files.has("/h/.claude/settings.json.bak.pre-settings-template")).toBe(false); // nothing to back up on a seed
    await claudeConfig.apply(ctx, [steps[2]]);
    const after = JSON.parse(io.files.get("/h/.claude/settings.json")!);
    expect(Object.keys(after.hooks).sort()).toEqual(["Notification", "PreToolUse", "SessionStart"]);

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
    expect(checks.map((c) => [c.id, c.status])).toEqual([["checkout", "ok"], ["clean", "ok"], ["settings-valid", "error"]]);
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
});
