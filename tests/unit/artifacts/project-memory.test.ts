import { describe, expect, it } from "vitest";
import { bashCmd, bashPath, fwd, guessLogical, projectMemory } from "../../../src/artifacts/project-memory.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { sshUrl: "git@github.com:merpuya/claude-memory-sync.git", httpsUrl: "https://github.com/merpuya/claude-memory-sync.git" };
const REPO = "/h/projects/claude-memory-sync";
const scripts = { "/h/.claude/scripts/memory-auto-sync.mjs": "", "/h/.claude/scripts/load-mecp-context.mjs": "" };
const repoDirs = [`${REPO}/.git`, `${REPO}/projects/mecp`, `${REPO}/projects/mecp-handoffs`, `${REPO}/projects/dotfiles`, `${REPO}/devices`];
const MEM = (enc: string) => `/h/.claude/projects/${enc}/memory`;
const memDirs = [MEM("-Users-aca34-projects-mecp"), MEM("-Users-aca34-projects-mecp-handoffs"), MEM("-Users-aca34-scratch")];

function fakes(io: FakeIo, codes: { push?: number; pull?: number; list?: number } = {}) {
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "Hi merpuya! You've successfully authenticated" }));
  io.on((c, a) => c === "bash" && /sync-memory$/.test(a[0] ?? ""), ({ args }) => ({ code: codes[args[3] as keyof typeof codes] ?? 0, stdout: "", stderr: args[3] === "push" ? "[conflict] x.md\n" : "" }));
  io.on((c, a) => c === "git" && a[0] === "clone", async () => { for (const d of repoDirs) await io.mkdirp(d); return { code: 0, stdout: "", stderr: "" }; });
}

describe("guessLogical", () => {
  it("picks the longest known name contained in the encoded dir, or null", () => {
    const known = ["mecp", "mecp-handoffs", "dotfiles"];
    expect(guessLogical("-Users-aca34-projects-mecp-handoffs", known)).toBe("mecp-handoffs");
    expect(guessLogical("-Users-aca34-projects-mecp", known)).toBe("mecp");
    expect(guessLogical("-Users-aca34-scratch", known)).toBeNull();
  });
  it("path helpers: forward slashes for device files, /c/… for Git Bash", () => {
    expect(fwd("C:\\Users\\t\\.claude\\projects\\x\\memory")).toBe("C:/Users/t/.claude/projects/x/memory");
    expect(bashPath("C:\\Users\\t\\projects\\claude-memory-sync\\bin\\sync-memory")).toBe("/c/Users/t/projects/claude-memory-sync/bin/sync-memory");
    expect(bashPath("/h/projects/claude-memory-sync/bin/sync-memory")).toBe("/h/projects/claude-memory-sync/bin/sync-memory");
  });
});

describe("bashCmd", () => {
  it("is the bare `bash` off Windows and makes no exec call", async () => {
    const { io } = await makeCtx();
    expect(await bashCmd(io, "darwin")).toBe("bash");
    expect(await bashCmd(io, "linux")).toBe("bash");
    expect(io.calls).toEqual([]);
  });
  it("win32: walks up from `git --exec-path` to <git root>\\bin\\bash.exe", async () => {
    const { io } = await makeCtx({ platform: "win32", home: "C:\\Users\\t", files: { "C:\\Program Files\\Git\\bin\\bash.exe": "" } });
    io.on((c, a) => c === "git" && a[0] === "--exec-path", () => ({ code: 0, stdout: "C:/Program Files/Git/mingw64/libexec/git-core\n", stderr: "" }));
    expect(await bashCmd(io, "win32")).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(io.calls).toEqual([expect.objectContaining({ cmd: "git", args: ["--exec-path"] })]);
  });
  it("win32: falls back to `bash` when git is missing or no bin\\bash.exe exists above exec-path", async () => {
    const { io: noGit } = await makeCtx({ platform: "win32", home: "C:\\Users\\t" });
    noGit.on((c) => c === "git", () => ({ code: 127, stdout: "", stderr: "spawn git ENOENT" }));
    expect(await bashCmd(noGit, "win32")).toBe("bash");
    const { io: noBash } = await makeCtx({ platform: "win32", home: "C:\\Users\\t" });
    noBash.on((c, a) => c === "git" && a[0] === "--exec-path", () => ({ code: 0, stdout: "C:/Program Files/Git/mingw64/libexec/git-core\n", stderr: "" }));
    expect(await bashCmd(noBash, "win32")).toBe("bash");
  });
  it("win32 verify spawns the resolved bash for `sync-memory list`", async () => {
    const home = "C:\\Users\\t"; const repo = `${home}\\projects\\claude-memory-sync`;
    const { ctx, io } = await makeCtx({ platform: "win32", home, opts, dirs: [`${repo}\\.git`, `${repo}\\projects\\mecp`, `${home}\\.claude\\projects`], files: { "C:\\Program Files\\Git\\bin\\bash.exe": "", [`${repo}\\devices\\testbox.json`]: JSON.stringify({ device_label: "testbox", platform: "win32", mappings: {} }), [`${home}\\.claude\\scripts\\memory-auto-sync.mjs`]: "", [`${home}\\.claude\\scripts\\load-mecp-context.mjs`]: "" } });
    io.on((c, a) => c === "git" && a[0] === "--exec-path", () => ({ code: 0, stdout: "C:/Program Files/Git/mingw64/libexec/git-core\n", stderr: "" }));
    io.on((c) => c.endsWith("bash.exe"), () => ({ code: 0, stdout: "", stderr: "" }));
    const checks = await projectMemory.verify(ctx);
    expect(checks.find((c) => c.id === "resolves")?.status).toBe("ok");
    const spawn = io.calls.find((c) => c.cmd !== "git");
    expect(spawn?.cmd).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(spawn?.args).toEqual(["/c/Users/t/projects/claude-memory-sync/bin/sync-memory", "--device", "testbox", "list"]);
  });
});

describe("project-memory", () => {
  it("fresh box (--auto): clone → build the device config from guesses → push, then pull; the next plan is empty", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { DEVICE_LABEL: "NEWBOX" }, dirs: memDirs, files: scripts });
    fakes(io);
    const s1 = await projectMemory.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: [`claude-memory-sync repo absent — will clone to ${REPO}`] });
    const steps = projectMemory.plan(ctx, s1);
    expect(steps.map((x) => x.id)).toEqual(["project-memory.clone", "project-memory.device-config", "project-memory.sync"]);
    await projectMemory.apply(ctx, steps);
    expect(io.calls.find((c) => c.cmd === "git")?.args).toEqual(["clone", "--quiet", opts.sshUrl, REPO]);
    const raw = io.files.get(`${REPO}/devices/NEWBOX.json`)!;
    expect(JSON.parse(raw)).toEqual({ device_label: "NEWBOX", platform: "darwin", mappings: {
      mecp: MEM("-Users-aca34-projects-mecp"),
      "mecp-handoffs": MEM("-Users-aca34-projects-mecp-handoffs"),
    } });
    expect(raw.endsWith("}\n")).toBe(true);
    expect(raw).not.toContain("\r");
    expect(events).toContainEqual({ type: "note", level: "warn", message: "project-memory: skipped -Users-aca34-scratch (no logical name)" });
    expect(io.calls.filter((c) => c.cmd === "bash").map((c) => c.args.slice(1))).toEqual([["--device", "NEWBOX", "push"], ["--device", "NEWBOX", "pull"]]);
    expect(io.dirs.has("/h/.claude/projects")).toBe(true);
    expect(io.dirs.has("/h/.claude/logs")).toBe(true);
    expect(await projectMemory.detect(ctx)).toEqual({ kind: "present" });
    expect(projectMemory.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("existing config is extended append-only with newly guessable dirs; mapped and unguessable dirs are left alone", async () => {
    const cfg = { device_label: "BOX", platform: "darwin", note: "kept", mappings: { mecp: MEM("-Users-aca34-projects-mecp") } };
    const { ctx, io } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs, MEM("-Users-aca34-projects-dotfiles")], files: { ...scripts, [`${REPO}/devices/BOX.json`]: JSON.stringify(cfg, null, 2) + "\n" } });
    fakes(io);
    const s = await projectMemory.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["unmapped memory dir(s): -Users-aca34-projects-dotfiles, -Users-aca34-projects-mecp-handoffs — will map into devices/BOX.json"] });
    const steps = projectMemory.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["project-memory.device-config", "project-memory.sync"]);
    await projectMemory.apply(ctx, steps);
    const after = JSON.parse(io.files.get(`${REPO}/devices/BOX.json`)!);
    expect(Object.keys(after)).toEqual(["device_label", "platform", "note", "mappings"]);
    expect(after.mappings).toEqual({ mecp: MEM("-Users-aca34-projects-mecp"), dotfiles: MEM("-Users-aca34-projects-dotfiles"), "mecp-handoffs": MEM("-Users-aca34-projects-mecp-handoffs") });
    expect(await projectMemory.detect(ctx)).toEqual({ kind: "present" });   // scratch stays unmapped (no guess) and is not drift
  });

  it("interactive: the answer wins over the guess, blank skips, a logical name already mapped is never remapped", async () => {
    const { ctx, io, events } = await makeCtx({ opts, interactive: true, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs, MEM("-Users-aca34-projects-mecp-.worktrees-x")], files: scripts, answers: {
      "encoded '-Users-aca34-scratch' → logical name (blank to skip)": "scratch",
      "encoded '-Users-aca34-projects-mecp-handoffs' → logical name (blank to skip)": "",
    } });
    fakes(io);
    await projectMemory.apply(ctx, [{ id: "project-memory.device-config", title: "" }]);
    const after = JSON.parse(io.files.get(`${REPO}/devices/BOX.json`)!);
    expect(after.mappings).toEqual({ mecp: MEM("-Users-aca34-projects-mecp"), scratch: MEM("-Users-aca34-scratch") });
    expect(events.map((e) => e.type === "note" ? e.message : "")).toEqual(expect.arrayContaining([
      expect.stringMatching(/'mecp' already maps to .* — not remapping to -Users-aca34-projects-mecp-\.worktrees-x/),
      "project-memory: skipped -Users-aca34-projects-mecp-handoffs (no logical name)",
    ]));
  });

  it("sync: a push conflict (exit 3) warns and still pulls; a failing pull fails the step", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: { ...scripts, [`${REPO}/devices/BOX.json`]: "{\"device_label\":\"BOX\",\"platform\":\"darwin\",\"mappings\":{}}\n" } });
    fakes(io, { push: 3 });
    await projectMemory.apply(ctx, [{ id: "project-memory.sync", title: "" }]);
    expect(events.find((e) => e.type === "note" && /push exited 3 \(conflicts/.test(e.message))).toBeTruthy();
    expect(io.calls.filter((c) => c.cmd === "bash")).toHaveLength(2);
    const { ctx: ctx2, io: io2 } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: { ...scripts, [`${REPO}/devices/BOX.json`]: "{\"device_label\":\"BOX\",\"platform\":\"darwin\",\"mappings\":{}}\n" } });
    fakes(io2, { pull: 1 });
    await expect(projectMemory.apply(ctx2, [{ id: "project-memory.sync", title: "" }])).rejects.toThrow(/sync-memory pull failed/);
  });

  it("verify mirrors the bootstrap doctor: repo, hook scripts, config, resolution, coverage", async () => {
    const { ctx: none } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" } });
    expect(await projectMemory.verify(none)).toEqual([{ id: "repo", status: "error", message: `claude-memory-sync repo missing at ${REPO} — run bs onboard` }]);

    const { ctx: dead, io: ioDead } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs], files: { [`${REPO}/devices/BOX.json`]: "{\"device_label\":\"BOX\",\"platform\":\"darwin\",\"mappings\":{}}\n" } });
    fakes(ioDead);
    const checks = await projectMemory.verify(dead);
    expect(checks.map((c) => [c.id, c.status])).toEqual([["repo", "ok"], ["hook-scripts", "error"], ["device-config", "ok"], ["resolves", "ok"], ["coverage", "error"]]);
    expect(checks[4].message).toMatch(/maps NOTHING but memory dirs exist — sync is dead: -Users-aca34-projects-mecp -Users-aca34-projects-mecp-handoffs -Users-aca34-scratch/);
    expect(ioDead.calls.filter((c) => c.cmd === "bash").map((c) => c.args.slice(1))).toEqual([["--device", "BOX", "list"]]);

    const { ctx: partial, io: ioPartial } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs], files: { ...scripts, [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: { mecp: MEM("-Users-aca34-projects-mecp") } }) } });
    fakes(ioPartial, { list: 1 });
    const c2 = await projectMemory.verify(partial);
    expect(c2.find((c) => c.id === "resolves")).toMatchObject({ status: "error" });
    expect(c2.find((c) => c.id === "coverage")).toMatchObject({ status: "warn", message: expect.stringMatching(/^1 mapped; these memory dirs are NOT synced: /) });

    const { ctx: missing } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: scripts });
    expect((await projectMemory.verify(missing)).map((c) => [c.id, c.status])).toEqual([["repo", "ok"], ["hook-scripts", "ok"], ["device-config", "error"]]);
  });

  it("an invalid device config blocks instead of being overwritten", async () => {
    const { ctx } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: { ...scripts, [`${REPO}/devices/BOX.json`]: "{nope" } });
    expect(await projectMemory.detect(ctx)).toEqual({ kind: "blocked", reason: "devices/BOX.json is not valid JSON — fix it by hand, then re-run" });
    expect((await projectMemory.verify(ctx)).find((c) => c.id === "device-config")).toMatchObject({ status: "error", message: expect.stringMatching(/not valid JSON/) });
  });

  it("capture: the logical-name memory tree from the device config; nothing when there is no config", async () => {
    const { ctx } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: {
      ...scripts,
      [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: { mecp: MEM("-Users-aca34-projects-mecp") } }),
      [`${MEM("-Users-aca34-projects-mecp")}/MEMORY.md`]: "- [x](x.md)\n", [`${MEM("-Users-aca34-projects-mecp")}/x.md`]: "fact\n",
    } });
    const b = await projectMemory.capture!(ctx);
    expect(b.files.map((f) => f.path)).toEqual(["memory/mecp/MEMORY.md", "memory/mecp/x.md"]);
    const { ctx: nocfg } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: scripts });
    expect((await projectMemory.capture!(nocfg)).files).toEqual([]);
  });

  it("detect and verify never write", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs], files: scripts });
    fakes(io);
    await projectMemory.detect(ctx); await projectMemory.verify(ctx);
    expect(io.writes).toEqual([]);
  });
});
