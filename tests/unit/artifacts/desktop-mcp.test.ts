import { describe, expect, it } from "vitest";
import { desktopMcp, wantedServers } from "../../../src/artifacts/desktop-mcp.ts";
import { desktopInference, wantedDoc } from "../../../src/artifacts/desktop-inference.ts";
import { withOpts } from "../../../src/engine/artifact.ts";
import { ENTRY_NAME } from "../../../src/engine/desktop.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { tokens: { MECP_DEVICE_TOKEN: "mecp-device-token" as const } };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const L = "/h/Library/Application Support/Claude-3p/configLibrary";
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INF = "/h/.config/boot-slapper/desktop-inference-credential.sh";
const HELPER = "/h/.config/boot-slapper/desktop-mcp-mecp-headers.sh";
const bundle = { mcpServers: { openbrain: { type: "http", url: "https://ob/mcp" }, mecp: { type: "http", url: "https://mecp/mcp", headers: { Authorization: "Bearer ${MECP_DEVICE_TOKEN}" } } } };
const box = (extra: Record<string, string> = {}, entry: Record<string, unknown> = wantedDoc({ baseUrl: "https://gw" }, INF)) => makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: {
  [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/mcp/gateway.json": JSON.stringify(bundle),
  [`${L}/_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }), [`${L}/${ID}.json`]: JSON.stringify(entry),
  "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: ID }), ...extra,
} });
const secrets = (io: FakeIo) => io.on((c) => c === "security", () => ({ code: 0, stdout: "s3cr3t-val\n", stderr: "" }));
const expectedServers = [
  { name: "openbrain", transport: "http", url: "https://ob/mcp", oauth: true },
  { name: "mecp", transport: "http", url: "https://mecp/mcp", headersHelper: HELPER, headersHelperTtlSec: 3600 },
];

describe("desktop-mcp", () => {
  it("wantedServers maps the gateway bundle: OAuth for header-less entries, a headers helper for ${TOKEN} placeholders, skips the rest", () => {
    const w = wantedServers(bundle, opts, "darwin", "/h");
    expect(w.servers).toEqual(expectedServers);
    expect(w.helpers).toEqual([{ path: HELPER, body: expect.stringContaining("mecp-device-token") }]);
    const odd = wantedServers({ mcpServers: { a: { type: "http", url: "https://a", headers: { Authorization: "Bearer literal" } }, b: { type: "stdio" }, c: { type: "sse", url: "https://c" } } }, opts, "darwin", "/h");
    expect(odd.servers).toEqual([{ name: "c", transport: "sse", url: "https://c", oauth: true }]);
  });

  it("fresh: absent → helper + servers written into the boot-slapper entry; other keys untouched; then present", async () => {
    const { ctx, io, events } = await box(); secrets(io);
    const s = await desktopMcp.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`headers helper absent or stale: mecp — will write ${HELPER}`, "managed MCP servers differ: openbrain, mecp — will write them into the boot-slapper entry"] });
    const steps = desktopMcp.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-mcp.helpers", "desktop-mcp.servers"]);
    await desktopMcp.apply(ctx, steps);
    expect(io.modes.get(HELPER)).toBe(0o700);
    const doc = JSON.parse(io.files.get(`${L}/${ID}.json`)!);
    expect(doc.mcp).toEqual({ managedServers: expectedServers });
    expect(doc.inference).toEqual(wantedDoc({ baseUrl: "https://gw" }, INF).inference);
    expect(JSON.parse(io.files.get("/h/.config/boot-slapper/desktop.json")!)).toEqual({ entryId: ID, servers: ["openbrain", "mecp"] });
    expect(await desktopMcp.detect(ctx)).toEqual({ kind: "present" });
    expect(JSON.stringify([...io.files.values(), ...events])).not.toContain("s3cr3t-val");
  });

  it("foreign managed servers in our entry are preserved; ours are updated in place; a removed bundle entry is dropped from ours only", async () => {
    const entry = { ...wantedDoc({ baseUrl: "https://gw" }, INF), mcp: { managedServers: [{ name: "corp", transport: "http", url: "https://corp" }, { name: "mecp", transport: "http", url: "https://old/mcp", headersHelper: HELPER, headersHelperTtlSec: 3600 }] } };
    const { ctx, io } = await box({ "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: ID, servers: ["mecp", "gone"] }), [HELPER]: "stale" }, entry);
    secrets(io);
    const s = await desktopMcp.detect(ctx);
    expect(s.kind).toBe("drifted");
    await desktopMcp.apply(ctx, desktopMcp.plan(ctx, s));
    const doc = JSON.parse(io.files.get(`${L}/${ID}.json`)!);
    expect(doc.mcp.managedServers).toEqual([{ name: "corp", transport: "http", url: "https://corp" }, ...expectedServers]);
  });

  it("blocked: Claude Desktop below the version floor, or a managed source owns the configuration; the default satisfied box is neither", async () => {
    const oldVersion = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST.replace("1.49585.0", "1.5354.0"), "/h/.claude/mcp/gateway.json": JSON.stringify(bundle) } });
    expect(await desktopMcp.detect(oldVersion.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/1\.5354\.0 < 1\.19367\.0/) });
    const managed = await box({ "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist" });
    managed.io.on((c) => c === "plutil", () => ({ code: 0, stdout: JSON.stringify({ disableAutoUpdates: true, inferenceProvider: "vertex" }), stderr: "" }));   // plutil -convert json
    expect(await desktopMcp.detect(managed.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/managed configuration owns Claude Desktop \(\/Library\/Managed Preferences\/com\.anthropic\.claudefordesktop\.plist sets inferenceProvider\)/) });
    const { ctx } = await box();
    expect((await desktopMcp.detect(ctx)).kind).not.toBe("blocked");
  });

  // FR-1: resolvePlan runs every detect before applyPlan runs any step, so on a fresh box the entry does
  // not exist yet even though desktop-inference is earlier in the same plan. Blocking here also dropped
  // open-brain-auth (it requires desktop-mcp), so the runbook's second pass never reached either.
  it("fresh box with no entry yet: absent (not blocked), both steps planned, and the servers step refuses if the entry really is missing", async () => {
    const fresh = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/mcp/gateway.json": JSON.stringify(bundle) } });
    secrets(fresh.io);
    const s = await desktopMcp.detect(fresh.ctx);
    expect(s).toEqual({ kind: "absent", details: [
      "no boot-slapper entry yet — desktop-inference creates it earlier in this run",
      `headers helper absent or stale: mecp — will write ${HELPER}`,
      "managed MCP servers differ: openbrain, mecp — will write them into the boot-slapper entry",
    ] });
    const steps = desktopMcp.plan(fresh.ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-mcp.helpers", "desktop-mcp.servers"]);
    await expect(desktopMcp.apply(fresh.ctx, steps)).rejects.toThrow("no boot-slapper entry — desktop-inference must apply first");
    expect(fresh.io.writes).toEqual([HELPER]);   // the helper step is independent of the entry
  });

  it("end to end on one box: desktop-inference applies its steps, then the previously planned desktop-mcp steps land and detect is present", async () => {
    const fresh = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/mcp/gateway.json": JSON.stringify(bundle) } });
    secrets(fresh.io);
    const inf = withOpts(fresh.ctx, { baseUrl: "https://gw" });
    const mcp = withOpts(fresh.ctx, opts);
    // both detects run first, as resolvePlan does
    const infState = await desktopInference.detect(inf);
    const mcpState = await desktopMcp.detect(mcp);
    expect(mcpState.kind).toBe("absent");
    await desktopInference.apply(inf, desktopInference.plan(inf, infState));
    await desktopMcp.apply(mcp, desktopMcp.plan(mcp, mcpState));
    const meta = JSON.parse(fresh.io.files.get(`${L}/_meta.json`)!) as { appliedId: string };
    const doc = JSON.parse(fresh.io.files.get(`${L}/${meta.appliedId}.json`)!) as { mcp: { managedServers: unknown[] } };
    expect(doc.mcp.managedServers).toEqual(expectedServers);
    expect(await desktopMcp.detect(mcp)).toEqual({ kind: "present" });
  });

  it("blocked without the bundle, or while Desktop runs at apply time", async () => {
    const noBundle = await box({ "/h/.claude/mcp/gateway.json": "" });
    noBundle.io.files.delete("/h/.claude/mcp/gateway.json");
    expect(await desktopMcp.detect(noBundle.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/gateway\.json/) });
    const { ctx, io } = await box(); secrets(io);
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "1\n", stderr: "" }));
    const steps = desktopMcp.plan(ctx, await desktopMcp.detect(ctx));
    await expect(desktopMcp.apply(ctx, [steps[1]])).rejects.toThrow(/Claude Desktop is running/);
  });

  it("verify: entry servers, helper files, secrets present, version floor; messages never carry a token", async () => {
    const { ctx, io } = await box(); secrets(io);
    await desktopMcp.apply(ctx, desktopMcp.plan(ctx, await desktopMcp.detect(ctx)));
    const c = Object.fromEntries((await desktopMcp.verify(ctx)).map((x) => [x.id, x]));
    expect(c["server.openbrain"]).toMatchObject({ status: "ok", message: expect.stringMatching(/oauth/) });
    expect(c["server.mecp"]).toMatchObject({ status: "ok", message: expect.stringMatching(/headers helper/) });
    expect(c["secret.mecp"]).toMatchObject({ status: "ok" });
    expect(c.version).toMatchObject({ status: "ok" });
    io.files.set(`${L}/${ID}.json`, JSON.stringify(wantedDoc({ baseUrl: "https://gw" }, INF)));
    expect((await desktopMcp.verify(ctx)).filter((x) => x.id.startsWith("server.")).map((x) => x.status)).toEqual(["error", "error"]);
    expect(JSON.stringify(await desktopMcp.verify(ctx))).not.toContain("s3cr3t-val");
  });

  it("win32: .ps1 helper path lands in the entry with backslashes", async () => {
    const home = "C:\\Users\\t"; const lad = `${home}\\AppData\\Local`; const lib = `${lad}\\Claude-3p\\configLibrary`;
    const inf = `${home}\\.config\\boot-slapper\\desktop-inference-credential.ps1`;
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t", LOCALAPPDATA: lad }, dirs: [`${lad}\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`], files: {
      [`${home}\\.claude\\mcp\\gateway.json`]: JSON.stringify(bundle), [`${lib}\\_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }),
      [`${lib}\\${ID}.json`]: JSON.stringify(wantedDoc({ baseUrl: "https://gw" }, inf)), [`${home}\\.config\\boot-slapper\\desktop.json`]: JSON.stringify({ entryId: ID }),
    } });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "1.49585.0\r\n", stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    io.on((c) => c === "reg", () => ({ code: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value." }));
    await desktopMcp.apply(ctx, desktopMcp.plan(ctx, await desktopMcp.detect(ctx)));
    const doc = JSON.parse(io.files.get(`${lib}\\${ID}.json`)!);
    expect(doc.mcp.managedServers[1].headersHelper).toBe(`${home}\\.config\\boot-slapper\\desktop-mcp-mecp-headers.ps1`);
    expect(io.files.get(`${home}\\.config\\boot-slapper\\desktop-mcp-mecp-headers.ps1`)).toContain("Retrieve('mecp-device-token'");
  });
});
