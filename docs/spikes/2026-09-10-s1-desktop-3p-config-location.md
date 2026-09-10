# S1 — Where Claude Desktop reads its third-party (3P) inference configuration

**Spec question (design §4, "Spikes required before artifacts 8 and 9"):** does Claude Desktop honor the
inference keys written as user defaults (`defaults write com.anthropic.claudefordesktop …` on macOS,
`HKCU\SOFTWARE\Policies\Claude` on Windows), or only Managed Preferences / HKLM? If managed-only,
`desktop-inference` degrades to "open the *Configure third-party inference* pane, print the values, wait for done".

**Date / box:** 2026-09-10, JCB-AL-ACA34 (macOS, Cornell-managed), Claude Desktop **1.49585.0**
(`/Applications/Claude.app`, bundle id `com.anthropic.claudefordesktop`, installed 2026-09-08).

**Method (read-only):**

1. String and context extraction from `Claude.app/Contents/Resources/app.asar` (43 MB; JS is stored uncompressed).
   Byte offsets below are into that file for this build.
2. Directory listings of `/Library/Managed Preferences/` and `~/Library/Application Support/Claude-3p/`
   (names, sizes, modes; no config values read).
3. Anthropic's Claude Desktop on 3P docs (`https://claude.com/docs/third-party/claude-desktop/*`, fetched
   2026-09-10) and the published machine-readable schemas
   `…/schemas/bootstrap-config-v1.schema.json` (flat, 110 keys) and `…/bootstrap-config-v2.schema.json` (nested).

Nothing was written: no `defaults write`, no registry, no Desktop config or library file touched.

## Answer

**User defaults are not read. The per-user, no-admin location is a file: the *config library* under the
`Claude-3p` data directory.** MDM plists (macOS) and both registry policy hives (Windows) are "managed" sources
that override it.

| Source | macOS | Windows | Precedence |
|---|---|---|---|
| Managed, per-user | `/Library/Managed Preferences/<user>/com.anthropic.claudefordesktop.plist` | `HKCU\SOFTWARE\Policies\Claude` (user policy) | high (per-user plist wins over device plist; HKCU is **ignored entirely** when HKLM has any value) |
| Managed, machine | `/Library/Managed Preferences/com.anthropic.claudefordesktop.plist` | `HKLM\SOFTWARE\Policies\Claude` | highest on Windows |
| Local, user | `~/Library/Application Support/Claude-3p/configLibrary/` | `%LOCALAPPDATA%\Claude-3p\configLibrary\` | lowest; ignored when a managed source sets any non-app-behavior key |

### Evidence

- **No NSUserDefaults path.** The bundle contains zero occurrences of `NSUserDefaults`, `CFPreferences*`,
  `getUserDefault`, `Library/Preferences` or `defaults read`. The managed plists are read as files:
  `SMe()` @3141469 returns `["/Library/Managed Preferences/com.anthropic.claudefordesktop.plist",
  "/Library/Managed Preferences/<username>/com.anthropic.claudefordesktop.plist"]` (or the
  `CLAUDE_E2E_MANAGED_PLIST` env override). Those files are root-owned and MDM-controlled, so they are not a target
  for a user-level tool. `defaults read com.anthropic.claudefordesktop` on this Mac shows only AppKit UI keys.
- **Config library on disk.** `il()` @3126937 resolves the 3P data dir (`<userData>-3p` on macOS,
  `%LOCALAPPDATA%\Claude-3p` on Windows, `CLAUDE_USER_DATA_DIR` override); `sl()/cl()/ll()` @3128394 give
  `configLibrary/`, `configLibrary/<id>.json`, `configLibrary/_meta.json`. `NMe()/PMe()/LMe()` @3144842 load
  `_meta.json`, take `appliedId` (must match `^[a-f0-9-]{36}$`), read that entry and drop unknown keys with an
  "Ignoring local configuration key" warning. `cP()/aP()/sP()/uP()/lP()` @5149823–5151170 create a `Default` entry
  on first use, write entries under a mutex, and validate writes with the same schema in `channel: "local"`.
  Docs (data-storage): "`configLibrary/` — locally authored configuration (from the in-app configuration window).
  `_meta.json` records which saved configuration is applied; each is a `<id>.json` file alongside it. Ignored when a
  managed profile is present." Files are written owner-only (this Mac: `_meta.json` 254 B and two entries, all
  `-rw-------`, dir `drwx------`).
- **`_meta.json` shape** (keys/types read; values not): `{ "appliedId": string, "entries": [{ "id": string, "name": string }, …] }`.
- **Managed takeover rule.** Docs (mdm, "Update keys and managed precedence") plus the bundle's `appBehaviorOnly: true`
  flag on those key definitions (@2940876, @3022643): a managed source that sets *only* app-behavior keys
  (`disableAutoUpdates`, `autoUpdaterEnforcementHours`, `updateViaUpdatesHost`, `relaunchEnforcementHours`,
  `configRecheckIntervalMinutes`, `egressProxyUrl`, `egressProxyPacUrl`) leaves the local library in force and the
  in-app window editable; any other recognized key makes the whole configuration managed. **This Mac's Cornell profile
  sets exactly `disableAutoUpdates = true`** (both plists, 68 bytes each), so the local library is live here.
  (anthropics/claude-code#54647, April 2026, build 1.5354.0, reported the lock-out; the current build and docs carry the
  exception.)
- **Windows hive rule** (docs, mdm §4 and installation): v1.19367.0+ does not merge hives; any `REG_SZ`,
  `REG_EXPAND_SZ` or `REG_DWORD` directly under `HKLM\SOFTWARE\Policies\Claude` (even an empty or misspelled one)
  makes the app ignore `HKCU` completely. Values sit directly under the key, never in subkeys; arrays/objects are
  JSON in a single `REG_SZ`.
- **Read at launch only** — "fully quit and relaunch"; `configRecheckIntervalMinutes` re-checks managed/bootstrap
  sources, not the local file.
- **Document format.** Two accepted shapes, inferred from the document (bootstrap doc, "Response schema"):
  *v1 flat* — the documented key names at top level (`inferenceProvider`, `inferenceGatewayBaseUrl`, …);
  *v2 nested* — `"$schemaVersion": 2` with clusters `inference`, `mcp`, `models`, `workspace`, `authentication`,
  `autoUpdate`, `lifecycle`, `telemetry`, `otlp`, `plugins`, `extensions`, `codeSurface`, `coworkSurface`,
  `chatSurface`, `tokenLimits`, `appearance`, `banner`, `featureDiscovery`, `claudeAiImport`. v2 is "what the app's
  own JSON export writes". Gateway shape in v2:
  `inference: { provider: "gateway", baseUrl, customHeaders?, sessionLifetimeSec?, streamIdleTimeoutSec?,
  credential: { kind: "static", apiKey, authScheme } | { kind: "helper-script", command, ttlSec, timeoutSec,
  silentRefreshEnabled, authScheme } | { kind: "interactive", oidc, authFlow } }`.
- **Keys the owner profile needs** (v1 names; v2 equivalents above): `inferenceProvider: "gateway"`,
  `inferenceGatewayBaseUrl`, `inferenceGatewayAuthScheme: "bearer" | "x-api-key"` (default bearer), and one
  credential: `inferenceCredentialKind: "static"` + `inferenceGatewayApiKey`, **or** `"helper-script"` +
  `inferenceCredentialHelper` (absolute path to an executable run with no arguments; stdout is a bare token or
  `{"token": "...", "headers": {...}}`; exit 0; env `CLAUDE_HELPER_CONTEXT` ∈ interactive | mid-session-refresh |
  background | scheduled-task | setup-test; cached `inferenceCredentialHelperTtlSec` = 3600; bounded by
  `inferenceCredentialHelperTimeoutSec` = 60, clamped to 20 s mid-session; PATH includes the login-shell PATH).
  Optional: `inferenceModels` (only if the gateway lacks `GET /v1/models`), `modelDiscoveryEnabled`,
  `disableDeploymentModeChooser` (hide the claude.ai sign-in).
- **Verification hooks.** Help → Troubleshooting → *Copy Managed Configuration Report* lists which keys were read and
  from which source (managed vs user store) with secrets redacted; `~/Library/Logs/Claude-3p/main.log` /
  `%LOCALAPPDATA%\Claude-3p\Logs\main.log` records validation errors. The in-app window opens via
  Help → Troubleshooting → Enable Developer Mode, then Developer → Configure Third-Party Inference…; *Apply Changes*
  writes the local library and relaunches; *Export → JSON config* produces "a configuration file for a device without
  MDM"; *Import configuration* loads one.

## Implications for Phase 3 (`desktop-inference`)

- **Target the config library, not defaults or the registry.** Detect = read `_meta.json`, then the applied entry;
  report provider/baseUrl/credential *kind* only (never the key). Plan = require Desktop not running (macOS
  `Claude.app/Contents/MacOS/Claude`, Windows `Claude.exe`), write a new `<uuid>.json` (v2 nested, to match the app's
  own writer), append `{id, name: "boot-slapper"}` to `entries` and set `appliedId`. Adopt-never-clobber: if the applied
  entry already has `provider: gateway` with the profile's baseUrl, adopt it and fill only missing keys; never rewrite
  a foreign entry, add a sibling and switch `appliedId` instead. Verify = re-read and compare; "relaunch Desktop"
  is a user step, then the Managed Configuration Report.
- **Secret delivery:** prefer `credential.kind: "helper-script"` with a boot-slapper-generated helper that prints the
  gateway key from the `SecretStore` (Keychain on macOS, PasswordVault on Windows). The key never lands in a config
  file, rotation needs no rewrite, and the helper runs non-interactively for every `CLAUDE_HELPER_CONTEXT`. Fallback:
  `kind: "static"` with `apiKey` in the owner-only library file (mode 0600, which still satisfies the spec's
  "mode-600 file the child owns" rule).
- **Cornell-managed boxes:** the artifact must check for a managed takeover before writing — macOS: any
  non-app-behavior key in either managed plist; Windows: any value under `HKLM\SOFTWARE\Policies\Claude` beyond the
  app-behavior set (and note HKCU is dead the moment HKLM is non-empty). If managed, degrade to the spec's fallback:
  print the values (key from the store) and point at the in-app window, or hand the user a JSON config for *Import*.
- **Two data dirs coexist.** `Claude/` (claude.ai mode, in use on this Mac today) and `Claude-3p/` (used here in
  April–June). The library affects only 3P mode; the sign-in screen offers 3P when a provider is configured.
- Gate-2 checks on the new Mac and the Cornell Windows box: contents of the managed sources, the Managed
  Configuration Report after the first `bs onboard`, and `main.log`.

## Not verified / open

- **No write test was run** (read-only spike). That a file authored outside the app is loaded is inferred from the
  loader code and the docs; confirm on this Mac with a throwaway library entry before the artifact is written.
- **Exact shape this build writes.** The applied entry here (272 bytes, 2026-04-23) was not opened; a keys-only read
  was declined by the session's permission classifier. Owner can confirm flat vs nested with
  `grep -o '"[A-Za-z$]*":' "$HOME/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json"`.
- **Helper launch mechanics on Windows** (does a `.cmd`/`.ps1` count as "executable", or only `.exe`?) — the spawn
  code was not extractable in this session; the `sshClientPath` docs require a native `.exe` for that key, so assume
  the same and verify on the Windows box. Fallback is the static key.
- Whether `Reveal in Finder` / the picker tolerates an entry the app did not create (name not unique, missing
  optional fields) — cheap to test when the write test runs.
