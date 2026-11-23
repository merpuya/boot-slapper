import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// tui-cancel-bounded-exit: after Ctrl+C the CLI ends by letting the loop drain (so a large stdout is not truncated), which
// made its lifetime depend on any descendant still holding the killed child's pipes. A cancelled run must not wait for them.
const ROOT = path.resolve(import.meta.dirname, "../..");
const DRIVER = path.join(ROOT, "tests", "fixtures", "cancel-driver.ts");
const HOLD_SECONDS = 6;
const EXIT_BOUND_MS = 2_500; // driver cancels at ~400 ms; a descendant would hold the process for HOLD_SECONDS

describe("cancellation exit", () => {
  it.skipIf(process.platform === "win32")("exits 130 within the bound even when a descendant of the killed child still holds its pipes", { timeout: 30_000 }, async () => {
    const t0 = Date.now();
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", DRIVER, String(HOLD_SECONDS)], { cwd: ROOT, stdio: "ignore" });
      child.on("error", reject);
      child.on("close", resolve);
    });
    const elapsed = Date.now() - t0;
    expect(code).toBe(130);
    expect(elapsed, `exit took ${elapsed} ms`).toBeLessThan(EXIT_BOUND_MS);
  });
});
