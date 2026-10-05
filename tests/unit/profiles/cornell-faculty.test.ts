import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { main } from "../../../src/cli.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import { wantedServers } from "../../../src/artifacts/desktop-mcp.ts";
import { applyGatewayOverride, placeholderUrls } from "../../../src/engine/gateway-override.ts";
import { selectArtifacts } from "../../../src/engine/plan.ts";
import { cornellFaculty } from "../../../src/profiles/cornell-faculty.ts";

const sink = () => { const lines: string[] = []; return { lines, write: (l: string) => lines.push(l) }; };

describe("cornell-faculty profile (public repo: public values only)", () => {
  it("is a desktop-only gateway profile", () => {
    expect(cornellFaculty.name).toBe("cornell-faculty");
    expect(cornellFaculty.provider).toBe("gateway");
    expect(cornellFaculty.surfaces).toEqual(["desktop"]);
  });
  it("selects the desktop artifacts and none of the owner-specific ones (Q7: no claude-config)", () => {
    const ids = selectArtifacts(cornellFaculty).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["desktop-inference", "desktop-mcp", "desktop-skills", "hosted-connectors"]));
    for (const owner of ["claude-config", "project-memory", "mct", "plugins", "gateway-launch", "open-brain-auth", "device-label"]) expect(ids).not.toContain(owner);
  });
  it("supplies its own desktop-mcp servers (headers-helper secret mapped, no MeCP/Open Brain) and drops the dotclaude dependency for skills", () => {
    const mcp = cornellFaculty.options["desktop-mcp"] as { servers: Record<string, { url: string }>; tokens: Record<string, string> };
    expect(Object.keys(mcp.servers)).toEqual(["cornell_secure_tools"]);
    expect(Object.values(mcp.tokens)).toEqual(["cornell-ai-gateway"]);
    expect(cornellFaculty.options["desktop-skills"]).toMatchObject({ fromClaudeConfig: false });
  });
  it("carries no Cornell-internal value: no real hostname, key, token value or person name", () => {
    const src = readFileSync(new URL("../../../src/profiles/cornell-faculty.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/cornell\.edu/i);
    expect(src).not.toMatch(/sk-[A-Za-z0-9]|eyJ|aca34|kearnsapuya/i);
    const urls = JSON.stringify(cornellFaculty.options).match(/https?:\/\/[^"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(new URL(u).hostname).toMatch(/\.invalid$/);
  });
  it("is registered: bs plan --profile cornell-faculty runs without writing and without claude-config", async () => {
    const out = sink(); const io = new FakeIo();
    io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
    expect(await main(["plan", "--profile", "cornell-faculty"], { io, stdout: out, stderr: sink() })).toBe(0);
    expect(io.writes).toEqual([]);
    expect(out.lines.join("\n")).not.toMatch(/claude-config/);
  });
  it("onboard refuses while the gateway URL is the .invalid placeholder, naming the field to set, and writes nothing", async () => {
    const out = sink(); const err = sink(); const io = new FakeIo();
    io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
    expect(await main(["onboard", "--profile", "cornell-faculty", "--headless", "--auto"], { io, stdout: out, stderr: err })).toBe(2);
    expect(err.lines.join("\n")).toMatch(/placeholder.*gateway\.example\.invalid[\s\S]*--gateway-url[\s\S]*CORNELL_GATEWAY_URL/);
    expect(io.writes).toEqual([]);
    expect(out.lines).toEqual([]);
  });
  describe("run-time gateway override (profile file stays value-free)", () => {
    const run = async (args: string[], env: Record<string, string> = {}, profile = "cornell-faculty") => {
      const out = sink(); const err = sink(); const io = new FakeIo({ env });
      io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
      const code = await main([...args, "--profile", profile, "--headless", "--auto"], { io, stdout: out, stderr: err });
      return { code, out: out.lines.join("\n"), err: err.lines.join("\n"), io };
    };
    it("--gateway-url lifts the onboard guard and reaches the plan (desktop-inference + desktop-mcp)", async () => {
      const r = await run(["onboard", "--gateway-url", "https://gw.test.example"]);
      expect(r.err).not.toMatch(/refusing to onboard/);
      expect(r.out + r.err).not.toMatch(/\.invalid/);
    });
    it("CORNELL_GATEWAY_URL does the same, and the flag beats the env var", async () => {
      expect((await run(["onboard"], { CORNELL_GATEWAY_URL: "https://env.test.example" })).err).not.toMatch(/refusing to onboard/);
      const both = await run(["onboard", "--gateway-url", "http://[bad"], { CORNELL_GATEWAY_URL: "https://env.test.example" });
      expect(both.code).toBe(2);
      expect(both.err).toMatch(/not an http\(s\) URL/);
    });
    it("rewrites every gateway URL in the options, keeping paths, without mutating the profile", () => {
      const p = applyGatewayOverride(cornellFaculty, "https://gw.test.example");
      const urls = JSON.stringify(p.options).match(/https?:\/\/[^"]+/g) ?? [];
      expect(urls).toEqual(expect.arrayContaining(["https://gw.test.example", "https://gw.test.example/mcp/"]));
      expect(placeholderUrls(p)).toEqual([]);
      expect(placeholderUrls(cornellFaculty).length).toBeGreaterThan(0);
    });
    it("guard rejects a trailing-dot .invalid. host", () => {
      const p = applyGatewayOverride(cornellFaculty, "https://gateway.example.invalid.");
      expect(placeholderUrls(p).length).toBeGreaterThan(0);
    });
    it("guard covers a desktop-mcp URL, not just desktop-inference", () => {
      const p = applyGatewayOverride(cornellFaculty, "https://gw.test.example");
      const mcp = p.options["desktop-mcp"] as { servers: Record<string, { url: string }> };
      const bad = { ...p, options: { ...p.options, "desktop-mcp": { ...mcp, servers: { s: { url: "https://x.example.invalid/mcp/" } } } } };
      expect(placeholderUrls(bad)).toEqual(["https://x.example.invalid/mcp/"]);
    });
    it("--help usage lists --profile cornell-faculty", async () => {
      const r = await run(["bogus"]);
      expect(r.err).toMatch(/--profile aca34\|cornell-faculty/);
    });
  });
  it("maps the ${GATEWAY_KEY} placeholder through tokens: the server is wanted, not skipped, and gets a headers helper", () => {
    const mcp = cornellFaculty.options["desktop-mcp"] as { servers: Record<string, never>; tokens: Record<string, string>; baseUrl: string };
    const w = wantedServers({ mcpServers: mcp.servers }, mcp as never, "darwin", "/h");
    expect(w.skipped).toEqual([]);
    expect(w.servers.map((s) => s.name)).toEqual(["cornell_secure_tools"]);
    expect(w.helpers).toHaveLength(1);
    expect(w.helpers[0].body).toContain("cornell-ai-gateway");
  });
});
