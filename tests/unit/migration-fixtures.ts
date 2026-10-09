import { FakeIo } from "../../src/engine/io.ts";

/**
 * Spec section 8 machine fixtures for the Cornell migration assistant. Each builds a recording FakeIo that stands in for one kind of
 * computer. Nothing here touches the real filesystem; every write a test asserts on is a write the fake recorded.
 *
 * The first-party Claude store holds a stdio MCP server whose env carries a secret-shaped value on purpose: the checklist must
 * name the server and never print the value.
 */
export const SECRET_LOOKING = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX";
export const FIRST_PARTY_MAC = "/h/Library/Application Support/Claude";
export const FIRST_PARTY_WIN = "C:\\Users\\t\\AppData\\Roaming\\Claude";
export const THIRD_PARTY_MAC = "/h/Library/Application Support/Claude-3p";

const ORG = "11111111-2222-4333-8444-555555555555";
const ACCT = "66666666-7777-4888-8999-000000000000";
const PLIST_INFO = "<plist><dict><key>CFBundleShortVersionString</key><string>2.7032.0</string></dict></plist>";
const DESKTOP_CONFIG = JSON.stringify({ mcpServers: { zotero: { command: "npx", args: ["-y", "zotero-mcp"], env: { API_TOKEN: SECRET_LOOKING } }, filesystem: { command: "npx", args: ["-y", "fs-mcp"] } } });
const MANAGED_PLIST = "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist";
const WIN_REG_ABSENT = { code: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value." };

export interface Fixture { name: string; io: FakeIo; firstParty: string; thirdParty: string }

function macBase(extra: { files?: Record<string, string>; dirs?: string[]; env?: Record<string, string> } = {}): FakeIo {
  const fp = FIRST_PARTY_MAC;
  const io = new FakeIo({
    platform: "darwin", home: "/h", env: { USER: "t", ...extra.env },
    dirs: ["/Applications/Claude.app", ...(extra.dirs ?? [])],
    files: {
      "/Applications/Claude.app/Contents/Info.plist": PLIST_INFO,
      [`${fp}/claude_desktop_config.json`]: DESKTOP_CONFIG,
      [`${fp}/local-agent-mode-sessions/skills-plugin/${ORG}/${ACCT}/manifest.json`]: "{}",
      [`${fp}/local-agent-mode-sessions/skills-plugin/${ORG}/${ACCT}/skills/lit-review/SKILL.md`]: "# lit review",
      [`${fp}/local-agent-mode-sessions/skills-plugin/${ORG}/${ACCT}/skills/grant-notes/SKILL.md`]: "# grant notes",
      "/h/Documents/Claude/.claude/skills/old-helper/SKILL.md": "# old helper",
      "/h/.claude.json": JSON.stringify({ oauthAccount: { emailAddress: "someone@example.test" } }),
      ...extra.files,
    },
  });
  io.on((c) => c === "pgrep", () => ({ code: 1, stdout: "", stderr: "" }));
  return io;
}

export const personalMacSignedIn = (): Fixture => ({ name: "personal-mac-signed-in", io: macBase(), firstParty: FIRST_PARTY_MAC, thirdParty: THIRD_PARTY_MAC });

export const personalMac3pAlready = (): Fixture => ({
  name: "personal-mac-3p-already",
  io: macBase({ files: { [`${THIRD_PARTY_MAC}/configLibrary/_meta.json`]: JSON.stringify({ appliedId: "e1", entries: [{ id: "e1", name: "boot-slapper" }] }), [`${THIRD_PARTY_MAC}/configLibrary/e1.json`]: "{}" } }),
  firstParty: FIRST_PARTY_MAC, thirdParty: THIRD_PARTY_MAC,
});

const winBase = (hklmOut?: string): Fixture => {
  const home = "C:\\Users\\t", roaming = `${home}\\AppData\\Roaming`;
  const sk = `${FIRST_PARTY_WIN}\\local-agent-mode-sessions\\skills-plugin\\${ORG}\\${ACCT}`;
  const io = new FakeIo({
    platform: "win32", home, env: { APPDATA: roaming, LOCALAPPDATA: `${home}\\AppData\\Local`, USER: "t" },
    files: {
      [`${FIRST_PARTY_WIN}\\claude_desktop_config.json`]: DESKTOP_CONFIG,
      [`${sk}\\manifest.json`]: "{}",
      [`${sk}\\skills\\lit-review\\SKILL.md`]: "# lit review",
      [`${home}\\Claude\\.claude\\skills\\old-helper\\SKILL.md`]: "# old helper",
    },
  });
  io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "Claude_pzs8sxrjxfjjc\t2.2553.0.0\r\n", stderr: "" }));
  // Handlers match first-registered-first, so the HKLM answer must be registered before the catch-all "absent".
  if (hklmOut) io.on((c, a) => c === "reg" && a[1]?.startsWith("HKLM"), () => ({ code: 0, stdout: hklmOut, stderr: "" }));
  io.on((c) => c === "reg", () => WIN_REG_ABSENT);
  io.on((c) => c === "tasklist", () => ({ code: 0, stdout: "INFO: No tasks are running which match the specified criteria.\r\n", stderr: "" }));
  return { name: "personal-win-signed-in", io, firstParty: FIRST_PARTY_WIN, thirdParty: `${home}\\AppData\\Local\\Claude-3p` };
};
export const personalWinSignedIn = (): Fixture => winBase();

/** The S3 key set: HKLM\SOFTWARE\Policies\Claude carrying 16 values, none of them app-behaviour keys. */
const S3_KEYS = ["inferenceProvider", "inferenceGatewayBaseUrl", "inferenceGatewayApiKey", "inferenceModels", "managedMcpServers", "disableDeploymentModeChooser", "isClaudeCodeForDesktopEnabled", "isLocalDevMcpEnabled", "isDesktopExtensionEnabled", "isDesktopExtensionDirectoryEnabled", "isDesktopExtensionSignatureRequired", "secureVmFeaturesEnabled", "coworkEgressAllowedHosts", "otlpEndpoint", "otlpProtocol", "deploymentOrganizationUuid"];

export const managedWinHklm = (): Fixture => {
  const out = ["", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Claude", ...S3_KEYS.map((k) => `    ${k}    REG_SZ    x`), ""].join("\r\n");
  return { ...winBase(out), name: "managed-win-hklm" };
};

export const managedMacProfile = (): Fixture => {
  const io = macBase({ files: { [MANAGED_PLIST]: "bplist" } });
  io.on((c) => c === "plutil", () => ({ code: 0, stdout: JSON.stringify({ inferenceProvider: "gateway", inferenceGatewayBaseUrl: "https://gw.managed.example", disableAutoUpdates: true }), stderr: "" }));
  return { name: "managed-mac-profile", io, firstParty: FIRST_PARTY_MAC, thirdParty: THIRD_PARTY_MAC };
};

/** A managed-preferences file exists but plutil cannot read it: absence of evidence, which must never read as clean. */
export const policyUnreadable = (): Fixture => {
  const io = macBase({ files: { [MANAGED_PLIST]: "bplist" } });
  io.on((c) => c === "plutil", () => ({ code: 1, stdout: "", stderr: "Property List error: unexpected character" }));
  return { name: "policy-unreadable", io, firstParty: FIRST_PARTY_MAC, thirdParty: THIRD_PARTY_MAC };
};

export const ALL_FIXTURES = { personalMacSignedIn, personalWinSignedIn, personalMac3pAlready, managedWinHklm, managedMacProfile, policyUnreadable };
