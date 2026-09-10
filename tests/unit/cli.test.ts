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
  it("capture --out writes the bundle (files, instructions.md, manifest.json last) and refuses to overwrite a bundle", async () => {
    const out = sink();
    const io = new FakeIo({ env: { USER: "aca34" }, dirs: ["/h/.claude"], files: { "/h/.claude/CLAUDE.md": "rules\n", "/h/.claude/plugins/known_marketplaces.json": "{}", "/h/.claude/plugins/installed_plugins.json": '{"version":2,"plugins":{}}' } });
    io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
    io.on((c, a) => c === "git" && a.includes("ls-files"), () => ({ code: 0, stdout: "CLAUDE.md\0", stderr: "" }));
    io.on(() => true, () => ({ code: 1, stdout: "", stderr: "" }));
    expect(await main(["capture", "--out", "/tmp/b"], { io, stdout: out, stderr: sink() })).toBe(0);
    expect(io.writes).toEqual(["/tmp/b/claude-config/CLAUDE.md", "/tmp/b/plugins.json", "/tmp/b/instructions.md", "/tmp/b/manifest.json"]);
    const m = JSON.parse(io.files.get("/tmp/b/manifest.json")!);
    expect(m.schema).toBe(1);
    expect(m.artifacts.map((a: { id: string }) => a.id)).toEqual(["prereqs", "claude-config", "secrets", "project-memory", "plugins", "mct"]);   // DAG order; gateway-launch has no capture
    expect(io.files.get("/tmp/b/instructions.md")).toMatch(/## secrets \(device-bound\)/);
    expect(out.lines.at(-1)).toBe("==> bundle written: /tmp/b (2 file(s), 6 artifact(s))");
    const err = sink();
    expect(await main(["capture", "--out", "/tmp/b"], { io, stdout: sink(), stderr: err })).toBe(1);
    expect(err.lines[0]).toMatch(/already holds a bundle/);
    expect(await main(["capture"], { io, stdout: sink(), stderr: sink() })).toBe(2);
  });
  it("capture refuses the whole bundle on a secret-shaped string and writes nothing", async () => {
    const io = new FakeIo({ env: { USER: "aca34" }, dirs: ["/h/.claude"], files: { "/h/.claude/notes.md": "token sk-ant-abcdefghijklmnopqrstuv\n" } });
    io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
    io.on((c, a) => c === "git" && a.includes("ls-files"), () => ({ code: 0, stdout: "notes.md\0", stderr: "" }));
    io.on(() => true, () => ({ code: 1, stdout: "", stderr: "" }));
    const err = sink();
    expect(await main(["capture", "--out", "/tmp/c"], { io, stdout: sink(), stderr: err })).toBe(1);
    expect(err.lines[0]).toBe("refusing to write the bundle: 1 secret-shaped string(s) — claude-config/notes.md:1 (anthropic-key)");
    expect(io.writes).toEqual([]);
  });
  it("onboard picks the TUI when asked and the run log still lands; --headless forces line output", async () => {
    const { FakeStdin, FakeStdout, waitFor } = await import("./ui/streams.ts");
    const io = new FakeIo(); io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));      // prereqs blocked → nothing to confirm-apply, but the plan renders
    const stdout = new FakeStdout(); const stdin = new FakeStdin(); const lines = sink();
    const run = main(["onboard"], { io, stdout: lines, stderr: sink(), interactive: true, tui: true, streams: { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream }, debug: true });
    await waitFor(() => stdout.lastFrame().includes("Apply this plan? [y/N]"));
    expect(stdout.lastFrame()).toContain("prereqs [device-bound]: blocked");
    stdin.write("n"); stdin.write("\r");
    expect(await run).toBe(3);
    expect(lines.lines.at(-1)).toMatch(/^==> run log: \/h\/\.config\/boot-slapper\/runs\//);
    const out2 = sink();
    expect(await main(["onboard", "--headless", "--auto"], { io, stdout: out2, stderr: sink() })).toBe(1);   // --auto implies headless; blocked prereqs → exit 1
    expect(out2.lines[0]).toMatch(/^==> boot-slapper onboard — profile aca34/);
  });
});
