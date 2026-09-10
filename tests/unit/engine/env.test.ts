import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import { desktopAppPath, probeEnv, resolveEnv } from "../../../src/engine/env.ts";

describe("probeEnv", () => {
  it("resolves the device label in the documented order", async () => {
    const a = new FakeIo({ env: { DEVICE_LABEL: "FROM-ENV" }, files: {
      "/h/.claude/settings.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-SETTINGS" } }),
    } });
    expect((await probeEnv(a)).label).toBe("FROM-ENV");

    const b = new FakeIo({ files: {
      "/h/.claude/settings.local.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-LOCAL" } }),
      "/h/.claude/settings.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-SETTINGS" } }),
    } });
    expect((await probeEnv(b)).label).toBe("FROM-LOCAL");

    const c = new FakeIo({ files: { "/h/.claude/settings.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-SETTINGS" } }) } });
    expect((await probeEnv(c)).label).toBe("FROM-SETTINGS");

    const d = new FakeIo({ hostname: "HOSTBOX" });
    expect((await probeEnv(d)).label).toBe("HOSTBOX");
  });

  it("detects the provider from the process env, then ~/.claude.json", async () => {
    expect((await probeEnv(new FakeIo({ env: { ANTHROPIC_BASE_URL: "https://gw" } }))).detectedProvider).toBe("gateway");
    expect((await probeEnv(new FakeIo({ env: { CLAUDE_CODE_USE_BEDROCK: "1" } }))).detectedProvider).toBe("bedrock");
    expect((await probeEnv(new FakeIo({ env: { CLAUDE_CODE_USE_VERTEX: "1" } }))).detectedProvider).toBe("vertex");
    expect((await probeEnv(new FakeIo({ env: { ANTHROPIC_API_KEY: "sk" } }))).detectedProvider).toBe("api-key");
    expect((await probeEnv(new FakeIo({ files: { "/h/.claude.json": JSON.stringify({ oauthAccount: { emailAddress: "x" } }) } }))).detectedProvider).toBe("subscription");
    expect((await probeEnv(new FakeIo())).detectedProvider).toBeNull();
  });

  it("reports claude on PATH and the Desktop app per OS", async () => {
    const mac = new FakeIo({ platform: "darwin", path: { claude: "/h/.local/bin/claude" }, dirs: ["/Applications/Claude.app"] });
    const p = await probeEnv(mac);
    expect(p.claudeOnPath).toBe(true);
    expect(p.desktopInstalled).toBe(true);
    expect(desktopAppPath("win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Local\\AnthropicClaude\\claude.exe");
  });
});

describe("resolveEnv", () => {
  it("takes provider and surface from the profile, the rest from the probe", async () => {
    const probe = await probeEnv(new FakeIo({ hostname: "BOX" }));
    const env = resolveEnv(probe, "gateway", "code");
    expect(env).toEqual({ provider: "gateway", surface: "code", os: "darwin", home: "/h", label: "BOX", claudeDir: "/h/.claude" });
  });
});
