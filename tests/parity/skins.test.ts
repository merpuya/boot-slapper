import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.ts";
import { wantedDoc } from "../../src/artifacts/desktop-inference.ts";
import { sourceHash } from "../../src/artifacts/desktop-skills.ts";
import { renderCredentialHelper, renderHeadersHelper } from "../../src/artifacts/templates/desktop-helpers.ts";
import { ENTRY_NAME } from "../../src/engine/desktop.ts";
import { FakeIo } from "../../src/engine/io.ts";
import { renderHooks } from "../../src/engine/settings.ts";
import { aca34 } from "../../src/profiles/aca34.ts";
import { FakeStdin, FakeStdout, waitFor } from "../unit/ui/streams.ts";

const template = JSON.parse(readFileSync("tests/fixtures/settings.template.sample.json", "utf8"));
const canonical = JSON.parse(readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8"));
const REPO = "/h/projects/claude-memory-sync"; const MCT = "/h/projects/me-count-token"; const P = "/h/.claude/plugins";
const pluginOpts = aca34.options.plugins as { marketplaces: Array<{ name: string; source: string }>; plugins: string[] };
const APP = "/Applications/Claude.app"; const DATA = "/h/Library/Application Support/Claude-3p"; const LIB = `${DATA}/configLibrary`;
const EID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; const ACCT = "831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f";
const PLUGIN = `${DATA}/local-agent-mode-sessions/skills-plugin/00000000-0000-4000-8000-000000000001/${ACCT}`;
const INF = "/h/.config/boot-slapper/desktop-inference-credential.sh"; const MECP_HELPER = "/h/.config/boot-slapper/desktop-mcp-mecp-headers.sh";
const SKILL = "---\nname: mecp-conventions\ndescription: guard-rails\n---\n";
// same order as the bundle's mcpServers keys (mecp, then openbrain) — desktop-mcp compares the arrays with deepEqual
const servers = [{ name: "mecp", transport: "http", url: "https://mecp/mcp", headersHelper: MECP_HELPER, headersHelperTtlSec: 3600 }, { name: "openbrain", transport: "http", url: "https://ob/mcp", oauth: true }];

/** Every aca34 artifact satisfied except gateway-launch (wrapper + rc line absent): one identical thing for each skin to apply. */
function box(): FakeIo {
  const settings = { ...template, hooks: renderHooks(canonical.hooks, { platform: "darwin" }), enabledPlugins: Object.fromEntries(pluginOpts.plugins.map((p) => [p, true])) };
  const io = new FakeIo({
    hostname: "BOX", env: { USER: "aca34" },
    path: { git: "/usr/bin/git", curl: "/usr/bin/curl", jq: "/opt/jq", python3: "/usr/bin/python3", node: "/usr/local/bin/node", npm: "/usr/local/bin/npm", claude: "/h/.local/bin/claude" },
    dirs: ["/h/.claude", `${REPO}/.git`, `${REPO}/projects/mecp`, MCT, APP, `${PLUGIN}/skills/mecp-conventions`],
    files: {
      "/h/.claude/scripts/settings.template.json": JSON.stringify(template), "/h/.claude/scripts/canonical-hooks.json": JSON.stringify(canonical),
      "/h/.claude/settings.json": JSON.stringify(settings, null, 2) + "\n",
      "/h/.claude/mcp/gateway.json": JSON.stringify({ mcpServers: { mecp: { type: "http", url: "https://mecp/mcp", headers: { Authorization: "Bearer ${MECP_DEVICE_TOKEN}" } }, openbrain: { type: "http", url: "https://ob/mcp" } } }),
      "/h/.zshrc": "# rc\n", "/h/.config/mecp/api_key": "k\n",
      "/h/.claude/scripts/memory-auto-sync.mjs": "", "/h/.claude/scripts/load-mecp-context.mjs": "",
      [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: {} }) + "\n",
      [`${MCT}/dist/hooks/session-start.js`]: "", "/h/.mct/config.json": JSON.stringify({ deviceId: "box" }),
      [`${P}/known_marketplaces.json`]: JSON.stringify(Object.fromEntries(pluginOpts.marketplaces.map((m) => [m.name, { source: { source: "github", repo: m.source } }]))),
      [`${P}/installed_plugins.json`]: JSON.stringify({ version: 2, plugins: Object.fromEntries(pluginOpts.plugins.map((p) => [p, [{ scope: "user", version: "1.0.0" }]])) }),
      [`${APP}/Contents/Info.plist`]: "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>",
      [`${DATA}/ant-did`]: Buffer.from(ACCT).toString("base64"),
      [`${DATA}/config.json`]: JSON.stringify({ custom3pMcpOAuth: { openbrain: "BLOB==" } }),
      [`${LIB}/_meta.json`]: JSON.stringify({ appliedId: EID, entries: [{ id: EID, name: ENTRY_NAME }] }),
      [`${LIB}/${EID}.json`]: JSON.stringify({ ...wantedDoc({ baseUrl: "https://api.ai.it.cornell.edu" }, INF), mcp: { managedServers: servers } }),
      [INF]: renderCredentialHelper("darwin", "cornell-ai-gateway", "aca34"), [MECP_HELPER]: renderHeadersHelper("darwin", "mecp-device-token", "Authorization", "Bearer ", "aca34"),
      "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: EID, servers: ["openbrain", "mecp"], skills: { "mecp-conventions": sourceHash([{ rel: "SKILL.md", content: SKILL }]) } }),
      "/h/.claude/skills/mecp-conventions/SKILL.md": SKILL, [`${PLUGIN}/skills/mecp-conventions/SKILL.md`]: SKILL,
      [`${PLUGIN}/manifest.json`]: JSON.stringify({ lastUpdated: 1, skills: [{ skillId: "mecp-conventions", name: "mecp-conventions", description: "guard-rails", creatorType: "user", syncManaged: false, updatedAt: "2026-09-10T00:00:00.000Z", enabled: true }] }),
    },
  });
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "successfully authenticated" }));
  io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("ls-remote"), () => ({ code: 0, stdout: "abc\trefs/heads/main\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("rev-parse"), () => ({ code: 0, stdout: "abc\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("status"), () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c, a) => c === "security" && a.includes("Claude Code-credentials"), () => ({ code: 0, stdout: JSON.stringify({ mcpOAuth: { "openbrain|h": {} } }) + "\n", stderr: "" }));
  io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
  io.on((c, a) => c === "node" && a[0] === "--version", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "doctor", () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "bash", () => ({ code: 0, stdout: "", stderr: "" }));
  io.onFetch((u) => u.endsWith("/v1/models"), () => ({ status: 200, body: JSON.stringify({ data: [{ id: "claude-sonnet-5" }] }) }));
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
    expect(a.json.checks["desktop-inference"].map((c: { status: string }) => c.status)).not.toContain("error");
    expect(a.json.checks["desktop-mcp"].map((c: { status: string }) => c.status)).not.toContain("error");
    expect(a.json.checks["desktop-skills"].map((c: { status: string }) => c.status)).not.toContain("error");
  });
});
