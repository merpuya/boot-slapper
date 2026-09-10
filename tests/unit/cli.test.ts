import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.ts";
import { FakeIo } from "../../src/engine/io.ts";

const sink = () => { const lines: string[] = []; return { lines, write: (l: string) => lines.push(l) }; };

describe("bs cli", () => {
  it("env prints the probe as JSON", async () => {
    const out = sink();
    const code = await main(["env"], { io: new FakeIo({ hostname: "BOX", env: { ANTHROPIC_BASE_URL: "https://gw" } }), stdout: out, stderr: sink() });
    expect(code).toBe(0);
    expect(JSON.parse(out.lines.join("\n"))).toMatchObject({ label: "BOX", detectedProvider: "gateway", os: "darwin" });
  });
  it("doctor --json emits checks per artifact and exits 1 on any error", async () => {
    const out = sink();
    const io = new FakeIo();               // nothing installed → prereqs error
    io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
    const code = await main(["doctor", "--json"], { io, stdout: out, stderr: sink() });
    expect(code).toBe(1);
    const j = JSON.parse(out.lines.join("\n"));
    expect(j.profile).toBe("aca34");
    expect(j.status).toBe("error");
    expect(j.checks.prereqs.find((c: { id: string }) => c.id === "git").status).toBe("error");
  });
  it("plan prints the plan without applying anything", async () => {
    const out = sink();
    const io = new FakeIo();
    io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
    const code = await main(["plan"], { io, stdout: out, stderr: sink() });
    expect(code).toBe(0);
    expect(io.writes).toEqual([]);
    expect(out.lines.join("\n")).toMatch(/prereqs \[device-bound\]: blocked/);
  });
  it("rejects an unknown command with usage on stderr", async () => {
    const err = sink();
    expect(await main(["frobnicate"], { io: new FakeIo(), stdout: sink(), stderr: err })).toBe(2);
    expect(err.lines.join("\n")).toMatch(/usage/i);
  });
  it("secrets check reports the location, exit 1 when missing", async () => {
    const out = sink();
    const io = new FakeIo({ env: { USER: "aca34" } });
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    expect(await main(["secrets", "check", "cornell-ai-gateway"], { io, stdout: out, stderr: sink() })).toBe(1);
    expect(out.lines[0]).toBe("cornell-ai-gateway: missing (login Keychain item service=cornell-ai-gateway account=aca34)");
  });
  it("unknown profile prints usage on stderr and exits 2", async () => {
    const err = sink();
    expect(await main(["plan", "--profile", "nope"], { io: new FakeIo(), stdout: sink(), stderr: err })).toBe(2);
    expect(err.lines[0]).toBe("unknown profile: nope");
    expect(err.lines.join("\n")).toMatch(/usage/i);
  });
  it("secrets set without a terminal exits 2 with a message, never throws", async () => {
    const err = sink();
    const io = new FakeIo({ env: { USER: "aca34" } });
    expect(await main(["secrets", "set", "cornell-ai-gateway"], { io, stdout: sink(), stderr: err, interactive: false })).toBe(2);
    expect(err.lines[0]).toMatch(/interactive terminal/);
    expect(io.calls).toHaveLength(0);
  });
});
