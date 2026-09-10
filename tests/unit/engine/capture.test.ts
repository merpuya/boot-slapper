import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { captureBundle, scanForSecrets, SecretScanError, sha256 } from "../../../src/engine/capture.ts";
import type { Profile } from "../../../src/engine/profile.ts";
import { makeCtx } from "../helpers.ts";

const art = (id: string, portability: Artifact["portability"], bundle: { files?: Array<{ path: string; content: string }>; instructions?: string[] } | null, seen?: unknown[]): Artifact => ({
  id, portability, surfaces: ["code"], requires: [],
  detect: async () => ({ kind: "present" }), plan: () => [], apply: async () => {}, verify: async () => [],
  ...(bundle ? { capture: async (c) => { seen?.push(c.opts); return { files: bundle.files ?? [], instructions: bundle.instructions ?? [] }; } } : {}),
});
const profile = (artifacts: Artifact[], options: Profile["options"] = {}): Profile => ({ name: "t", provider: "gateway", surfaces: ["code"], artifacts, options });

describe("scanForSecrets", () => {
  it("flags key-shaped strings with file and line; ignores ${…} placeholders and short ids", () => {
    const hits = scanForSecrets([
      { path: "a.txt", content: "ok\nsk-ant-api03-abcdefghijklmnop\n" },
      { path: "b.json", content: '{"Authorization":"Bearer ${MECP_DEVICE_TOKEN}"}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123\n' },
      { path: "c.md", content: "commit 3ea32df27be7 and digest " + "0".repeat(64) + "\ntoken " + "1".repeat(64) + "\n" },
      { path: "d.md", content: "ghp_" + "A".repeat(36) + "\n" },
    ]);
    expect(hits).toEqual([
      { path: "a.txt", line: 2, pattern: "anthropic-key" }, { path: "b.json", line: 2, pattern: "bearer" },
      { path: "c.md", line: 2, pattern: "hex-64" }, { path: "d.md", line: 1, pattern: "github-token" },
    ]);
  });
});

describe("captureBundle", () => {
  it("collects files + instructions in DAG order, hashes a manifest, passes each artifact its options, notes per artifact", async () => {
    const { ctx, events } = await makeCtx({ env: { DEVICE_LABEL: "BOX" } });
    const seen: unknown[] = [];
    const p = profile([
      art("cfg", "portable", { files: [{ path: "claude-config/CLAUDE.md", content: "hi\n" }] }, seen),
      art("keys", "device-bound", { instructions: ["bs secrets set x"] }),
      art("silent", "translatable", null),
    ], { cfg: { k: 1 } });
    const res = await captureBundle(p, ctx, new Date("2026-09-10T12:00:00Z"));
    expect(res.files).toEqual([{ path: "claude-config/CLAUDE.md", content: "hi\n" }]);
    expect(res.manifest).toEqual({ schema: 1, source: ctx.env, captured_at: "2026-09-10T12:00:00.000Z", artifacts: [
      { id: "cfg", portability: "portable", files: ["claude-config/CLAUDE.md"], sha256: { "claude-config/CLAUDE.md": sha256("hi\n") } },
      { id: "keys", portability: "device-bound", files: [], sha256: {} },
    ] });
    expect(res.instructions.startsWith("# boot-slapper — manual steps for BOX")).toBe(true);
    expect(res.instructions).toContain("## keys (device-bound)\n\n- bs secrets set x\n");
    expect(seen).toEqual([{ k: 1 }]);
    expect(events.map((e) => (e.type === "note" ? e.message : ""))).toEqual(["captured cfg: 1 file(s)", "captured keys: 0 file(s), 1 instruction(s)"]);
  });

  it("refuses files from device-bound artifacts, unsafe or duplicate paths, and secret-shaped content", async () => {
    const { ctx } = await makeCtx();
    await expect(captureBundle(profile([art("k", "device-bound", { files: [{ path: "x", content: "" }] })]), ctx)).rejects.toThrow(/k is device-bound and returned 1 file/);
    await expect(captureBundle(profile([art("a", "portable", { files: [{ path: "../x", content: "" }] })]), ctx)).rejects.toThrow(/relative posix/);
    await expect(captureBundle(profile([art("a", "portable", { files: [{ path: "/abs", content: "" }] })]), ctx)).rejects.toThrow(/relative posix/);
    await expect(captureBundle(profile([art("a", "portable", { files: [{ path: "x", content: "" }] }), art("b", "portable", { files: [{ path: "x", content: "" }] })]), ctx)).rejects.toThrow(/duplicate bundle path x/);
    const err = await captureBundle(profile([art("a", "portable", { files: [{ path: "n/t.txt", content: "line\nsk-ant-abcdefghijklmnopqrstu\n" }] })]), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretScanError);
    expect((err as SecretScanError).hits).toEqual([{ path: "n/t.txt", line: 2, pattern: "anthropic-key" }]);
    expect((err as SecretScanError).message).toBe("refusing to write the bundle: 1 secret-shaped string(s) — n/t.txt:2 (anthropic-key)");
  });
});
