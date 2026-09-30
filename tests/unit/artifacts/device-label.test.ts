import { describe, expect, it } from "vitest";
import { deviceLabel } from "../../../src/artifacts/device-label.ts";
import { makeCtx } from "../helpers.ts";

const LOCAL = "/h/.claude/settings.local.json";
const SHARED = "/h/.claude/settings.json";
const pinned = (v: string) => JSON.stringify({ env: { DEVICE_LABEL: v } });

describe("device-label", () => {
  it("unpinned box: pins the hostname into settings.local.json, keeps other keys, and is idempotent", async () => {
    const { ctx, io } = await makeCtx({ hostname: "alexsmacstudio", dirs: ["/h/.claude"], files: { [LOCAL]: JSON.stringify({ permissions: { allow: ["x"] }, env: { OTHER: "1" } }) } });
    const s1 = await deviceLabel.detect(ctx);
    expect(s1.kind).toBe("absent");
    const steps = deviceLabel.plan(ctx, s1);
    expect(steps.map((s) => s.id)).toEqual(["device-label.pin"]);
    await deviceLabel.apply(ctx, steps);
    expect(JSON.parse(io.files.get(LOCAL)!)).toEqual({ permissions: { allow: ["x"] }, env: { OTHER: "1", DEVICE_LABEL: "alexsmacstudio" } });
    expect(await deviceLabel.detect(ctx)).toEqual({ kind: "present" });
    expect(deviceLabel.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("creates settings.local.json when absent; a profile-supplied label beats the hostname", async () => {
    const { ctx, io } = await makeCtx({ hostname: "h1", opts: { label: "mac-studio.kearnsapuya.net" } });
    await deviceLabel.apply(ctx, deviceLabel.plan(ctx, await deviceLabel.detect(ctx)));
    expect(JSON.parse(io.files.get(LOCAL)!)).toEqual({ env: { DEVICE_LABEL: "mac-studio.kearnsapuya.net" } });
  });

  it("never rewrites an existing pin: env, settings.local.json, or settings.json each count", async () => {
    for (const init of [{ env: { DEVICE_LABEL: "E" } }, { files: { [LOCAL]: pinned("L") } }, { files: { [SHARED]: pinned("S") } }]) {
      const { ctx, io } = await makeCtx({ hostname: "other", ...init });
      expect(await deviceLabel.detect(ctx)).toEqual({ kind: "present" });
      await deviceLabel.apply(ctx, [{ id: "device-label.pin", title: "forced" }]);   // even a forced step must not overwrite
      expect(io.writes).toEqual([]);
    }
  });

  it("an unparseable settings.local.json blocks detect and fails apply without clobbering it", async () => {
    const { ctx, io } = await makeCtx({ files: { [LOCAL]: "{ nope" } });
    expect((await deviceLabel.detect(ctx)).kind).toBe("blocked");
    await expect(deviceLabel.apply(ctx, [{ id: "device-label.pin", title: "x" }])).rejects.toThrow(/not valid JSON/);
    expect(io.files.get(LOCAL)).toBe("{ nope");
  });

  it("verify: pinned → ok with source; macOS unpinned without scutil HostName → warn; with it → ok; linux → ok", async () => {
    let r = await makeCtx({ files: { [LOCAL]: pinned("box") } });
    expect(await deviceLabel.verify(r.ctx)).toEqual([{ id: "label", status: "ok", message: "device label: box (from settings.local.json)" }]);
    r = await makeCtx({ hostname: "flippy" });
    r.io.on((c) => c === "scutil", () => ({ code: 1, stdout: "", stderr: "HostName: not set" }));
    const [warn] = await deviceLabel.verify(r.ctx);
    expect(warn.status).toBe("warn");
    expect(warn.message).toMatch(/^device label: flippy \(from hostname\) — unpinned; macOS can change it with the network\. Pin env\.DEVICE_LABEL in /);
    r = await makeCtx({ hostname: "stable" });
    r.io.on((c) => c === "scutil", () => ({ code: 0, stdout: "stable\n", stderr: "" }));
    expect((await deviceLabel.verify(r.ctx))[0]).toEqual({ id: "label", status: "ok", message: "device label: stable (from hostname, scutil HostName set)" });
    r = await makeCtx({ platform: "linux", hostname: "lin" });
    expect((await deviceLabel.verify(r.ctx))[0].status).toBe("ok");
  });
});

describe("device-label ordering", () => {
  it("aca34 orders device-label after claude-config, so a fresh box's ~/.claude is cloned before the pin is written", async () => {
    const { aca34 } = await import("../../../src/profiles/aca34.ts");
    const { selectArtifacts } = await import("../../../src/engine/plan.ts");
    const ids = selectArtifacts(aca34).map((a) => a.id);
    expect(deviceLabel.requires).toContain("claude-config");
    expect(ids.indexOf("device-label")).toBeGreaterThan(ids.indexOf("claude-config"));
  });

  it("verify flags an unparseable settings.local.json instead of reporting a hostname label", async () => {
    const { ctx } = await makeCtx({ files: { [LOCAL]: "{ nope" } });
    const [c] = await deviceLabel.verify(ctx);
    expect(c.status).toBe("error");
    expect(c.message).toMatch(/not valid JSON/);
  });
});
