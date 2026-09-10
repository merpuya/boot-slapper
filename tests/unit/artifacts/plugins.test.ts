import { describe, expect, it } from "vitest";
import { plugins, sourceOf } from "../../../src/artifacts/plugins.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const P = "/h/.claude/plugins";
const opts = {
  marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }, { name: "cornell-ai", source: "cu-aaii/claude-plugins-marketplace" }],
  plugins: ["superpowers@claude-plugins-official", "context7@claude-plugins-official"],
};
const NAME: Record<string, string> = { "anthropics/claude-plugins-official": "claude-plugins-official", "cu-aaii/claude-plugins-marketplace": "cornell-ai" };
const known = (names: string[]) => JSON.stringify(Object.fromEntries(names.map((n) => [n, { source: { source: "github", repo: Object.entries(NAME).find(([, v]) => v === n)![0] }, installLocation: `${P}/marketplaces/${n}` }])));
const installed = (ids: string[]) => JSON.stringify({ version: 2, plugins: Object.fromEntries(ids.map((id) => [id, [{ scope: "user", installPath: `${P}/cache/x`, version: "6.3.0" }]])) });
const path = { claude: "/h/.local/bin/claude" };

/** `claude plugin …` fake that mutates the same JSON files the real CLI writes. */
function cliFake(io: FakeIo, failInstall?: string) {
  io.on((c, a) => c === "claude" && a[1] === "marketplace" && a[2] === "add", ({ args }) => {
    const cur = JSON.parse(io.files.get(`${P}/known_marketplaces.json`) ?? "{}");
    cur[NAME[args[3]]] = { source: { source: "github", repo: args[3] } };
    io.files.set(`${P}/known_marketplaces.json`, JSON.stringify(cur)); io.dirs.add(P);
    return { code: 0, stdout: "", stderr: "" };
  });
  io.on((c, a) => c === "claude" && a[1] === "install", ({ args }) => {
    if (args[2] === failInstall) return { code: 1, stdout: "", stderr: "Error: marketplace-declared install command needs -y\n" };
    const cur = JSON.parse(io.files.get(`${P}/installed_plugins.json`) ?? '{"version":2,"plugins":{}}');
    cur.plugins[args[2]] = [{ scope: "user", version: "1.0.0" }];
    io.files.set(`${P}/installed_plugins.json`, JSON.stringify(cur));
    return { code: 0, stdout: "", stderr: "" };
  });
}

describe("plugins", () => {
  it("fresh box: absent → add both marketplaces, install both plugins, then present; detect/plan never exec", async () => {
    const { ctx, io } = await makeCtx({ opts, path });
    cliFake(io);
    const s = await plugins.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [
      "marketplace absent: claude-plugins-official (anthropics/claude-plugins-official) — will add",
      "marketplace absent: cornell-ai (cu-aaii/claude-plugins-marketplace) — will add",
      "plugin absent: superpowers@claude-plugins-official — will install",
      "plugin absent: context7@claude-plugins-official — will install",
    ] });
    expect(io.calls).toEqual([]);
    const steps = plugins.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["plugins.marketplace.claude-plugins-official", "plugins.marketplace.cornell-ai", "plugins.install.superpowers@claude-plugins-official", "plugins.install.context7@claude-plugins-official"]);
    await plugins.apply(ctx, steps);
    expect(io.calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ["claude", "plugin", "marketplace", "add", "anthropics/claude-plugins-official", "--scope", "user"],
      ["claude", "plugin", "marketplace", "add", "cu-aaii/claude-plugins-marketplace", "--scope", "user"],
      ["claude", "plugin", "install", "superpowers@claude-plugins-official", "--scope", "user"],
      ["claude", "plugin", "install", "context7@claude-plugins-official", "--scope", "user"],
    ]);
    expect(io.writes).toEqual([]);          // the CLI writes its own files; we never touch ~/.claude/plugins
    expect(await plugins.detect(ctx)).toEqual({ kind: "present" });
    expect(plugins.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("partially set up: drifted with only the missing marketplace and plugin", async () => {
    const { ctx } = await makeCtx({ opts, path, files: { [`${P}/known_marketplaces.json`]: known(["claude-plugins-official"]), [`${P}/installed_plugins.json`]: installed(["superpowers@claude-plugins-official"]) } });
    const s = await plugins.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["marketplace absent: cornell-ai (cu-aaii/claude-plugins-marketplace) — will add", "plugin absent: context7@claude-plugins-official — will install"] });
    expect(plugins.plan(ctx, s).map((x) => x.id)).toEqual(["plugins.marketplace.cornell-ai", "plugins.install.context7@claude-plugins-official"]);
  });

  it("without the claude CLI the artifact is blocked", async () => {
    const { ctx } = await makeCtx({ opts });
    expect(await plugins.detect(ctx)).toEqual({ kind: "blocked", reason: "claude CLI not on PATH — install it (see prereqs), then re-run" });
    expect((await plugins.verify(ctx))[0]).toMatchObject({ id: "cli", status: "error" });
  });

  it("a failing install surfaces the stderr tail and stops", async () => {
    const { ctx, io } = await makeCtx({ opts, path, files: { [`${P}/known_marketplaces.json`]: known(["claude-plugins-official", "cornell-ai"]) } });
    cliFake(io, "superpowers@claude-plugins-official");
    await expect(plugins.apply(ctx, [{ id: "plugins.install.superpowers@claude-plugins-official", title: "" }])).rejects.toThrow(/claude plugin install superpowers@claude-plugins-official failed \(exit 1\): Error: marketplace-declared install command needs -y/);
  });

  it("verify: missing marketplace and plugin are errors, a disabled plugin is a warn that is never auto-enabled", async () => {
    const { ctx } = await makeCtx({ opts, path, files: {
      [`${P}/known_marketplaces.json`]: known(["claude-plugins-official"]),
      [`${P}/installed_plugins.json`]: installed(["superpowers@claude-plugins-official"]),
      "/h/.claude/settings.json": JSON.stringify({ enabledPlugins: { "superpowers@claude-plugins-official": false } }),
    } });
    expect((await plugins.verify(ctx)).map((c) => [c.id, c.status])).toEqual([
      ["cli", "ok"], ["marketplace.claude-plugins-official", "ok"], ["marketplace.cornell-ai", "error"],
      ["plugin.superpowers@claude-plugins-official", "warn"], ["plugin.context7@claude-plugins-official", "error"],
    ]);
    expect(await plugins.detect(ctx)).toMatchObject({ kind: "drifted" });
    expect(plugins.plan(ctx, await plugins.detect(ctx)).map((s) => s.id)).not.toContain("plugins.install.superpowers@claude-plugins-official");
  });

  it("capture writes plugins.json from what is on the box (every marketplace and plugin, with enabled state)", async () => {
    const { ctx } = await makeCtx({ opts, path, files: {
      [`${P}/known_marketplaces.json`]: known(["claude-plugins-official"]),
      [`${P}/installed_plugins.json`]: installed(["superpowers@claude-plugins-official", "extra@claude-plugins-official"]),
      "/h/.claude/settings.json": JSON.stringify({ enabledPlugins: { "extra@claude-plugins-official": false } }),
    } });
    const b = await plugins.capture!(ctx);
    expect(b.files.map((f) => f.path)).toEqual(["plugins.json"]);
    expect(JSON.parse(b.files[0].content)).toEqual({
      marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }],
      plugins: [{ id: "superpowers@claude-plugins-official", version: "6.3.0", scope: "user", enabled: true }, { id: "extra@claude-plugins-official", version: "6.3.0", scope: "user", enabled: false }],
    });
    expect(sourceOf({ source: { source: "directory", path: "/x/y" } })).toBe("/x/y");
  });
});
