import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import type { Profile } from "../../../src/engine/profile.ts";
import { runTui } from "../../../src/ui/tui/index.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./streams.ts";

function fixture() {
  const applied: string[] = []; let answer = "";
  const a: Artifact = { id: "a", requires: [], surfaces: ["code"], portability: "portable", detect: async () => ({ kind: "present" }), plan: () => [], apply: async () => {}, verify: async () => [{ id: "a.ok", status: "ok", message: "a fine" }] };
  const b: Artifact = {
    id: "b", requires: ["a"], surfaces: ["code"], portability: "device-bound",
    detect: async () => ({ kind: "absent", details: ["needs a key"] }),
    plan: () => [{ id: "b.ask", title: "paste the key", interactive: true }, { id: "b.do", title: "write the wrapper" }],
    apply: async (c, steps) => { for (const s of steps) { if (s.id === "b.ask") answer = await c.prompt.secret("Paste the key"); applied.push(s.id); } },
    verify: async () => [{ id: "b.warn", status: "warn", message: "b so-so" }],
  };
  const profile: Profile = { name: "t", provider: "gateway", surfaces: ["code"], artifacts: [a, b], options: {} };
  return { profile, applied, answer: () => answer };
}
const start = (mode: "onboard" | "doctor", profile: Profile) => {
  const stdout = new FakeStdout(); const stdin = new FakeStdin();
  const done = runTui({ mode, profile, io: new FakeIo(), streams: { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream }, debug: true });
  return { stdout, stdin, done };
};

describe("Ink TUI", () => {
  it("onboard: plan → y → masked secret prompt → steps tick → checks; the secret never appears in a frame", async () => {
    const f = fixture(); const { stdout, stdin, done } = start("onboard", f.profile);
    await waitFor(() => stdout.lastFrame().includes("Apply this plan? [y/N]"));
    expect(stdout.lastFrame()).toContain("b [device-bound]: absent — needs a key");
    expect(stdout.lastFrame()).toContain("· paste the key (interactive)");
    stdin.write("y"); stdin.write("\r");
    await waitFor(() => stdout.lastFrame().includes("? Paste the key (blank to skip):"));
    stdin.write("s3cr3t");
    await waitFor(() => stdout.lastFrame().includes("••••••"));
    stdin.write("\r");
    expect(await done).toBe(0);
    expect(f.answer()).toBe("s3cr3t");
    expect(f.applied).toEqual(["b.ask", "b.do"]);
    const last = stdout.lastFrame();
    expect(last).toContain("✓ paste the key");
    expect(last).toContain("✓ write the wrapper");
    expect(last).toContain("! b so-so");
    expect(last).toContain("Doctor: all checks passed (1 warning(s))");
    expect(stdout.all()).not.toContain("s3cr3t");
  });
  it("onboard: n aborts with exit 3 and applies nothing", async () => {
    const f = fixture(); const { stdout, stdin, done } = start("onboard", f.profile);
    await waitFor(() => stdout.lastFrame().includes("Apply this plan?"));
    stdin.write("n"); stdin.write("\r");
    expect(await done).toBe(3);
    expect(f.applied).toEqual([]);
    expect(stdout.lastFrame()).toContain("aborted");
  });
  it("doctor: renders every check grouped by artifact and exits 1 on an error", async () => {
    const f = fixture();
    f.profile.artifacts[0].verify = async () => [{ id: "a.bad", status: "error", message: "a broken" }];
    const { stdout, done } = start("doctor", f.profile);
    expect(await done).toBe(1);
    expect(stdout.lastFrame()).toContain("✗ a broken");
    expect(stdout.lastFrame()).toContain("! b so-so");
    expect(stdout.lastFrame()).toContain("Doctor: 1 check(s) FAILED");
  });
});
