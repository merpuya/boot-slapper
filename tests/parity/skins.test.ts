import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.ts";
import { FakeIo } from "../../src/engine/io.ts";
import { renderHooks } from "../../src/engine/settings.ts";
import { aca34 } from "../../src/profiles/aca34.ts";
import { FakeStdin, FakeStdout, waitFor } from "../unit/ui/streams.ts";

const template = JSON.parse(readFileSync("tests/fixtures/settings.template.sample.json", "utf8"));
const canonical = JSON.parse(readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8"));
const REPO = "/h/projects/claude-memory-sync"; const MCT = "/h/projects/me-count-token"; const P = "/h/.claude/plugins";
const pluginOpts = aca34.options.plugins as { marketplaces: Array<{ name: string; source: string }>; plugins: string[] };

/** Every aca34 artifact satisfied except gateway-launch (wrapper + rc line absent): one identical thing for each skin to apply. */
function box(): FakeIo {
  const settings = { ...template, hooks: renderHooks(canonical.hooks, { platform: "darwin" }), enabledPlugins: Object.fromEntries(pluginOpts.plugins.map((p) => [p, true])) };
  const io = new FakeIo({
    hostname: "BOX", env: { USER: "aca34" },
    path: { git: "/usr/bin/git", curl: "/usr/bin/curl", jq: "/opt/jq", python3: "/usr/bin/python3", node: "/usr/local/bin/node", npm: "/usr/local/bin/npm", claude: "/h/.local/bin/claude" },
    dirs: ["/h/.claude", `${REPO}/.git`, `${REPO}/projects/mecp`, MCT],
    files: {
      "/h/.claude/scripts/settings.template.json": JSON.stringify(template), "/h/.claude/scripts/canonical-hooks.json": JSON.stringify(canonical),
      "/h/.claude/settings.json": JSON.stringify(settings, null, 2) + "\n",
      "/h/.claude/mcp/gateway.json": JSON.stringify({ mcpServers: { mecp: { type: "http", url: "https://mecp/mcp" }, openbrain: { type: "http", url: "https://ob/mcp" } } }),
      "/h/.zshrc": "# rc\n", "/h/.config/mecp/api_key": "k\n",
      "/h/.claude/scripts/memory-auto-sync.mjs": "", "/h/.claude/scripts/load-mecp-context.mjs": "",
      [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: {} }) + "\n",
      [`${MCT}/dist/hooks/session-start.js`]: "", "/h/.mct/config.json": JSON.stringify({ deviceId: "box" }),
      [`${P}/known_marketplaces.json`]: JSON.stringify(Object.fromEntries(pluginOpts.marketplaces.map((m) => [m.name, { source: { source: "github", repo: m.source } }]))),
      [`${P}/installed_plugins.json`]: JSON.stringify({ version: 2, plugins: Object.fromEntries(pluginOpts.plugins.map((p) => [p, [{ scope: "user", version: "1.0.0" }]])) }),
    },
  });
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "successfully authenticated" }));
  io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("ls-remote"), () => ({ code: 0, stdout: "abc\trefs/heads/main\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("rev-parse"), () => ({ code: 0, stdout: "abc\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("status"), () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
  io.on((c, a) => c === "node" && a[0] === "--version", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "doctor", () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "bash", () => ({ code: 0, stdout: "", stderr: "" }));
  return io;
}
const sink = () => { const lines: string[] = []; return { lines, write: (l: string) => lines.push(l) }; };
const doctor = async (io: FakeIo) => { const out = sink(); const code = await main(["doctor", "--json"], { io, stdout: out, stderr: sink() }); return { code, json: JSON.parse(out.lines.join("\n")) }; };
const filesOf = (io: FakeIo) => Object.fromEntries([...io.files].filter(([k]) => !k.startsWith("/h/.config/boot-slapper/runs/")));

describe("skins parity: the Ink TUI and the headless runner leave the box in the same state", () => {
  it("onboard through both skins, then doctor --json agrees and the written files are identical", { timeout: 30_000 }, async () => {
    const headless = box();
    expect(await main(["onboard", "--auto"], { io: headless, stdout: sink(), stderr: sink() })).toBe(0);

    const tui = box(); const stdout = new FakeStdout(); const stdin = new FakeStdin();
    const run = main(["onboard"], { io: tui, stdout: sink(), stderr: sink(), interactive: true, tui: true, streams: { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream }, debug: true });
    await waitFor(() => stdout.lastFrame().includes("Apply this plan? [y/N]"), 15_000);
    expect(stdout.lastFrame()).toContain("gateway-launch [translatable]: absent");
    stdin.write("y"); stdin.write("\r");
    expect(await run).toBe(0);

    const a = await doctor(headless), b = await doctor(tui);
    expect(a.code).toBe(0);
    expect(b.json.checks).toEqual(a.json.checks);
    expect(filesOf(tui)).toEqual(filesOf(headless));
    expect(Object.keys(filesOf(headless))).toEqual(expect.arrayContaining(["/h/.config/boot-slapper/claude-gw.zsh"]));
  });
});
