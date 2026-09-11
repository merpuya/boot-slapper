import { describe, expect, it } from "vitest";
import { D, openBrainAuth } from "../../../src/artifacts/open-brain-auth.ts";
import { makeCtx } from "../helpers.ts";

const opts = { server: "openbrain" };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const CFG = "/h/Library/Application Support/Claude-3p/config.json";
const creds = (grant: boolean) => JSON.stringify({ claudeAiOauth: { accessToken: "s3cr3t-val" }, mcpOAuth: grant ? { "openbrain|abc123": { accessToken: "s3cr3t-val", serverName: "openbrain" } } : {} });
const box = (code: boolean, desktop: boolean) => makeCtx({ opts, env: { USER: "aca34" }, interactive: true, dirs: [APP], files: {
  [`${APP}/Contents/Info.plist`]: PLIST, [CFG]: JSON.stringify({ locale: "en", ...(desktop ? { custom3pMcpOAuth: { openbrain: "ENCRYPTEDBLOB==" } } : {}) }),
} }).then((r) => { r.io.on((c, a) => c === "security" && a.includes("Claude Code-credentials"), () => ({ code: 0, stdout: creds(code) + "\n", stderr: "" })); return r; });

describe("open-brain-auth", () => {
  it("absent when either grant is missing; the plan is one interactive gate; apply gates then re-checks; nothing leaks", async () => {
    const { ctx, io, events } = await box(false, false);
    const s = await openBrainAuth.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.code} — Claude Code: /mcp → openbrain → Authenticate`, `${D.desktop} — Claude Desktop: Connectors → openbrain → Connect`] });
    expect(io.writes).toEqual([]);
    const steps = openBrainAuth.plan(ctx, s);
    expect(steps).toEqual([{ id: "open-brain-auth.gate", title: "Authorize Open Brain — Claude Code: /mcp → openbrain → Authenticate; Claude Desktop: Connectors → openbrain → Connect; press Enter when both are done", interactive: true }]);
    await openBrainAuth.apply(ctx, steps);
    expect(events.filter((e) => e.type === "note").map((e) => (e as { message: string }).message)).toEqual(["open-brain-auth: still missing — Claude Code has no Open Brain grant; Claude Desktop has no Open Brain grant (re-run bs doctor after authorizing)"]);
    expect(JSON.stringify([...io.files.values(), ...events])).not.toContain("s3cr3t-val");
  });
  it("present when both grants exist; verify reports each surface", async () => {
    const { ctx } = await box(true, true);
    expect(await openBrainAuth.detect(ctx)).toEqual({ kind: "present" });
    expect((await openBrainAuth.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["code", "ok"], ["desktop", "ok"]]);
    const half = await box(true, false);
    expect((await openBrainAuth.verify(half.ctx)).map((c) => [c.id, c.status])).toEqual([["code", "ok"], ["desktop", "warn"]]);
    expect(JSON.stringify(await openBrainAuth.verify(half.ctx))).not.toContain("s3cr3t-val");
  });
  it("win32 reads ~/.claude/.credentials.json; a missing Desktop is a warn, not an error", async () => {
    const home = "C:\\Users\\t";
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t" }, files: { [`${home}\\.claude\\.credentials.json`]: creds(true) } });
    io.on((c) => c === "reg", () => ({ code: 1, stdout: "", stderr: "" }));
    expect((await openBrainAuth.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["code", "ok"], ["desktop", "warn"]]);
  });
  it("headless: the gate step is skipped by the runner (interactive), and capture carries the instruction", async () => {
    const { ctx } = await box(false, false);
    expect((await openBrainAuth.capture!(ctx)).instructions).toEqual(["Authorize Open Brain on the target: Claude Code /mcp → openbrain → Authenticate; Claude Desktop Connectors → openbrain → Connect (OAuth grants are device-bound)"]);
  });
});
