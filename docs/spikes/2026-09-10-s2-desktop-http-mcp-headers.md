# S2 — Claude Desktop, HTTP MCP servers and an `Authorization` header

**Spec question (design §4):** does `claude_desktop_config.json` accept an HTTP server entry with an
`Authorization` header? If not, `desktop-mcp` writes an `mcp-remote` stdio bridge entry. The probe becomes the
runtime capability check.

**Date / box / method:** as S1 (2026-09-10, JCB-AL-ACA34, Claude Desktop 1.49585.0; bundle string extraction,
directory listings, Anthropic 3P docs and the published config schemas; read-only, nothing written).

## Answer

**`claude_desktop_config.json` — no. The same per-user config library from S1 — yes**, through the
`managedMcpServers` key, which carries Streamable-HTTP/SSE entries with static `headers`, a `headersHelper`
executable, or `oauth`. No `mcp-remote` bridge is needed.

### `claude_desktop_config.json` is stdio-only

- In 3P mode the file lives in the 3P data dir (`ol()` @3128394: `~/Library/Application Support/Claude-3p/
  claude_desktop_config.json`, `%LOCALAPPDATA%\Claude-3p\claude_desktop_config.json`); a separate copy exists in
  `Claude/` for claude.ai mode.
- Its schema `k8e` @3864439 has `mcpServers: Record<string, nh>` with `nh` @3761751 =
  `{ command: string, args?: string[], env?: Record<string,string>, extensionId?: string }`. An entry with `url` and
  no `command` fails `nh.safeParse`, is dropped (`F8e`), and the app shows "Some MCP servers couldn't be loaded — The
  following entries in claude_desktop_config.json are not valid MCP server configurations and were skipped".
- Docs (extensions, "User extensions"): "End users cannot add remote MCP servers or install desktop extension files
  (`.mcpb`) themselves. Remote servers are available only via admin-provisioned `managedMcpServers` or organization
  plugins." User-added local servers come from Settings → Developer and are gated by `isLocalDevMcpEnabled`
  (default `true`; bundle key `localStdioEnabled`, flatKey `isLocalDevMcpEnabled`, @2990263).
- The `{"type":"http","url":…,"headers":…}` schema found at @1203944 belongs to the embedded Claude Code
  (`.mcp.json` / settings), not to Desktop's config file. Plugins' `.mcp.json` accept `type: http` + `url` +
  `headers` + `oauth` but not `headersHelper` (docs, plugin structure table).

### `managedMcpServers` in the local config library

- Key definition @2982988: flatKey `managedMcpServers`, `readers: ["desktop","m365"]`, scopes 3p (≥1.2581.0) and
  1p (≥1.24012.11); no local-channel exclusion (MDM-only keys carry `remotePolicy: {type: "remote-disabled"}`, this one
  does not). The in-app configuration window's **Connectors** section edits exactly this array and *Apply Changes*
  writes it to the library for single-machine setups (docs: in-app-configuration, mdm §1). v2 nested location:
  `mcp.managedServers`.
- Entry shapes (from `bootstrap-config-v1.schema.json`, identical items in v2):
  - remote: `{ "name", "transport": "http" | "sse", "url", "headers"?: {"Name": "value"}, "headersHelper"?: "/abs/path",
    "headersHelperTtlSec"?: 300, "headersHelperRefreshBufferSec"?: 60, "oauth"?: true | { mode, clientId, clientSecret,
    clientSecretHelper, scope, scopes, tenantId, authorizationServer, authorizationUrl, tokenUrl, authFlow,
    callbackHost, callbackPort, appendOfflineAccess, additionalRedirectReferrerHosts }, "toolPolicy"?: { "<tool>":
    "allow" | "ask" | "blocked" } }` — required `name`, `transport`, `url`.
  - stdio: `{ "name", "transport": "stdio", "command", "args"?, "env"?, "envHelper"?, "envHelperTtlSec"?,
    "startupTimeoutSec"?, "toolPolicy"? }`.
  - built-ins (`server: "microsoft365" | "websearch" | "github"`) are separate variants.
- **Header handling at runtime** (`[custom3p-mcp]`, @4326214): `YS(entry, authProvider, helperHeaders)` builds the
  MCP SDK transport (`StreamableHTTPClientTransport`, or `SSEClientTransport` when `transport === "sse"`) with
  `requestInit.headers = JS(entry.headers, helperHeaders)`, where `JS` merges both maps and **removes any
  `authorization` key** — the bearer credential is instead routed through the app's own auth provider (`qS`) so the
  SDK's 401/refresh logic owns it. `Ss(entry)` @2847614 defines "needs OAuth": an `http`/`sse` entry with `oauth` set,
  or with **neither** a `headersHelper` **nor** an `Authorization` static header. Docs agree: "An `http` or `sse` entry
  with no `oauth`, no `headersHelper`, and no `Authorization` header is treated as `"oauth": true` when its server asks
  for authentication (1.24012.0 or later)". So a bearer token is honored by either route.
- **Headers helper contract** (extensions, "Short-lived credentials with a headers helper"; UI hint @2819490):
  absolute path to an executable that prints the request headers as a flat JSON object on stdout ("Merged over static
  headers; the helper wins on conflict"); follows the inference credential-helper execution model with three
  differences — 30-second limit, no `CLAUDE_HELPER_CONTEXT`, no prompting; cached `headersHelperTtlSec` (300),
  re-run `headersHelperRefreshBufferSec` (60) before expiry; "applies only to servers provisioned through managed
  configuration" (which is the `managedMcpServers` path) and "never replaces the `Authorization` header on `oauth`
  entries". The in-app hint for static headers: "routing and tenant headers only. No credentials here; use the headers
  helper script for tokens and rotating values."
- **OAuth path:** `"oauth": true` → dynamic client registration, PKCE, fixed loopback redirect
  `http://127.0.0.1:<port>/callback`; tokens stored in the data dir encrypted with Keychain/DPAPI and refreshed in the
  background; the server shows a **Connect** button until the user signs in through the system browser.
- Managed entries "appear in the user's connector list automatically, can't be removed by the user"; per-tool
  `toolPolicy`; the window has **Test this connection** (live `initialize` + `tools/list`). Logs:
  `mcp.log` and `mcp-server-<name>.log` in the 3P logs dir. No client-certificate (mTLS) support.
- Consent: `headersHelper` is marked `x-consentRequired: true` in the schema, but the "Apply settings from your
  organization?" dialog gates **bootstrap-delivered** values only; values from the local file or device management
  apply without prompting (bootstrap doc, "Keys that require user consent").

## Implications for Phase 3 (`desktop-mcp`, `open-brain-auth`)

- **Write `managedMcpServers` entries into the same library document `desktop-inference` owns**; no stdio bridge.
  `desktop-mcp` therefore `requires` `desktop-inference` (one document, one writer) — the cross-surface `requires`
  handling deferred from Phase 1 lands here.
  - MeCP: `{ name: "mecp", transport: "http", url: <same URL as ~/.claude/mcp/gateway.json>, headersHelper:
    <boot-slapper helper that prints {"Authorization": "Bearer <key from SecretStore>"}>, headersHelperTtlSec: 3600 }`.
    The key stays in Keychain/PasswordVault; static `headers.Authorization` in the 0600 library file is the fallback.
  - Open Brain: `{ name: "open-brain", transport: "http", url: …, oauth: true }`; the user signs in once in the
    browser (Connect button). Use `oauth.clientId` only if the server refuses dynamic registration.
- **Runtime capability check** (the spec's "the probe becomes the runtime capability check"): `detect` reads the
  Desktop version (`Info.plist` `CFBundleShortVersionString`; Windows package version) and requires ≥ 1.19367.0
  (http/sse/stdio managed entries, static headers, helper) — this Mac is far past it — and refuses when a managed
  source owns the configuration (S1 rule), degrading to printed instructions.
- Keep the Code-surface MCP config (`~/.claude/mcp/gateway.json`, Claude Code's own `headers`) as is; Desktop's
  Code sessions use Claude Code's config, Chat/Cowork use `managedMcpServers`. One profile, one set of URLs.
- Verify = after relaunch the connector list shows both servers; `mcp-server-<name>.log` has a successful
  `initialize`; optional: **Test this connection** in the window.

## Not verified / open

- No write or launch test (read-only spike). Specifically unverified: that entries authored outside the app in the
  local library reach the connector list without a consent dialog, and that a `headersHelper` on a *locally*
  provisioned entry is executed (docs say "managed configuration", which the local library is a channel of).
- Helper spawn mechanics (shell vs direct exec; Windows `.exe` vs `.cmd`/`.ps1`) — see S1; same fallback (static
  header in the 0600 file).
- Whether the connector list in claude.ai mode (`Claude/` data dir) is affected at all — it should not be; the
  library is 3P-only.
