import { describe, expect, it } from "vitest";
import { D, desktopSkills, skillDescription, skillsPluginDir } from "../../../src/artifacts/desktop-skills.ts";
import { ENTRY_NAME } from "../../../src/engine/desktop.ts";
import { makeCtx } from "../helpers.ts";

const opts = { skills: ["mecp-conventions", "handoff"] };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const DATA = "/h/Library/Application Support/Claude-3p";
const L = `${DATA}/configLibrary`; const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCT = "831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f";
const PLUGIN = `${DATA}/local-agent-mode-sessions/skills-plugin/00000000-0000-4000-8000-000000000001/${ACCT}`;
const SKILL = "---\nname: mecp-conventions\ndescription: Use when writing to MeCP — guard-rails\n---\n\n# MeCP conventions\n";
const base = (extra: Record<string, string> = {}, entry: Record<string, unknown> = { $schemaVersion: 2, inference: { provider: "gateway" } }) => makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP, `${PLUGIN}/skills`], files: {
  [`${APP}/Contents/Info.plist`]: PLIST, [`${DATA}/ant-did`]: Buffer.from(ACCT).toString("base64") + "\n",
  [`${L}/_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }), [`${L}/${ID}.json`]: JSON.stringify(entry),
  "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: ID }),
  [`${PLUGIN}/manifest.json`]: JSON.stringify({ lastUpdated: 1, skills: [{ skillId: "schedule", name: "schedule", description: "x", creatorType: "anthropic", updatedAt: null, enabled: true }] }),
  "/h/.claude/skills/mecp-conventions/SKILL.md": SKILL, "/h/.claude/skills/mecp-conventions/references/a.md": "A\n",
  "/h/.claude/skills/handoff/SKILL.md": "---\ndescription: Archive what shipped\n---\n", ...extra,
} });

describe("desktop-skills", () => {
  it("helpers", () => {
    expect(skillsPluginDir(DATA, "darwin", "00000000-0000-4000-8000-000000000001", ACCT)).toBe(PLUGIN);
    expect(skillDescription(SKILL)).toBe("Use when writing to MeCP — guard-rails");
    expect(skillDescription("# Title\n\nFirst line.\n")).toBe("First line.");
    expect(skillDescription("")).toBe("");
  });

  it("fresh: copies each listed skill, adds user manifest entries, records source hashes; then present", async () => {
    const { ctx, io } = await base();
    const s = await desktopSkills.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.copy} mecp-conventions — will copy to ${PLUGIN}/skills/mecp-conventions`, `${D.copy} handoff — will copy to ${PLUGIN}/skills/handoff`] });
    expect(io.writes).toEqual([]);
    const steps = desktopSkills.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-skills.copy.mecp-conventions", "desktop-skills.copy.handoff", "desktop-skills.manifest"]);
    await desktopSkills.apply(ctx, steps);
    expect(io.files.get(`${PLUGIN}/skills/mecp-conventions/SKILL.md`)).toBe(SKILL);
    expect(io.files.get(`${PLUGIN}/skills/mecp-conventions/references/a.md`)).toBe("A\n");
    const m = JSON.parse(io.files.get(`${PLUGIN}/manifest.json`)!);
    expect(m.skills.map((x: { name: string; creatorType: string }) => [x.name, x.creatorType])).toEqual([["schedule", "anthropic"], ["mecp-conventions", "user"], ["handoff", "user"]]);
    expect(m.skills[1]).toMatchObject({ skillId: "mecp-conventions", description: "Use when writing to MeCP — guard-rails", syncManaged: false, enabled: true });
    expect(typeof m.skills[1].updatedAt).toBe("string"); expect(typeof m.lastUpdated).toBe("number");
    expect(Object.keys(JSON.parse(io.files.get("/h/.config/boot-slapper/desktop.json")!).skills)).toEqual(["mecp-conventions", "handoff"]);
    expect(await desktopSkills.detect(ctx)).toEqual({ kind: "present" });
    expect(desktopSkills.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("a changed source is re-copied; a skill Cowork already has that boot-slapper never wrote is left alone and reported", async () => {
    const { ctx, io } = await base({ [`${PLUGIN}/skills/handoff/SKILL.md`]: "user's own\n" }, { $schemaVersion: 2 });
    io.files.set(`${PLUGIN}/manifest.json`, JSON.stringify({ lastUpdated: 1, skills: [{ skillId: "skill_01", name: "handoff", description: "theirs", creatorType: "user", updatedAt: "2026-07-14T00:00:00Z", enabled: true }] }));
    const s = await desktopSkills.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.copy} mecp-conventions — will copy to ${PLUGIN}/skills/mecp-conventions`, `${D.foreign} handoff — left alone`] });
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, s));
    expect(io.files.get(`${PLUGIN}/skills/handoff/SKILL.md`)).toBe("user's own\n");
    expect(JSON.parse(io.files.get(`${PLUGIN}/manifest.json`)!).skills.find((x: { name: string }) => x.name === "handoff").skillId).toBe("skill_01");
    io.files.set("/h/.claude/skills/mecp-conventions/SKILL.md", SKILL + "\nmore\n");
    const s2 = await desktopSkills.detect(ctx);
    expect(s2).toMatchObject({ kind: "drifted", details: [expect.stringMatching(/^skill to copy: mecp-conventions — source changed/), `${D.foreign} handoff — left alone`] });
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, s2));
    expect(io.files.get(`${PLUGIN}/skills/mecp-conventions/SKILL.md`)).toBe(SKILL + "\nmore\n");
  });

  it("org segment follows deploymentOrganizationUuid when the boot-slapper entry sets it", async () => {
    const org = "12345678-1234-4123-8123-123456789abc";
    const p = `${DATA}/local-agent-mode-sessions/skills-plugin/${org}/${ACCT}`;
    const { ctx, io } = await makeCtx({ opts: { skills: ["handoff"] }, env: { USER: "aca34" }, dirs: [APP, `${p}/skills`], files: {
      [`${APP}/Contents/Info.plist`]: PLIST, [`${DATA}/ant-did`]: Buffer.from(ACCT).toString("base64"),
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }), [`${L}/${ID}.json`]: JSON.stringify({ $schemaVersion: 2, telemetry: { orgUuid: org } }),
      [`${p}/manifest.json`]: JSON.stringify({ lastUpdated: 1, skills: [] }), "/h/.claude/skills/handoff/SKILL.md": "---\ndescription: d\n---\n",
    } });
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, await desktopSkills.detect(ctx)));
    expect(io.files.has(`${p}/skills/handoff/SKILL.md`)).toBe(true);
  });

  it("blocked until Desktop has run in 3P mode (ant-did + plugin dir), or when a listed skill is missing from ~/.claude/skills", async () => {
    const noDid = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/skills/mecp-conventions/SKILL.md": SKILL, "/h/.claude/skills/handoff/SKILL.md": "x" } });
    expect(await desktopSkills.detect(noDid.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/launch Claude Desktop once in third-party mode/) });
    const { ctx, io } = await base();
    io.files.delete("/h/.claude/skills/handoff/SKILL.md");
    expect(await desktopSkills.detect(ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/handoff/) });
  });

  // FR-3: the manifest step read-modify-writes Cowork's own manifest.json, so it takes the same refusal
  // the config-library artifacts take — Cowork rewrites that file from memory while it is running.
  it("apply refuses to touch Cowork's plugin directory while Claude Desktop is running, and writes nothing", async () => {
    const { ctx, io } = await base();
    const s = await desktopSkills.detect(ctx);
    const steps = desktopSkills.plan(ctx, s);
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "2590\n", stderr: "" }));
    await expect(desktopSkills.apply(ctx, steps)).rejects.toThrow(/Claude Desktop is running — quit it/);
    await expect(desktopSkills.apply(ctx, [steps.at(-1)!])).rejects.toThrow(/re-run bs onboard --only desktop-skills/);
    expect(io.writes).toEqual([]);
    expect(io.files.has(`${PLUGIN}/skills/mecp-conventions/SKILL.md`)).toBe(false);
    expect(JSON.parse(io.files.get(`${PLUGIN}/manifest.json`)!).skills).toHaveLength(1);
  });

  it("verify and capture", async () => {
    const { ctx, io } = await base();
    expect((await desktopSkills.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["cowork", "ok"], ["skill.mecp-conventions", "error"], ["skill.handoff", "error"]]);
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, await desktopSkills.detect(ctx)));
    expect((await desktopSkills.verify(ctx)).map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    io.files.set("/h/.claude/skills/handoff/SKILL.md", "changed");
    expect((await desktopSkills.verify(ctx)).find((c) => c.id === "skill.handoff")).toMatchObject({ status: "warn", message: expect.stringMatching(/source changed/) });
    const b = await desktopSkills.capture!(ctx);
    expect(b.files.map((f) => f.path)).toEqual(["desktop-skills/mecp-conventions/SKILL.md", "desktop-skills/mecp-conventions/references/a.md", "desktop-skills/handoff/SKILL.md"]);
    expect(io.writes.filter((w) => w.startsWith("/h/.claude"))).toEqual([]);
  });
});
