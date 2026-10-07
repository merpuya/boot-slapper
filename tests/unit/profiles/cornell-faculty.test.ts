import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { main } from "../../../src/cli.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import { wantedServers } from "../../../src/artifacts/desktop-mcp.ts";
import { applyGatewayOverride, placeholderUrls } from "../../../src/engine/gateway-override.ts";
import { selectArtifacts } from "../../../src/engine/plan.ts";
import { aca34 } from "../../../src/profiles/aca34.ts";
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
    it("refuses a path-bearing, query-bearing or credentialed override (origin only, N19)", () => {
      for (const bad of ["https://gw.test.example/v1", "https://gw.test.example/mcp/", "https://gw.test.example?x=1", "https://gw.test.example/#f", "https://u:p@gw.test.example"]) {
        expect(() => applyGatewayOverride(cornellFaculty, bad), bad).toThrow(/origin only/);
      }
      expect(() => applyGatewayOverride(cornellFaculty, "https://gw.test.example/")).not.toThrow();
      expect(() => applyGatewayOverride(cornellFaculty, "https://gw.test.example:8443")).not.toThrow();
    });
    it("refuses a plain http: override (N19)", async () => {
      expect(() => applyGatewayOverride(cornellFaculty, "http://gw.test.example")).toThrow(/https/);
      const r = await run(["onboard", "--gateway-url", "http://gw.test.example"]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/https/);
      const p = await run(["onboard", "--gateway-url", "https://gw.test.example/v1"]);
      expect(p.code).toBe(2);
      expect(p.err).toMatch(/origin only/);
    });
    it("placeholder guard catches wss:// and bare .invalid hosts, not just http(s) URLs", () => {
      const mcp = cornellFaculty.options["desktop-mcp"] as { servers: Record<string, unknown> };
      const mk = (extra: unknown) => ({ ...cornellFaculty, options: { ...cornellFaculty.options, "desktop-mcp": { ...mcp, servers: { ...mcp.servers, x: extra } } } });
      expect(placeholderUrls(mk({ url: "wss://x.example.invalid/ws" }))).toContain("wss://x.example.invalid/ws");
      expect(placeholderUrls(mk({ host: "gateway.invalid" }))).toContain("gateway.invalid");
      expect(placeholderUrls(mk({ host: "gateway.invalid.:8443" }))).toContain("gateway.invalid.:8443");
      expect(placeholderUrls(mk({ host: "//gw.invalid/" }))).toContain("//gw.invalid/");
      expect(placeholderUrls(mk({ host: "gw.invalid?x" }))).toContain("gw.invalid?x");
      expect(placeholderUrls(mk({ host: "gw.invalid#f" }))).toContain("gw.invalid#f");
      expect(placeholderUrls(mk({ host: "x.invalid.example" }))).not.toContain("x.invalid.example");
      expect(placeholderUrls(mk({ url: "wss://real.test.example/ws" })).filter((u) => u.startsWith("wss"))).toEqual([]);
      // a rewritten profile that still carries a wss placeholder stays refused
      const p = applyGatewayOverride(mk({ url: "wss://x.example.invalid/ws" }) as typeof cornellFaculty, "https://gw.test.example");
      expect(placeholderUrls(p)).toEqual(["wss://x.example.invalid/ws"]);
    });
    describe("exotic placeholder spellings (N9 = B: flag the cheap two, accept the other three)", () => {
      const mcp = cornellFaculty.options["desktop-mcp"] as { servers: Record<string, unknown> };
      const mk = (s: string) => ({ ...cornellFaculty, options: { ...cornellFaculty.options, "desktop-mcp": { ...mcp, servers: { ...mcp.servers, x: { s } } } } });
      const flagged = (s: string) => placeholderUrls(mk(s)).includes(s);
      it("flags a double (or longer) trailing dot, in a URL and as a bare host", () => {
        for (const s of ["https://gw.invalid../", "wss://gw.example.invalid../ws", "gw.invalid..", "gw.example.invalid..:8443", "//gw.invalid.../mcp/"]) expect(flagged(s), s).toBe(true);
      });
      it("flags a whitespace-padded bare host or URL", () => {
        for (const s of [" gw.invalid", "gw.invalid ", "\tgw.example.invalid\n", "  gw.invalid.:8443  ", " https://gw.invalid/ "]) expect(flagged(s), JSON.stringify(s)).toBe(true);
      });
      it("still leaves look-alikes alone", () => {
        for (const s of ["x.invalid.example", " x.invalid.example ", "https://x.invalid..example/", "gw.invalidx..", "real.test.example.."]) expect(flagged(s), s).toBe(false);
      });
      it("accepted, not flagged: bare triple-slash, bare backslash, trailing semicolon and bare userinfo (author-controlled; no consumer parses them as a gateway URL)", () => {
        // scheme'd forms already resolve to the .invalid host through WHATWG URL parsing and are flagged
        for (const s of ["https:///gw.invalid/", "https:\\\\gw.invalid\\mcp", "https://u:p@gw.invalid/"]) expect(flagged(s), s).toBe(true);
        // the residue is accepted (see the note above isPlaceholder); flip these if the guard ever learns them
        for (const s of ["///gw.invalid/", "\\\\gw.invalid", "gw.invalid;", "https://gw.invalid;/", "user@gw.invalid"]) expect(flagged(s), s).toBe(false);
      });
    });
    it("a malformed override exits 2 for every command, secrets set included (applied before the command switch)", async () => {
      const bad = { CORNELL_GATEWAY_URL: "http://gw.test.example" };
      for (const args of [["env"], ["plan"], ["doctor", "--json"], ["onboard"], ["capture", "--out", "/tmp/qp-never"], ["secrets", "set", "cornell-ai-gateway"], ["secrets", "check", "cornell-ai-gateway"]]) {
        for (const profile of ["aca34", "cornell-faculty"]) {
          const r = await run(args, bad, profile);
          expect(r.code, `${args.join(" ")} --profile ${profile}`).toBe(2);
          expect(r.err).toMatch(/must use https/);
          expect(r.io.writes).toEqual([]);
        }
      }
    });
    it("does not rewrite a profile whose gateway URLs are already real (aca34 + override is a no-op)", async () => {
      const before = JSON.stringify(aca34.options);
      expect(before).toContain("api.ai.it.cornell.edu");
      const p = applyGatewayOverride(aca34, "https://evil.test.example");
      expect(p).toBe(aca34);
      expect(JSON.stringify(p.options)).not.toContain("evil.test.example");
      // an invalid override is still rejected, even for a real-URL profile
      expect(() => applyGatewayOverride(aca34, "http://[bad")).toThrow(/not an http\(s\) URL/);
      // and the cli path (flag and env) accepts the call without changing aca34
      const r = await run(["plan", "--gateway-url", "https://evil.test.example"], { CORNELL_GATEWAY_URL: "https://evil.test.example" }, "aca34");
      expect(r.code).toBe(0);
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
