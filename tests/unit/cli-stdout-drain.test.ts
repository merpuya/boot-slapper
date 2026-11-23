import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// doctor-json-stdout-truncation: `bs doctor --json | consumer` was cut at exactly 65536 bytes because the entrypoint
// called process.exit() right after a large write, before a piped stdout drained. A pipe (not a file) is what reproduces it.
const ROOT = path.resolve(import.meta.dirname, "../..");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const LABEL = "drain-fixture";
const home = mkdtempSync(path.join(tmpdir(), "bs-drain-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** A throwaway HOME whose project-memory.coverage check emits a message far over 64 KiB (many unmapped memory dirs). Never the real home. */
function buildHome(dirs: number): void {
  const repo = path.join(home, "projects", "claude-memory-sync");
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  mkdirSync(path.join(repo, "devices"), { recursive: true });
  mkdirSync(path.join(repo, "projects"), { recursive: true });
  writeFileSync(path.join(repo, "devices", `${LABEL}.json`), JSON.stringify({ device_label: LABEL, platform: "test", mappings: { kept: path.join(home, "elsewhere") } }));
  for (let i = 0; i < dirs; i++) mkdirSync(path.join(home, ".claude", "projects", `-fixture-${String(i).padStart(4, "0")}-${"x".repeat(60)}`, "memory"), { recursive: true });
}

const runPiped = (): Promise<{ stdout: string; code: number | null }> =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, HOME: home, USERPROFILE: home, DEVICE_LABEL: LABEL };
    const child = spawn(TSX, ["src/cli.ts", "doctor", "--json", "--auto"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let stdout = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("bs doctor --json timed out")); }, 90_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, code }); });
  });

describe("bs doctor --json over a pipe", () => {
  it("emits complete JSON when the payload is larger than the 64 KiB pipe buffer", { timeout: 120_000 }, async () => {
    buildHome(900);
    const { stdout, code } = await runPiped();
    expect(() => JSON.parse(stdout), `stdout was cut at ${Buffer.byteLength(stdout)} bytes`).not.toThrow();
    expect(Buffer.byteLength(stdout), "fixture must exceed one pipe buffer to exercise the drain").toBeGreaterThan(65_536);
    const parsed = JSON.parse(stdout) as { status: string; checks: Record<string, Array<{ id: string }>> };
    expect(parsed.checks["project-memory"].some((c) => c.id === "coverage")).toBe(true);
    // exit code unchanged by the fix: a failed check (sync-memory unresolvable here) still exits 1
    expect(code).toBe(parsed.status === "error" ? 1 : 0);
  });
});
