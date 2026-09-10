import { describe, expect, it } from "vitest";
import { mct, npmArgv } from "../../../src/artifacts/mct.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { sshUrl: "git@github.com:merpuya/me-count-token.git", httpsUrl: "https://github.com/merpuya/me-count-token.git", syncUrl: "https://mct.kearnsapuya.net" };
const DIR = "/h/projects/me-count-token";
const BUILT = `${DIR}/dist/hooks/session-start.js`;
const tools = { npm: "/usr/local/bin/npm", node: "/usr/local/bin/node" };

function fakes(io: FakeIo, o: { nodeVersion?: string; doctor?: number; onboard?: number; token?: boolean } = {}) {
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "successfully authenticated" }));
  io.on((c, a) => c === "node" && a[0] === "--version", () => ({ code: 0, stdout: `${o.nodeVersion ?? "v22.12.0"}\n`, stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "doctor", () => ({ code: o.doctor ?? 0, stdout: "", stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "onboard", () => ({ code: o.onboard ?? 0, stdout: "", stderr: "" }));
  io.on((c, a) => c === "git" && a[0] === "clone", () => { io.dirs.add(DIR); return { code: 0, stdout: "", stderr: "" }; });
  io.on((c, a) => c === "npm" && a.includes("build"), () => { io.files.set(BUILT, ""); io.dirs.add(`${DIR}/dist/hooks`); return { code: 0, stdout: "", stderr: "" }; });
  io.on((c) => c === "npm", () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "security", () => (o.token === false ? { code: 44, stdout: "", stderr: "" } : { code: 0, stdout: "t0k3n-value\n", stderr: "" }));
}

describe("mct", () => {
  it("fresh box, interactive: clone → build → activate by seeding ~/.mct/config.json and running a bare onboard; the token never hits argv or events", async () => {
    const { ctx, io, events } = await makeCtx({ opts, path: tools, env: { USER: "aca34", DEVICE_LABEL: "NEWBOX" }, interactive: true, answers: { "mct device id (MeCP device slug; blank to skip)": "newbox-slug" } });
    fakes(io);
    const s1 = await mct.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: [
      "no me-count-token checkout — will clone to ~/projects/me-count-token",
      "dist/ not built — will npm install && npm run build",
      "mct not activated — will seed ~/.mct/config.json from the store and run mct onboard",
    ] });
    const steps = mct.plan(ctx, s1);
    expect(steps.map((x) => [x.id, !!x.interactive])).toEqual([["mct.clone", false], ["mct.build", false], ["mct.activate", true]]);
    expect(steps[2].secret).toEqual({ service: "mct-sync-token", account: "aca34" });
    await mct.apply(ctx, steps);
    expect(io.calls.find((c) => c.cmd === "git")?.args).toEqual(["clone", "--quiet", opts.sshUrl, DIR]);
    expect(io.calls.filter((c) => c.cmd === "npm").map((c) => c.args)).toEqual([
      ["--prefix", DIR, "install", "--no-audit", "--no-fund", "--silent"], ["--prefix", DIR, "run", "--silent", "build"],
    ]);
    expect(JSON.parse(io.files.get("/h/.mct/config.json")!)).toEqual({ deviceId: "newbox-slug", syncUrl: opts.syncUrl, syncToken: "t0k3n-value" });
    expect(io.modes.get("/h/.mct/config.json")).toBe(0o600);
    expect(io.calls.find((c) => c.cmd === "node" && c.args[1] === "onboard")?.args).toEqual([`${DIR}/dist/cli.js`, "onboard"]);
    expect(JSON.stringify(io.calls.map((c) => c.args))).not.toContain("t0k3n-value");
    expect(JSON.stringify(events)).not.toContain("t0k3n-value");
    expect(await mct.detect(ctx)).toEqual({ kind: "present" });
    expect(mct.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("a label in deviceIds makes activation headless; an existing config's extra keys survive", async () => {
    const { ctx, io } = await makeCtx({ opts: { ...opts, deviceIds: { BOX: "box-slug" } }, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "", "/h/.mct/config.json": "  " } });
    fakes(io);
    const s = await mct.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["mct not activated — will seed ~/.mct/config.json from the store and run mct onboard"] });
    const steps = mct.plan(ctx, s);
    expect(steps).toEqual([{ id: "mct.activate", title: "activate mct as 'box-slug' (token from the store) and run mct onboard", interactive: false, secret: { service: "mct-sync-token", account: "aca34" } }]);
    await mct.apply(ctx, steps);
    expect(JSON.parse(io.files.get("/h/.mct/config.json")!)).toEqual({ deviceId: "box-slug", syncUrl: opts.syncUrl, syncToken: "t0k3n-value" });
  });

  it("no sync token in the store: warn and skip activation without writing anything", async () => {
    const { ctx, io, events } = await makeCtx({ opts: { ...opts, deviceIds: { BOX: "box-slug" } }, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "" } });
    fakes(io, { token: false });
    await mct.apply(ctx, [{ id: "mct.activate", title: "", secret: { service: "mct-sync-token", account: "aca34" } }]);
    expect(io.writes).toEqual([]);
    expect(io.calls.find((c) => c.cmd === "node" && c.args[1] === "onboard")).toBeUndefined();
    expect(events).toContainEqual({ type: "note", level: "warn", message: "mct: no sync token — bs secrets set mct-sync-token (mint it with `mct devices add box-slug` on an admin box), then re-run" });
  });

  it("headless without a deviceIds entry: warn and skip; a blank interactive answer does the same", async () => {
    const { ctx, io, events } = await makeCtx({ opts, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "" } });
    fakes(io);
    await mct.apply(ctx, [{ id: "mct.activate", title: "", secret: { service: "mct-sync-token", account: "aca34" } }]);
    expect(io.writes).toEqual([]);
    expect(events.find((e) => e.type === "note" && /no device id/.test(e.message))).toBeTruthy();
  });

  it("npm on Windows runs through node + npm-cli.js, never npm.cmd", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\Users\\t", path: { npm: "C:\\Program Files\\nodejs\\npm.cmd" } });
    expect(await npmArgv(io, "win32")).toEqual(["node", ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"]]);
    expect(await npmArgv(new FakeIo({ path: { npm: "/usr/local/bin/npm" } }), "darwin")).toEqual(["npm", []]);
    expect(await npmArgv(new FakeIo(), "darwin")).toBeNull();
  });

  it("without npm the artifact is blocked, not failed", async () => {
    const { ctx } = await makeCtx({ opts, path: { node: "/usr/local/bin/node" }, env: { USER: "aca34" } });
    expect((await mct.detect(ctx)).kind).toBe("blocked");
  });

  it("verify walks the bootstrap doctor's ladder", async () => {
    const at = async (init: Parameters<typeof makeCtx>[0], f: Parameters<typeof fakes>[1] = {}) => { const { ctx, io } = await makeCtx({ opts, path: tools, env: { USER: "aca34" }, ...init }); fakes(io, f); return (await mct.verify(ctx))[0]; };
    expect(await at({})).toMatchObject({ id: "status", status: "warn", message: expect.stringMatching(/^no me-count-token checkout/) });
    expect(await at({ dirs: [DIR] })).toMatchObject({ status: "error", message: expect.stringMatching(/dist\/ not built/) });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "" } })).toMatchObject({ status: "warn", message: expect.stringMatching(/not activated/) });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "", "/h/.mct/config.json": "{}" } }, { nodeVersion: "v20.1.0" })).toMatchObject({ status: "warn", message: expect.stringMatching(/node v20\.1\.0 < 22\.5/) });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "", "/h/.mct/config.json": "{}" } })).toEqual({ id: "status", status: "ok", message: "mct doctor passes" });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "", "/h/.mct/config.json": "{}" } }, { doctor: 1 })).toMatchObject({ status: "warn", message: expect.stringMatching(/mct doctor reports problems/) });
    expect(await at({ dirs: ["/h/Claude/me-count-token"], files: { "/h/Claude/me-count-token/dist/hooks/session-start.js": "", "/h/.mct/config.json": "{}" } })).toMatchObject({ status: "ok" });   // second probe path
  });

  it("an invalid ~/.mct/config.json fails activation with a clear message instead of clobbering it", async () => {
    const { ctx } = await makeCtx({ opts: { ...opts, deviceIds: { BOX: "s" } }, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "", "/h/.mct/config.json": "{nope" } });
    await expect(mct.apply(ctx, [{ id: "mct.activate", title: "", secret: { service: "mct-sync-token", account: "aca34" } }])).rejects.toThrow(/not valid JSON/);
  });
});
