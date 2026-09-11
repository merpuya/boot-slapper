# boot-slapper Phase 3 — Desktop artifacts and cutover staging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `desktop` surface to the owner profile — `desktop-inference`, `desktop-mcp`, `desktop-skills`, `open-brain-auth`, `hosted-connectors` — on top of what spikes S1/S2 established about Claude Desktop 1.49585.0, plus the engine pieces they need (an HTTP probe on `Io`, cross-surface `requires`, a shared Desktop probe module), and stage the gate-2/gate-3 cutover material as reviewable files so the real-box gates are copy-and-verify, not design work.

**Architecture:** Nothing about the artifact contract changes. The five desktop artifacts share one module, `src/engine/desktop.ts`, that knows where Claude Desktop keeps its third-party (3P) configuration (the per-user *config library* under the `Claude-3p` data directory), how to tell whether an MDM profile owns the configuration, whether the app is installed/running/new enough, and how to read and write the one library entry boot-slapper owns (named `boot-slapper`, tracked in a sidecar under `~/.config/boot-slapper/`). `desktop-inference` and `desktop-mcp` write that single document; `desktop-skills` copies dotclaude skills into Cowork's `skills-plugin` directory and upserts its manifest; `open-brain-auth` is a gate plus two read-only grant checks; `hosted-connectors` is instructions only. Secrets reach Desktop through helper executables that print the value from the `SecretStore` — never through a config value.

**Tech Stack:** unchanged — TypeScript, ESM, Node ≥ 22.5, vitest 3, tsx, Ink 7 / React 19. `node:crypto` (`randomUUID`, sha256). Global `fetch` (Node ≥ 18) behind `Io.fetch`.

**Spec:** `docs/superpowers/specs/2026-09-09-boot-slapper-design.md` (§4 rows 8–12, §5 bundle `desktop-skills/`, §6 gates 2–3). **Spikes (binding for rows 8–9; read both before Task 1):** `docs/spikes/2026-09-10-s1-desktop-3p-config-location.md`, `docs/spikes/2026-09-10-s2-desktop-http-mcp-headers.md`. **Prior plans:** Phase 1 `2026-09-09-boot-slapper-phase1-engine.md` (roadmap item 7, Phase 3 outline), Phase 2 `2026-09-10-boot-slapper-phase2-artifacts-tui.md` (Deviations §4).

## Global Constraints

All Phase 1 and Phase 2 constraints still hold (copied so this file stands alone):

- Node `>=22.5.0`; `"type": "module"`; tsconfig `module: nodenext`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `strict`, `jsx: react-jsx`. Imports use `.ts` / `.tsx` extensions.
- Nothing under `src/engine/` or `src/artifacts/` imports from `src/ui/` (spec §5).
- `detect`, `verify` and `capture` never write. `apply` runs only steps `plan` produced. Re-running `apply` on a satisfied artifact yields an empty plan (spec §2 invariants 1, 2, 6).
- Adopt, never clobber (invariant 3): a user-owned file that differs is reported and left alone. Files boot-slapper generates under `~/.config/boot-slapper/` are owned and regenerated. **Phase 3 extension:** a Claude Desktop config-library entry boot-slapper did not create is never edited; a Cowork skill directory or manifest entry boot-slapper did not create is never edited (Deviations §2, §4).
- No secret value in any `Step` text, event, log line, bundle, check message, or child-process argv (invariant 4). Secret values reach Desktop only through a helper executable that prints them, and reach the gateway probe only as an in-process HTTP header.
- Files are written with a trailing newline; JSON with 2-space indent and LF line endings. Config-library entries and helper scripts are written mode 600 / 700 in a mode-700 directory.
- Windows: never spawn `.cmd` / `.bat` directly; paths for the target OS come from `pj(env.os, …)`. Helper executables for Desktop are `.sh` (darwin/linux) and `.ps1` (win32) — Desktop runs `.ps1` through `powershell.exe -File` (S2/S1 findings, bundle `tSt()`); helper paths must be absolute and contain no `"` or `%`.
- Every artifact's `detect`/`verify` exec calls must pass `tests/unit/artifacts/contract.test.ts`'s allowlist; extend the allowlist in the task that adds the probe (Task 7 collects them).
- **Cutover state does not change in this plan** (spec §6). `bootstrap.sh` and `claude-gw.zsh` stay live. On this Mac, only `bs env | plan | doctor | capture` touch the box; `bs onboard --only desktop-inference,desktop-mcp,desktop-skills` on this Mac is a gate-2 rehearsal the owner runs by hand after Task 9's report, never something a task runs.
- Commit after every task with a conventional-commit subject; the harness appends the attribution trailer.
- **Before Task 1:** `npm ci` if `node_modules` is missing; `npm test` must report **143 passed** (baseline on `main` at `fa1aa33`).

## Phase map

This plan is **Phase 3 of 3** for sub-project A. It ends with the `aca34` profile on both surfaces, `bs plan` / `bs doctor` green on this Mac for every artifact that can be green without the new boxes, the skins-parity test covering the desktop artifacts, and `docs/cutover/` holding the gate-2 shims and runbook. Gates 2 and 3 themselves happen on the two new machines and are recorded by handoff notes, not by this plan.

## File structure (Phase 3)

```
src/
  engine/
    io.ts                       # + Io.fetch (RealIo: global fetch + timeout; FakeIo: recorded, handler-driven)
    plan.ts                     # selectArtifacts pulls transitive `requires` across surfaces
    env.ts                      # EnvProbe.desktopVersion; desktopInstalled via engine/desktop.ts
    desktop.ts                  # NEW — 3P paths, install/version probe, managed-source probe, running probe,
                                #       config-library read/write for the boot-slapper entry, sidecar, cfgGet (v1|v2)
  artifacts/
    templates/desktop-helpers.ts# NEW — credential helper (.sh/.ps1) and headers helper (.sh/.ps1) renderers
    desktop-inference.ts        # NEW — spec §4 row 8 (per S1)
    desktop-mcp.ts              # NEW — row 9 (per S2)
    desktop-skills.ts           # NEW — row 10 (Cowork skills-plugin, copy + manifest upsert)
    open-brain-auth.ts          # NEW — row 11
    hosted-connectors.ts        # NEW — row 12
    prereqs.ts                  # desktop check via engine/desktop.ts (MSIX-aware on win32, version shown)
    project-memory.ts           # bashCmd: Git Bash resolved via `git --exec-path` on win32 (Task 7b)
  profiles/aca34.ts             # surfaces: ["code","desktop"]; five new artifacts + options
  cli.ts                        # USAGE lists the desktop artifacts in --only examples (text only)
tests/
  unit/engine/{io,plan,desktop}.test.ts
  unit/artifacts/{desktop-inference,desktop-mcp,desktop-skills,open-brain-auth,hosted-connectors}.test.ts
  unit/artifacts/{prereqs,contract}.test.ts (extended)
  unit/cli.test.ts (+1), parity/skins.test.ts (fixture extended)
docs/cutover/gate-2-runbook.md, docs/cutover/gate-3-note.md
docs/cutover/staged/{bootstrap.sh, dotfiles-install-step3.sh, dotfiles-install-step3.ps1, gateway-sessions.md}
README.md, CLAUDE.md, docs/superpowers/specs/… (amendments)
```

## Deviations from the spec (decided here from the spike findings; repeat them in the phase report)

1. **Row 8 target is the config library, not defaults or the registry.** Claude Desktop never reads `NSUserDefaults`; MDM plists and registry policy are *managed* sources that override the per-user store. The per-user store is `~/Library/Application Support/Claude-3p/configLibrary/` (`%LOCALAPPDATA%\Claude-3p\configLibrary\`, `~/.config/Claude-3p/configLibrary/`): `_meta.json` `{ appliedId, entries: [{ id, name }] }` plus one `<uuid>.json` per configuration. boot-slapper owns exactly one entry, named `boot-slapper`, written in the app's own nested v2 shape (`"$schemaVersion": 2`). A foreign applied entry that already satisfies the profile (provider `gateway`, same base URL, a credential configured) is adopted read-only; otherwise boot-slapper adds its entry and switches `appliedId` — the foreign entry is never edited. When a managed source sets any key outside the app-behavior group (`disableAutoUpdates`, `autoUpdaterEnforcementHours`, `updateViaUpdatesHost`, `relaunchEnforcementHours`, `configRecheckIntervalMinutes`, `egressProxyUrl`, `egressProxyPacUrl`), the desktop artifacts are `blocked` with the spec's degraded instructions (the in-app window, *Developer → Configure Third-Party Inference…*, and *Import configuration*). `disableAutoUpdates` is **not** written locally (the spec's row 8 lists it): the update group is resolved from the managed source alone and Cornell's MDM already sets it.
2. **The gateway key is delivered by a credential helper, not a config value.** `inference.credential = { kind: "helper-script", command: <~/.config/boot-slapper/desktop-inference-credential.sh|.ps1>, ttlSec: 3600, authScheme: "bearer" }`. The helper prints the key from the same `SecretStore` the code surface uses. Static `apiKey` is not written by boot-slapper at all — the helper path works on both OSes (`.ps1` runs through `powershell.exe -File`), so the fallback the spike kept is "the owner types the key into the in-app window", not a boot-slapper-written secret.
3. **Row 9 uses `managedMcpServers` in the same entry, not `claude_desktop_config.json` and not `mcp-remote`.** Desktop's `claude_desktop_config.json` server schema is stdio-only; remote servers with headers live in the config library under `mcp.managedServers`. MeCP gets `headersHelper` (a script printing `{"Authorization":"Bearer <mecp-device-token>"}`), Open Brain gets `oauth: true`. URLs are read from the tracked `~/.claude/mcp/gateway.json` so the two surfaces cannot disagree. The "runtime capability probe" the spec asked for is the Desktop version floor `1.19367.0` (managed `http`/`sse`/`stdio` entries, static headers, helpers) plus the managed-takeover check.
4. **Row 10 copies into Cowork's skills-plugin directory; no symlinks, no `~/Documents/Claude`.** Cowork keeps user skills at `<Claude-3p data dir>/local-agent-mode-sessions/skills-plugin/<orgUuid>/<accountUuid>/skills/<name>/SKILL.md` with a sibling `manifest.json` (`{ lastUpdated, skills: [{ skillId, name, description, creatorType, syncManaged, updatedAt, enabled }] }`). `orgUuid` is `deploymentOrganizationUuid` when the configuration sets it, else the 3P sentinel `00000000-0000-4000-8000-000000000001`; `accountUuid` is the base64-decoded `ant-did` file. Skill directories are copied (the sandbox VM mounts the directory; symlinks outside a plugin are skipped per the 3P docs) and re-copied when the source changes; a manifest entry `{ skillId: <name>, name, description (SKILL.md frontmatter), creatorType: "user", syncManaged: false, updatedAt, enabled: true }` is added when missing. A skill of the same name that boot-slapper did not create is reported and left alone. The artifact is `blocked` until Desktop has run once in 3P mode (`ant-did` and the plugin directory exist).
5. **Row 12's "custom skills do not load in Cowork" is retired.** The 3P feature matrix (2026-09-10) lists skills, plugins, hooks, remote MCP, memory, projects and scheduled tasks as available; what is absent on a gateway box is the claude.ai-hosted connector set, Claude in Chrome, claude.ai web access, voice, Claude Design, project/plugin sharing, and chat-history search. The artifact renders that list from profile data.
6. **Cross-surface `requires`** (Phase 1 roadmap item 7): `selectArtifacts` now includes, in DAG order, every artifact reachable through `requires` from an on-surface artifact even when the dependency is off-surface. A profile with `surfaces: ["desktop"]` (sub-project B) therefore still runs `claude-config` for `desktop-skills`. `resolveOrder` keeps throwing on a truly unknown id.
7. **Gate 2 material is staged, not applied.** `docs/cutover/staged/` carries the exact `bootstrap.sh` shim, the dotfiles step-3 replacements, and the `gateway-sessions.md` rewrite; the gate-2 runbook says which repo each goes to and what to verify. Those repos change only when both new boxes are green (spec §6).

---

### Task 1: Engine — `Io.fetch`, cross-surface `requires`, and the shared `engine/desktop.ts` probe module

**Files:**
- Modify: `src/engine/io.ts`, `src/engine/plan.ts`, `src/engine/env.ts`, `tests/unit/engine/io.test.ts`, `tests/unit/engine/env.test.ts`
- Create: `src/engine/desktop.ts`, `tests/unit/engine/plan.test.ts`, `tests/unit/engine/desktop.test.ts`

**Interfaces:**
- Consumes: `Io`, `pj`, `Os`, `Profile`, `resolveOrder` (Phase 1/2).
- Produces (later tasks rely on these exact names):
  - `Io.fetch(url: string, init?: FetchInit): Promise<FetchResult>` with `interface FetchInit { method?: "GET"; headers?: Record<string, string>; timeout?: number }` and `interface FetchResult { status: number; body: string }`. Network failure resolves `{ status: 0, body: <error message> }` — it never rejects. `FakeIo.fetches: Array<{ url: string; init: FetchInit }>` records every call; `FakeIo.onFetch(match: (url: string) => boolean, handler: (url: string, init: FetchInit) => FetchResult)` registers a responder; unmatched calls resolve `{ status: 0, body: "fetch not handled" }`.
  - `selectArtifacts(profile, filter)` — on-surface artifacts plus their transitive `requires`, DAG-ordered, then filtered by `only`/`skip`.
  - `EnvProbe.desktopVersion: string | null`; `probeEnv` fills `desktopInstalled` and `desktopVersion` from `desktopInstall()`.
  - `src/engine/desktop.ts` exports, verbatim signatures:
    ```ts
    export const ORG_SENTINEL = "00000000-0000-4000-8000-000000000001";
    export const MIN_DESKTOP_VERSION = "1.19367.0";
    export const ENTRY_NAME = "boot-slapper";
    export const APP_BEHAVIOR_KEYS: ReadonlySet<string>;
    export const MSIX_FAMILY = "AnthropicPBC.Claude_fnn82j28hfe8t";
    export function desktopDataDir(io: Io, os: Os, home: string): string;          // …/Claude-3p
    export function configLibraryDir(io: Io, os: Os, home: string): string;        // …/Claude-3p/configLibrary
    export function bsDir(os: Os, home: string): string;                           // ~/.config/boot-slapper
    export function sidecarPath(os: Os, home: string): string;                     // ~/.config/boot-slapper/desktop.json
    export interface DesktopInstall { installed: boolean; path: string; version: string | null }
    export async function desktopInstall(io: Io, os: Os, home: string): Promise<DesktopInstall>;
    export function versionAtLeast(v: string | null, min: string): boolean;
    export interface ManagedSource { source: string; keys: string[] }
    export async function managedSources(io: Io, os: Os): Promise<ManagedSource[]>;
    export function managedTakeover(sources: ManagedSource[]): string | null;      // description of the owning source, or null
    export async function desktopRunning(io: Io, os: Os): Promise<boolean>;
    export interface LibraryMeta { appliedId: string; entries: Array<{ id: string; name: string }> }
    export async function readLibraryMeta(io: Io, os: Os, home: string): Promise<LibraryMeta | null | "invalid">;
    export async function readLibraryEntry(io: Io, os: Os, home: string, id: string): Promise<Record<string, unknown> | null | "invalid">;
    export interface Sidecar { entryId?: string; servers?: string[]; skills?: Record<string, string> }
    export async function readSidecar(io: Io, os: Os, home: string): Promise<Sidecar>;
    export async function writeSidecar(io: Io, os: Os, home: string, patch: Partial<Sidecar>): Promise<Sidecar>;
    export function cfgGet(doc: Record<string, unknown> | null, nested: string[], flat: string): unknown;
    export interface OurEntry { id: string; doc: Record<string, unknown>; applied: boolean }
    export async function ourEntry(io: Io, os: Os, home: string): Promise<OurEntry | null | "invalid">;
    export function newEntryId(): string;
    export async function writeLibraryEntry(io: Io, os: Os, home: string, id: string, doc: Record<string, unknown>): Promise<void>;
    export async function upsertMeta(io: Io, os: Os, home: string, entry: { id: string; name: string }, apply: boolean): Promise<void>;
    export function decodeAntDid(raw: string | null): string | null;
    ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/engine/io.test.ts`:
```ts
describe("Io.fetch", () => {
  it("FakeIo records calls, answers via onFetch, and never rejects", async () => {
    const io = new FakeIo();
    io.onFetch((u) => u.endsWith("/v1/models"), () => ({ status: 200, body: '{"data":[]}' }));
    expect(await io.fetch("https://gw/v1/models", { headers: { Authorization: "Bearer x" } })).toEqual({ status: 200, body: '{"data":[]}' });
    expect(await io.fetch("https://gw/other")).toEqual({ status: 0, body: "fetch not handled" });
    expect(io.fetches.map((f) => f.url)).toEqual(["https://gw/v1/models", "https://gw/other"]);
  });
  it("RealIo resolves {status: 0} on a connection failure instead of throwing", async () => {
    const io = new RealIo();
    const r = await io.fetch("http://127.0.0.1:1/nope", { timeout: 2000 });
    expect(r.status).toBe(0);
    expect(r.body.length).toBeGreaterThan(0);
  });
});
```
(add `RealIo` to the existing import from `../../../src/engine/io.ts`).

Create `tests/unit/engine/plan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { selectArtifacts } from "../../../src/engine/plan.ts";
import type { Profile } from "../../../src/engine/profile.ts";

const stub = (id: string, surfaces: Artifact["surfaces"], requires: string[] = []): Artifact =>
  ({ id, surfaces, requires, portability: "portable", detect: async () => ({ kind: "present" }), plan: () => [], apply: async () => {}, verify: async () => [] });
const profile = (surfaces: Profile["surfaces"], artifacts: Artifact[]): Profile => ({ name: "t", provider: "gateway", surfaces, artifacts, options: {} });

describe("selectArtifacts", () => {
  const code = stub("claude-config", ["code"]);
  const both = stub("secrets", ["code", "desktop"]);
  const desk = stub("desktop-skills", ["desktop"], ["claude-config"]);
  const deskOnly = stub("hosted-connectors", ["desktop"]);
  it("pulls an off-surface dependency in, before its dependent", () => {
    // Kahn with declaration order among peers: the three root artifacts in the order they were declared, then the dependent.
    expect(selectArtifacts(profile(["desktop"], [code, both, desk, deskOnly])).map((a) => a.id)).toEqual(["claude-config", "secrets", "hosted-connectors", "desktop-skills"]);
  });
  it("leaves unrelated off-surface artifacts out", () => {
    expect(selectArtifacts(profile(["code"], [code, both, desk, deskOnly])).map((a) => a.id)).toEqual(["claude-config", "secrets"]);
  });
  it("--only/--skip filter after the pull-in, so a skipped dependency is simply absent from the plan", () => {
    expect(selectArtifacts(profile(["desktop"], [code, desk]), { skip: ["claude-config"] }).map((a) => a.id)).toEqual(["desktop-skills"]);
    expect(selectArtifacts(profile(["desktop"], [code, desk]), { only: ["desktop-skills"] }).map((a) => a.id)).toEqual(["desktop-skills"]);
  });
  it("still throws on an unknown requires id", () => {
    expect(() => selectArtifacts(profile(["desktop"], [stub("x", ["desktop"], ["ghost"])]))).toThrow(/unknown artifact "ghost"/);
  });
});
```

Create `tests/unit/engine/desktop.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import {
  cfgGet, configLibraryDir, decodeAntDid, desktopDataDir, desktopInstall, desktopRunning, managedSources, managedTakeover,
  ourEntry, readLibraryMeta, readSidecar, upsertMeta, versionAtLeast, writeLibraryEntry, writeSidecar, ENTRY_NAME,
} from "../../../src/engine/desktop.ts";

const PLIST = (keys: Record<string, string>) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${Object.entries(keys).map(([k, v]) => `<key>${k}</key><${v === "true" || v === "false" ? v : "string"}${v === "true" || v === "false" ? "/>" : `>${v}</string>`}`).join("")}</dict></plist>\n`;
const INFO = `<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string><key>CFBundleIdentifier</key><string>com.anthropic.claudefordesktop</string></dict></plist>`;

describe("engine/desktop paths", () => {
  it("resolves the Claude-3p data dir per OS (LOCALAPPDATA wins on win32)", () => {
    expect(desktopDataDir(new FakeIo(), "darwin", "/h")).toBe("/h/Library/Application Support/Claude-3p");
    expect(desktopDataDir(new FakeIo({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\t\\AppData\\Local" } }), "win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Local\\Claude-3p");
    expect(desktopDataDir(new FakeIo({ platform: "win32" }), "win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Local\\Claude-3p");
    expect(desktopDataDir(new FakeIo(), "linux", "/h")).toBe("/h/.config/Claude-3p");
    expect(configLibraryDir(new FakeIo(), "darwin", "/h")).toBe("/h/Library/Application Support/Claude-3p/configLibrary");
  });
});

describe("desktopInstall", () => {
  it("darwin: reads the version from Info.plist without exec", async () => {
    const io = new FakeIo({ dirs: ["/Applications/Claude.app"], files: { "/Applications/Claude.app/Contents/Info.plist": INFO } });
    expect(await desktopInstall(io, "darwin", "/h")).toEqual({ installed: true, path: "/Applications/Claude.app", version: "1.49585.0" });
    expect(io.calls).toEqual([]);
    expect(await desktopInstall(new FakeIo(), "darwin", "/h")).toEqual({ installed: false, path: "/Applications/Claude.app", version: null });
  });
  it("win32: the MSIX package dir counts as installed; version via Get-AppxPackage; legacy exe still recognised", async () => {
    const home = "C:\\Users\\t";
    const io = new FakeIo({ platform: "win32", home, env: { LOCALAPPDATA: `${home}\\AppData\\Local` }, dirs: [`${home}\\AppData\\Local\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`] });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "1.49585.0\r\n", stderr: "" }));
    expect(await desktopInstall(io, "win32", home)).toEqual({ installed: true, path: `${home}\\AppData\\Local\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`, version: "1.49585.0" });
    const legacy = new FakeIo({ platform: "win32", home, files: { [`${home}\\AppData\\Local\\AnthropicClaude\\claude.exe`]: "" } });
    legacy.on((c) => c === "powershell", () => ({ code: 1, stdout: "", stderr: "" }));
    expect(await desktopInstall(legacy, "win32", home)).toEqual({ installed: true, path: `${home}\\AppData\\Local\\AnthropicClaude\\claude.exe`, version: null });
  });
  it("versionAtLeast compares dotted numbers", () => {
    expect(versionAtLeast("1.49585.0", "1.19367.0")).toBe(true);
    expect(versionAtLeast("1.19367.0", "1.19367.0")).toBe(true);
    expect(versionAtLeast("1.5354.0", "1.19367.0")).toBe(false);
    expect(versionAtLeast(null, "1.19367.0")).toBe(false);
  });
});

describe("managed sources", () => {
  it("darwin: converts each existing managed plist with plutil and lists its keys; only app-behavior keys → no takeover", async () => {
    const io = new FakeIo({ env: { USER: "aca34" }, files: { "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist", "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist": "bplist" } });
    io.on((c, a) => c === "plutil" && a.includes("-convert"), ({ args }) => ({ code: 0, stdout: PLIST(args.at(-1)!.includes("/aca34/") ? { disableAutoUpdates: "true" } : { disableAutoUpdates: "true", autoUpdaterEnforcementHours: "24" }), stderr: "" }));
    const s = await managedSources(io, "darwin");
    expect(s).toEqual([
      { source: "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist", keys: ["disableAutoUpdates"] },
      { source: "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist", keys: ["disableAutoUpdates", "autoUpdaterEnforcementHours"] },
    ]);
    expect(io.calls.every((c) => c.cmd === "plutil" && c.args[0] === "-convert" && c.args[1] === "xml1" && c.args[2] === "-o" && c.args[3] === "-")).toBe(true);
    expect(managedTakeover(s)).toBeNull();
    expect(managedTakeover([{ source: "x.plist", keys: ["disableAutoUpdates", "inferenceProvider"] }])).toBe("x.plist sets inferenceProvider");
  });
  it("win32: HKLM values own the device; HKCU is consulted only when HKLM is empty", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\Users\\t" });
    io.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 0, stdout: "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Claude\r\n    disableAutoUpdates    REG_SZ    true\r\n\r\n", stderr: "" }));
    io.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 0, stdout: "\r\nHKEY_CURRENT_USER\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ    gateway\r\n\r\n", stderr: "" }));
    expect(await managedSources(io, "win32")).toEqual([{ source: "HKLM\\SOFTWARE\\Policies\\Claude", keys: ["disableAutoUpdates"] }]);
    const empty = new FakeIo({ platform: "win32", home: "C:\\Users\\t" });
    empty.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value." }));
    empty.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 0, stdout: "\r\nHKEY_CURRENT_USER\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ    gateway\r\n\r\n", stderr: "" }));
    const s = await managedSources(empty, "win32");
    expect(s).toEqual([{ source: "HKCU\\SOFTWARE\\Policies\\Claude", keys: ["inferenceProvider"] }]);
    expect(managedTakeover(s)).toBe("HKCU\\SOFTWARE\\Policies\\Claude sets inferenceProvider");
  });
  it("desktopRunning uses pgrep / tasklist and treats an unhandled probe as not running", async () => {
    const io = new FakeIo();
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "2590\n", stderr: "" }));
    expect(await desktopRunning(io, "darwin")).toBe(true);
    expect(await desktopRunning(new FakeIo(), "darwin")).toBe(false);
    const w = new FakeIo({ platform: "win32" });
    w.on((c) => c === "tasklist", () => ({ code: 0, stdout: "Claude.exe                    1234 Console                    1    300,000 K\r\n", stderr: "" }));
    expect(await desktopRunning(w, "win32")).toBe(true);
  });
});

describe("config library", () => {
  const L = "/h/Library/Application Support/Claude-3p/configLibrary";
  it("readLibraryMeta: null when absent, 'invalid' when malformed", async () => {
    expect(await readLibraryMeta(new FakeIo(), "darwin", "/h")).toBeNull();
    expect(await readLibraryMeta(new FakeIo({ files: { [`${L}/_meta.json`]: "{" } }), "darwin", "/h")).toBe("invalid");
    expect(await readLibraryMeta(new FakeIo({ files: { [`${L}/_meta.json`]: '{"appliedId":"a","entries":[{"id":"a","name":"Default"}]}' } }), "darwin", "/h")).toEqual({ appliedId: "a", entries: [{ id: "a", name: "Default" }] });
  });
  it("ourEntry finds the boot-slapper entry by sidecar id first, then by name; null when neither", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const io = new FakeIo({ files: {
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: "a", entries: [{ id: "a", name: "Default" }, { id, name: ENTRY_NAME }] }),
      [`${L}/${id}.json`]: JSON.stringify({ $schemaVersion: 2, inference: { provider: "gateway" } }),
      [`${L}/a.json`]: "{}",
    } });
    expect(await ourEntry(io, "darwin", "/h")).toEqual({ id, doc: { $schemaVersion: 2, inference: { provider: "gateway" } }, applied: false });
    await writeSidecar(io, "darwin", "/h", { entryId: id });
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, true);
    expect((await ourEntry(io, "darwin", "/h") as { applied: boolean }).applied).toBe(true);
    expect(await ourEntry(new FakeIo({ files: { [`${L}/_meta.json`]: '{"appliedId":"a","entries":[{"id":"a","name":"Default"}]}' } }), "darwin", "/h")).toBeNull();
  });
  it("writeLibraryEntry writes mode 600 inside a mode-700 dir; upsertMeta adds once and can switch appliedId; sidecar merges", async () => {
    const io = new FakeIo();
    const id = "22222222-2222-4222-8222-222222222222";
    await writeLibraryEntry(io, "darwin", "/h", id, { $schemaVersion: 2 });
    expect(io.files.get(`${L}/${id}.json`)).toBe('{\n  "$schemaVersion": 2\n}\n');
    expect(io.modes.get(`${L}/${id}.json`)).toBe(0o600);
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, false);
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, true);
    expect(JSON.parse(io.files.get(`${L}/_meta.json`)!)).toEqual({ appliedId: id, entries: [{ id, name: ENTRY_NAME }] });
    expect(await writeSidecar(io, "darwin", "/h", { entryId: id })).toEqual({ entryId: id });
    expect(await writeSidecar(io, "darwin", "/h", { servers: ["mecp"] })).toEqual({ entryId: id, servers: ["mecp"] });
    expect(await readSidecar(io, "darwin", "/h")).toEqual({ entryId: id, servers: ["mecp"] });
    expect(io.modes.get("/h/.config/boot-slapper/desktop.json")).toBe(0o600);
  });
  it("cfgGet reads the nested v2 shape or the flat v1 shape; decodeAntDid decodes base64 text", () => {
    expect(cfgGet({ inference: { provider: "gateway" } }, ["inference", "provider"], "inferenceProvider")).toBe("gateway");
    expect(cfgGet({ inferenceProvider: "gateway" }, ["inference", "provider"], "inferenceProvider")).toBe("gateway");
    expect(cfgGet(null, ["inference", "provider"], "inferenceProvider")).toBeUndefined();
    expect(decodeAntDid(Buffer.from("831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f").toString("base64") + "\n")).toBe("831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f");
    expect(decodeAntDid("not-base64!!")).toBeNull();
    expect(decodeAntDid(null)).toBeNull();
  });
});
```

Append to `tests/unit/engine/env.test.ts` (inside the existing `probeEnv` describe, or a new one):
```ts
it("reports the Desktop version when the app is installed", async () => {
  const io = new FakeIo({ dirs: ["/Applications/Claude.app"], files: { "/Applications/Claude.app/Contents/Info.plist": "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>" } });
  expect(await probeEnv(io)).toMatchObject({ desktopInstalled: true, desktopVersion: "1.49585.0" });
  expect(await probeEnv(new FakeIo())).toMatchObject({ desktopInstalled: false, desktopVersion: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/engine/io.test.ts tests/unit/engine/plan.test.ts tests/unit/engine/desktop.test.ts tests/unit/engine/env.test.ts`
Expected: FAIL — `io.fetch is not a function`, cannot resolve `../../../src/engine/desktop.ts`, `desktopVersion` undefined.

- [ ] **Step 3: Implement `Io.fetch`**

In `src/engine/io.ts` add after `ExecOpts`:
```ts
export interface FetchInit { method?: "GET"; headers?: Record<string, string>; timeout?: number }
export interface FetchResult { status: number; body: string }
```
Add to the `Io` interface: `fetch(url: string, init?: FetchInit): Promise<FetchResult>;`

`RealIo`:
```ts
  async fetch(url: string, init: FetchInit = {}): Promise<FetchResult> {
    try {
      const r = await globalThis.fetch(url, { method: init.method ?? "GET", headers: init.headers, signal: AbortSignal.timeout(init.timeout ?? 15_000), redirect: "manual" });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: 0, body: e instanceof Error ? (e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message) : String(e) };
    }
  }
```
`FakeIo`: fields `fetches: Array<{ url: string; init: FetchInit }> = [];` and `private fetchHandlers: Array<{ match: (url: string) => boolean; handler: (url: string, init: FetchInit) => FetchResult }> = [];`, method `onFetch(match, handler) { this.fetchHandlers.push({ match, handler }); }`, and
```ts
  async fetch(url: string, init: FetchInit = {}): Promise<FetchResult> {
    this.fetches.push({ url, init });
    for (const h of this.fetchHandlers) if (h.match(url)) return h.handler(url, init);
    return { status: 0, body: "fetch not handled" };
  }
```

- [ ] **Step 4: Implement cross-surface `selectArtifacts`**

Replace `selectArtifacts` in `src/engine/plan.ts`:
```ts
export function selectArtifacts(profile: Profile, filter: { only?: string[]; skip?: string[] } = {}): Artifact[] {
  const byId = new Map(profile.artifacts.map((a) => [a.id, a]));
  const wanted = new Set<string>();
  const pull = (a: Artifact) => {
    if (wanted.has(a.id)) return;
    wanted.add(a.id);
    for (const r of a.requires) { const dep = byId.get(r); if (dep) pull(dep); }     // an unknown id is left for resolveOrder to report
  };
  for (const a of profile.artifacts) if (a.surfaces.some((s) => profile.surfaces.includes(s))) pull(a);
  const ordered = resolveOrder(profile.artifacts.filter((a) => wanted.has(a.id)));
  return ordered.filter((a) => (!filter.only || filter.only.includes(a.id)) && !(filter.skip ?? []).includes(a.id));
}
```

- [ ] **Step 5: Implement `src/engine/desktop.ts`**

```ts
import { randomUUID } from "node:crypto";
import { pj, type Os } from "./env.ts";
import type { Io } from "./io.ts";

/** Claude Desktop on 3P — where it keeps its per-user configuration and what boot-slapper owns there. Facts from docs/spikes/2026-09-10-s1-*.md and s2-*.md. */
export const ORG_SENTINEL = "00000000-0000-4000-8000-000000000001";
export const MIN_DESKTOP_VERSION = "1.19367.0";     // managed http/sse/stdio MCP entries, static headers, helpers; registry hives no longer merged
export const ENTRY_NAME = "boot-slapper";
export const MSIX_FAMILY = "AnthropicPBC.Claude_fnn82j28hfe8t";
/** A managed source that sets only these keeps the local config library in force (docs: mdm, "Update keys and managed precedence"). */
export const APP_BEHAVIOR_KEYS: ReadonlySet<string> = new Set(["disableAutoUpdates", "autoUpdaterEnforcementHours", "updateViaUpdatesHost", "relaunchEnforcementHours", "configRecheckIntervalMinutes", "egressProxyUrl", "egressProxyPacUrl"]);
const ENTRY_ID = /^[a-f0-9-]{36}$/;
const MANAGED_PLIST = "com.anthropic.claudefordesktop.plist";

const localAppData = (io: Io, home: string) => io.env.LOCALAPPDATA ?? pj("win32", home, "AppData", "Local");

export function desktopDataDir(io: Io, os: Os, home: string): string {
  if (os === "darwin") return pj(os, home, "Library", "Application Support", "Claude-3p");
  if (os === "win32") return pj(os, localAppData(io, home), "Claude-3p");
  return pj(os, home, ".config", "Claude-3p");
}
export const configLibraryDir = (io: Io, os: Os, home: string) => pj(os, desktopDataDir(io, os, home), "configLibrary");
export const bsDir = (os: Os, home: string) => pj(os, home, ".config", "boot-slapper");
export const sidecarPath = (os: Os, home: string) => pj(os, bsDir(os, home), "desktop.json");

export interface DesktopInstall { installed: boolean; path: string; version: string | null }

export async function desktopInstall(io: Io, os: Os, home: string): Promise<DesktopInstall> {
  if (os === "darwin") {
    const app = "/Applications/Claude.app";
    if (!(await io.exists(app))) return { installed: false, path: app, version: null };
    const plist = (await io.readFile(pj(os, app, "Contents", "Info.plist"))) ?? "";
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
    return { installed: true, path: app, version: m ? m[1].trim() : null };
  }
  if (os === "win32") {
    const pkg = pj(os, localAppData(io, home), "Packages", MSIX_FAMILY);
    if (await io.exists(pkg)) {
      const r = await io.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name AnthropicPBC.Claude | Select-Object -First 1).Version"], { timeout: 20_000 });
      const v = r.code === 0 ? r.stdout.trim() : "";
      return { installed: true, path: pkg, version: /^\d+(\.\d+)+$/.test(v) ? v : null };
    }
    const legacy = pj(os, localAppData(io, home), "AnthropicClaude", "claude.exe");   // pre-MSIX .exe installer (no Cowork)
    return { installed: await io.exists(legacy), path: legacy, version: null };
  }
  const p = pj(os, home, ".local", "share", "claude-desktop");
  return { installed: await io.exists(p), path: p, version: null };
}

export function versionAtLeast(v: string | null, min: string): boolean {
  if (!v) return false;
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; }
  return true;
}

export interface ManagedSource { source: string; keys: string[] }

const plistKeys = (xml: string) => [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
const regKeys = (out: string) => out.split(/\r?\n/).map((l) => /^\s{2,}(\S+)\s+REG_[A-Z_]+\s/.exec(l)?.[1]).filter((k): k is string => !!k && k !== "(Default)");

/** Every managed source the app would read, with the keys it sets. darwin: per-user plist first (it wins). win32: HKLM only when it holds any value, else HKCU. */
export async function managedSources(io: Io, os: Os): Promise<ManagedSource[]> {
  const out: ManagedSource[] = [];
  if (os === "darwin") {
    const user = io.env.USER ?? "";
    const paths = [user ? `/Library/Managed Preferences/${user}/${MANAGED_PLIST}` : null, `/Library/Managed Preferences/${MANAGED_PLIST}`].filter((p): p is string => !!p);
    for (const p of paths) {
      if (!(await io.exists(p))) continue;
      const r = await io.exec("plutil", ["-convert", "xml1", "-o", "-", p], { timeout: 10_000 });   // managed plists are binary; plutil is read-only with -o -
      out.push({ source: p, keys: r.code === 0 ? plistKeys(r.stdout) : [] });
    }
  } else if (os === "win32") {
    for (const hive of ["HKLM", "HKCU"]) {
      const key = `${hive}\\SOFTWARE\\Policies\\Claude`;
      const r = await io.exec("reg", ["query", key], { timeout: 10_000 });
      const keys = r.code === 0 ? regKeys(r.stdout) : [];
      if (keys.length) { out.push({ source: key, keys }); break; }     // v1.19367.0+: any HKLM value makes the app ignore HKCU entirely
    }
  } else {
    const p = "/etc/claude-desktop/managed-settings.json";
    const s = await io.readFile(p);
    if (s !== null) { try { out.push({ source: p, keys: Object.keys(JSON.parse(s) as Record<string, unknown>) }); } catch { out.push({ source: p, keys: [] }); } }
  }
  return out;
}

export function managedTakeover(sources: ManagedSource[]): string | null {
  for (const s of sources) {
    const owning = s.keys.filter((k) => !APP_BEHAVIOR_KEYS.has(k));
    if (owning.length) return `${s.source} sets ${owning.join(", ")}`;
  }
  return null;
}

export async function desktopRunning(io: Io, os: Os): Promise<boolean> {
  if (os === "darwin") return (await io.exec("pgrep", ["-f", "Claude.app/Contents/MacOS/Claude"], { timeout: 10_000 })).code === 0;
  if (os === "win32") { const r = await io.exec("tasklist", ["/FI", "IMAGENAME eq Claude.exe", "/NH"], { timeout: 10_000 }); return r.code === 0 && /^Claude\.exe\b/im.test(r.stdout); }
  return (await io.exec("pgrep", ["-f", "claude-desktop"], { timeout: 10_000 })).code === 0;
}

export interface LibraryMeta { appliedId: string; entries: Array<{ id: string; name: string }> }
const metaPath = (io: Io, os: Os, home: string) => pj(os, configLibraryDir(io, os, home), "_meta.json");
const entryPath = (io: Io, os: Os, home: string, id: string) => pj(os, configLibraryDir(io, os, home), `${id}.json`);

async function readJson(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { const v = JSON.parse(s) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid"; } catch { return "invalid"; }
}

export async function readLibraryMeta(io: Io, os: Os, home: string): Promise<LibraryMeta | null | "invalid"> {
  const j = await readJson(io, metaPath(io, os, home));
  if (j === null || j === "invalid") return j;
  const entries = Array.isArray(j.entries) ? (j.entries as Array<{ id?: unknown; name?: unknown }>) : null;
  if (typeof j.appliedId !== "string" || !entries || !entries.every((e) => typeof e?.id === "string" && typeof e?.name === "string")) return "invalid";
  return { appliedId: j.appliedId, entries: entries.map((e) => ({ id: String(e.id), name: String(e.name) })) };
}

export async function readLibraryEntry(io: Io, os: Os, home: string, id: string): Promise<Record<string, unknown> | null | "invalid"> {
  if (!ENTRY_ID.test(id)) return "invalid";
  return readJson(io, entryPath(io, os, home, id));
}

export interface Sidecar { entryId?: string; servers?: string[]; skills?: Record<string, string> }

export async function readSidecar(io: Io, os: Os, home: string): Promise<Sidecar> {
  const j = await readJson(io, sidecarPath(os, home));
  return j && j !== "invalid" ? (j as Sidecar) : {};
}
export async function writeSidecar(io: Io, os: Os, home: string, patch: Partial<Sidecar>): Promise<Sidecar> {
  const next = { ...(await readSidecar(io, os, home)), ...patch };
  await io.mkdirp(bsDir(os, home), { mode: 0o700 });
  await io.writeFile(sidecarPath(os, home), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

/** Read one setting from a library document in either accepted shape: nested v2 (`$schemaVersion: 2`) or flat v1 (documented key names). */
export function cfgGet(doc: Record<string, unknown> | null, nested: string[], flat: string): unknown {
  if (!doc) return undefined;
  let cur: unknown = doc;
  for (const k of nested) { if (typeof cur !== "object" || cur === null) { cur = undefined; break; } cur = (cur as Record<string, unknown>)[k]; }
  return cur !== undefined ? cur : doc[flat];
}

export interface OurEntry { id: string; doc: Record<string, unknown>; applied: boolean }

/** The boot-slapper entry: the sidecar's id when the meta still lists it, else the entry named boot-slapper. */
export async function ourEntry(io: Io, os: Os, home: string): Promise<OurEntry | null | "invalid"> {
  const meta = await readLibraryMeta(io, os, home);
  if (meta === null || meta === "invalid") return meta;
  const side = await readSidecar(io, os, home);
  const hit = meta.entries.find((e) => e.id === side.entryId) ?? meta.entries.find((e) => e.name === ENTRY_NAME);
  if (!hit) return null;
  const doc = await readLibraryEntry(io, os, home, hit.id);
  if (doc === "invalid") return "invalid";
  return { id: hit.id, doc: doc ?? {}, applied: meta.appliedId === hit.id };
}

export const newEntryId = () => randomUUID().toLowerCase();

export async function writeLibraryEntry(io: Io, os: Os, home: string, id: string, doc: Record<string, unknown>): Promise<void> {
  await io.mkdirp(configLibraryDir(io, os, home), { mode: 0o700 });
  await io.writeFile(entryPath(io, os, home, id), JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
}

export async function upsertMeta(io: Io, os: Os, home: string, entry: { id: string; name: string }, apply: boolean): Promise<void> {
  const cur = await readLibraryMeta(io, os, home);
  if (cur === "invalid") throw new Error("configLibrary/_meta.json is not valid — fix it by hand (or delete the configLibrary directory to reset Desktop's local 3P configuration), then re-run");
  const meta: LibraryMeta = cur ?? { appliedId: "", entries: [] };
  if (!meta.entries.some((e) => e.id === entry.id)) meta.entries.push(entry);
  if (apply || !meta.appliedId) meta.appliedId = entry.id;
  await io.mkdirp(configLibraryDir(io, os, home), { mode: 0o700 });
  await io.writeFile(metaPath(io, os, home), JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
}

/** `ant-did` holds the 3P account uuid base64-encoded (docs: data-storage, "Identity"). */
export function decodeAntDid(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  const v = Buffer.from(s, "base64").toString("utf8").trim();
  return /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null;
}
```

- [ ] **Step 6: Wire `probeEnv`**

In `src/engine/env.ts`: import `desktopInstall` from `./desktop.ts`; add `desktopVersion: string | null` to `EnvProbe`; in `probeEnv` replace the `desktopInstalled` line with
```ts
  const desktop = await desktopInstall(io, os, home);
  return { os, home, hostname: io.hostname, label: await resolveLabel(io, claudeDir, os), detectedProvider: await detectProvider(io, home, os), claudeOnPath: (await io.which("claude")) !== null, desktopInstalled: desktop.installed, desktopVersion: desktop.version };
```
Keep `desktopAppPath` exported (prereqs still imports it until Task 2 replaces the call).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/unit/engine && npm run typecheck`
Expected: PASS (the `RealIo` connection-failure test needs no network — port 1 on loopback refuses).

- [ ] **Step 8: Commit**

```bash
git add src/engine/io.ts src/engine/plan.ts src/engine/env.ts src/engine/desktop.ts tests/unit/engine/io.test.ts tests/unit/engine/plan.test.ts tests/unit/engine/desktop.test.ts tests/unit/engine/env.test.ts
git commit -m "feat(engine): Io.fetch, cross-surface requires in selectArtifacts, engine/desktop.ts (3P paths, install/version, managed sources, config library)"
```

---

### Task 2: `prereqs` desktop check via `engine/desktop.ts`, and the helper-script templates

**Files:**
- Modify: `src/artifacts/prereqs.ts`, `tests/unit/artifacts/prereqs.test.ts`
- Create: `src/artifacts/templates/desktop-helpers.ts`, `tests/unit/artifacts/desktop-helpers.test.ts`

**Interfaces:**
- Consumes: `desktopInstall`, `versionAtLeast`, `MIN_DESKTOP_VERSION`, `bsDir` (Task 1); `SecretService`.
- Produces:
  - `prereqs` check `desktop`: `ok` `Claude Desktop 1.49585.0 at /Applications/Claude.app`; `ok` `Claude Desktop at <path> (version unknown)`; `warn` `Claude Desktop <v> < 1.19367.0 — update it before the desktop artifacts run`; `warn` `Claude Desktop not found at <path> — install from https://claude.com/download (Windows: the .msix package; the .exe installer has no Cowork)`.
  - `helperPath(os, home, name): string` → `<~/.config/boot-slapper>/<name>.sh` (darwin/linux) or `.ps1` (win32); `HELPER_MODE = 0o700`.
  - `renderCredentialHelper(os, service): string` — prints the secret value, nothing else.
  - `renderHeadersHelper(os, service, header, prefix): string` — prints `{"<header>":"<prefix><value>"}`.

- [ ] **Step 1: Write the failing tests**

Replace the desktop expectations in `tests/unit/artifacts/prereqs.test.ts` (keep every other case) and add:
```ts
it("desktop: version from Info.plist; too-old and missing are warns (device-bound, never blocking)", async () => {
  const plist = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
  const ok = await makeCtx({ path: tools, dirs: ["/Applications/Claude.app"], files: { "/Applications/Claude.app/Contents/Info.plist": plist } });
  expect((await prereqs.verify(ok.ctx)).find((c) => c.id === "desktop")).toEqual({ id: "desktop", status: "ok", message: "Claude Desktop 1.49585.0 at /Applications/Claude.app" });
  const old = await makeCtx({ path: tools, dirs: ["/Applications/Claude.app"], files: { "/Applications/Claude.app/Contents/Info.plist": plist.replace("1.49585.0", "1.5354.0") } });
  expect((await prereqs.verify(old.ctx)).find((c) => c.id === "desktop")).toMatchObject({ status: "warn", message: expect.stringMatching(/1\.5354\.0 < 1\.19367\.0/) });
  const none = await makeCtx({ path: tools });
  expect((await prereqs.verify(none.ctx)).find((c) => c.id === "desktop")).toMatchObject({ status: "warn", message: expect.stringMatching(/not found at \/Applications\/Claude\.app/) });
  expect(await prereqs.detect(none.ctx)).toEqual({ kind: "present" });   // desktop is warn-only for prereqs
});
```
(`tools` is the test file's existing PATH map; if it is named differently, use that name.)

Create `tests/unit/artifacts/desktop-helpers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HELPER_MODE, helperPath, renderCredentialHelper, renderHeadersHelper } from "../../../src/artifacts/templates/desktop-helpers.ts";

describe("desktop helper templates", () => {
  it("paths and mode", () => {
    expect(helperPath("darwin", "/h", "desktop-inference-credential")).toBe("/h/.config/boot-slapper/desktop-inference-credential.sh");
    expect(helperPath("win32", "C:\\Users\\t", "desktop-inference-credential")).toBe("C:\\Users\\t\\.config\\boot-slapper\\desktop-inference-credential.ps1");
    expect(HELPER_MODE).toBe(0o700);
  });
  it("darwin credential helper reads the login Keychain and prints only the value", () => {
    const s = renderCredentialHelper("darwin", "cornell-ai-gateway");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain('exec security find-generic-password -w -s cornell-ai-gateway -a "$USER"');
    expect(s).not.toMatch(/echo|printf/);
  });
  it("linux credential helper reads the FileStore file", () => {
    expect(renderCredentialHelper("linux", "cornell-ai-gateway")).toContain('exec cat "$HOME/.config/boot-slapper/secrets/cornell-ai-gateway"');
  });
  it("win32 credential helper reads PasswordVault and writes the value without a newline", () => {
    const s = renderCredentialHelper("win32", "cornell-ai-gateway");
    expect(s).toContain("$c = $v.Retrieve('cornell-ai-gateway', $env:USERNAME)");
    expect(s).toContain("[Console]::Out.Write($c.Password)");
    expect(s).toContain("$ErrorActionPreference = 'Stop'");
  });
  it("headers helpers print one flat JSON object", () => {
    const sh = renderHeadersHelper("darwin", "mecp-device-token", "Authorization", "Bearer ");
    expect(sh).toContain('t=$(security find-generic-password -w -s mecp-device-token -a "$USER") || exit 1');
    expect(sh).toContain(`printf '{"%s":"%s%s"}\\n' 'Authorization' 'Bearer ' "$t"`);
    const ps = renderHeadersHelper("win32", "mecp-device-token", "Authorization", "Bearer ");
    expect(ps).toContain("$c = $v.Retrieve('mecp-device-token', $env:USERNAME)");
    expect(ps).toContain(`[Console]::Out.Write('{"Authorization":"Bearer ' + $c.Password + '"}')`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/prereqs.test.ts tests/unit/artifacts/desktop-helpers.test.ts`
Expected: FAIL (module missing; old desktop message).

- [ ] **Step 3: Write `src/artifacts/templates/desktop-helpers.ts`**

```ts
import { bsDir } from "../../engine/desktop.ts";
import { pj, type Os } from "../../engine/env.ts";
import type { SecretService } from "../../engine/secrets/store.ts";

/** Helper executables Claude Desktop runs to obtain a credential (inferenceCredentialHelper / headersHelper).
 *  darwin/linux: POSIX sh; win32: PowerShell (Desktop runs .ps1 through powershell.exe -File). Paths must be absolute and contain no `"` or `%`. */
export const HELPER_MODE = 0o700;
export const helperPath = (os: Os, home: string, name: string) => pj(os, bsDir(os, home), `${name}${os === "win32" ? ".ps1" : ".sh"}`);

const HEAD_SH = (what: string) => `#!/bin/sh\n# ${what} — generated by boot-slapper; edits are overwritten on \`bs onboard\`.\n# Claude Desktop runs this helper to obtain the value at session start; nothing sensitive sits in a config file.\n`;
const HEAD_PS = (what: string) => `# ${what} — generated by boot-slapper; edits are overwritten on \`bs onboard\`.\n# Claude Desktop runs this helper (powershell.exe -File) to obtain the value at session start.\n$ErrorActionPreference = 'Stop'\n[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]\n$v = New-Object Windows.Security.Credentials.PasswordVault\n`;

const readSh = (os: Os, service: SecretService) =>
  os === "darwin" ? `security find-generic-password -w -s ${service} -a "$USER"` : `cat "$HOME/.config/boot-slapper/secrets/${service}"`;

/** Prints the secret's value and nothing else (Desktop reads stdout as a bare token). */
export function renderCredentialHelper(os: Os, service: SecretService): string {
  if (os === "win32") return HEAD_PS(`${service} credential helper`) + `$c = $v.Retrieve('${service}', $env:USERNAME); $c.RetrievePassword()\n[Console]::Out.Write($c.Password)\n`;
  return HEAD_SH(`${service} credential helper`) + `exec ${readSh(os, service)}\n`;
}

/** Prints a flat JSON header map (Desktop's headersHelper contract). The value is not JSON-escaped: every service here issues URL-safe tokens. */
export function renderHeadersHelper(os: Os, service: SecretService, header: string, prefix: string): string {
  if (os === "win32") return HEAD_PS(`${service} headers helper`) + `$c = $v.Retrieve('${service}', $env:USERNAME); $c.RetrievePassword()\n[Console]::Out.Write('{"${header}":"${prefix}' + $c.Password + '"}')\n`;
  return HEAD_SH(`${service} headers helper`) + `t=$(${readSh(os, service)}) || exit 1\n[ -n "$t" ] || exit 1\nprintf '{"%s":"%s%s"}\\n' '${header}' '${prefix}' "$t"\n`;
}
```

- [ ] **Step 4: Update `prereqs.ts`**

Replace the `desktopAppPath` import with `import { desktopInstall, MIN_DESKTOP_VERSION, versionAtLeast } from "../engine/desktop.ts";` and the desktop check with:
```ts
  const d = await desktopInstall(io, env.os, env.home);
  if (!d.installed) out.push({ id: "desktop", status: "warn", message: `Claude Desktop not found at ${d.path} — install from https://claude.com/download (Windows: the .msix package; the .exe installer has no Cowork)` });
  else if (d.version && !versionAtLeast(d.version, MIN_DESKTOP_VERSION)) out.push({ id: "desktop", status: "warn", message: `Claude Desktop ${d.version} < ${MIN_DESKTOP_VERSION} — update it before the desktop artifacts run` });
  else out.push({ id: "desktop", status: "ok", message: d.version ? `Claude Desktop ${d.version} at ${d.path}` : `Claude Desktop at ${d.path} (version unknown)` });
```
Update the `capture` instruction line to: `"Claude Desktop ≥ 1.19367.0 — https://claude.com/download (macOS .dmg; Windows .msix)"`. Delete `desktopAppPath` from `env.ts` if nothing else imports it (`grep -rn desktopAppPath src tests`).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/artifacts/prereqs.test.ts tests/unit/artifacts/desktop-helpers.test.ts tests/unit/engine && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/prereqs.ts src/artifacts/templates/desktop-helpers.ts src/engine/env.ts tests/unit/artifacts/prereqs.test.ts tests/unit/artifacts/desktop-helpers.test.ts
git commit -m "feat(prereqs,templates): MSIX-aware Desktop check with version floor; credential and headers helper templates (.sh/.ps1)"
```

---

### Task 3: `desktop-inference` artifact (spec §4 row 8, per S1)

**Files:**
- Create: `src/artifacts/desktop-inference.ts`, `tests/unit/artifacts/desktop-inference.test.ts`

**Interfaces:**
- Consumes: everything Task 1 exports from `engine/desktop.ts`; `helperPath`, `renderCredentialHelper`, `HELPER_MODE` (Task 2); `Io.fetch`; `defaultAccount`; `deepEqual` from `engine/settings.ts`.
- Produces:
  - `export const desktopInference: Artifact` — `id: "desktop-inference"`, `surfaces: ["desktop"]`, `portability: "translatable"`, `requires: ["prereqs", "secrets"]`.
  - Options `interface Opts { baseUrl: string; authScheme?: "bearer" | "x-api-key" }`.
  - `export function wantedDoc(o: Opts, helper: string): Record<string, unknown>` — the nested v2 document boot-slapper owns (Task 4 merges `mcp.managedServers` into the same entry, so it must not touch the keys below):
    ```json
    { "$schemaVersion": 2,
      "inference": { "provider": "gateway", "baseUrl": "<baseUrl>", "credential": { "kind": "helper-script", "command": "<helper>", "ttlSec": 3600, "authScheme": "bearer" } },
      "models": { "discoveryEnabled": true },
      "telemetry": { "disableNonessential": true, "disableNonessentialServices": true } }
    ```
  - `export const D = { helper: "credential helper absent or stale", entry: "no boot-slapper entry", stale: "boot-slapper entry differs", notApplied: "boot-slapper entry is not the applied configuration", running: "Claude Desktop is running" } as const` (detect → plan channel).
  - `export const HELPER_NAME = "desktop-inference-credential"`.
  - Step ids: `desktop-inference.helper`, `desktop-inference.entry`, `desktop-inference.apply-entry`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/artifacts/desktop-inference.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { D, desktopInference, wantedDoc } from "../../../src/artifacts/desktop-inference.ts";
import { ENTRY_NAME } from "../../../src/engine/desktop.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { baseUrl: "https://api.ai.it.cornell.edu" };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const L = "/h/Library/Application Support/Claude-3p/configLibrary";
const HELPER = "/h/.config/boot-slapper/desktop-inference-credential.sh";
const box = (extra: Record<string, string> = {}) => makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, ...extra } });
const secrets = (io: FakeIo, present = true) => io.on((c, a) => c === "security" && a[0] === "find-generic-password", () => present ? { code: 0, stdout: "s3cr3t-val\n", stderr: "" } : { code: 44, stdout: "", stderr: "" });
const leak = (io: FakeIo, events: unknown[]) => JSON.stringify([...io.files.values(), ...events]).includes("s3cr3t-val");

describe("desktop-inference (darwin)", () => {
  it("fresh box: absent → helper + entry + apply; files are owner-only; second detect is present; nothing leaks", async () => {
    const { ctx, io, events } = await box(); secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.helper} — will write ${HELPER}`, `${D.entry} — will add an entry named '${ENTRY_NAME}' and apply it (existing entries untouched)`] });
    expect(io.writes).toEqual([]);
    const steps = desktopInference.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-inference.helper", "desktop-inference.entry", "desktop-inference.apply-entry"]);
    await desktopInference.apply(ctx, steps);
    expect(io.modes.get(HELPER)).toBe(0o700);
    expect(io.files.get(HELPER)).toContain("security find-generic-password -w -s cornell-ai-gateway");
    const meta = JSON.parse(io.files.get(`${L}/_meta.json`)!);
    expect(meta.entries).toEqual([{ id: meta.appliedId, name: ENTRY_NAME }]);
    expect(meta.appliedId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.parse(io.files.get(`${L}/${meta.appliedId}.json`)!)).toEqual(wantedDoc(opts, HELPER));
    expect(io.modes.get(`${L}/${meta.appliedId}.json`)).toBe(0o600);
    expect(JSON.parse(io.files.get("/h/.config/boot-slapper/desktop.json")!)).toEqual({ entryId: meta.appliedId });
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
    expect(desktopInference.plan(ctx, { kind: "present" })).toEqual([]);
    expect(leak(io, events)).toBe(false);
  });

  it("a foreign applied entry that already satisfies the profile is adopted read-only", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const { ctx, io } = await box({
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: "Default" }] }),
      [`${L}/${id}.json`]: JSON.stringify({ $schemaVersion: 2, inference: { provider: "gateway", baseUrl: "https://api.ai.it.cornell.edu/", credential: { kind: "static", apiKey: "x" } } }),
      [HELPER]: "stale",
    });
    secrets(io);
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
    expect((await desktopInference.verify(ctx)).find((c) => c.id === "entry")).toEqual({ id: "entry", status: "ok", message: "adopted the applied configuration 'Default' (gateway, https://api.ai.it.cornell.edu/) — not managed by boot-slapper" });
    expect(io.writes).toEqual([]);
  });

  it("a foreign applied entry for something else is left alone: ours is added beside it and becomes the applied one", async () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const foreign = JSON.stringify({ inferenceProvider: "anthropic", inferenceAnthropicApiKey: "k" });
    const { ctx, io } = await box({ [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: "Default" }] }), [`${L}/${id}.json`]: foreign });
    secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s.kind).toBe("absent");
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    const meta = JSON.parse(io.files.get(`${L}/_meta.json`)!);
    expect(meta.entries.map((e: { name: string }) => e.name)).toEqual(["Default", ENTRY_NAME]);
    expect(meta.appliedId).not.toBe(id);
    expect(io.files.get(`${L}/${id}.json`)).toBe(foreign);
  });

  it("our entry keeps keys other artifacts or the user put there; only the owned keys are rewritten; not-applied is a single step", async () => {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const doc = { ...wantedDoc(opts, HELPER), mcp: { managedServers: [{ name: "mecp", transport: "http", url: "https://mecp/mcp" }] }, workspace: { autoModeEnabled: true } };
    const { ctx, io } = await box({
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: other, entries: [{ id: other, name: "Default" }, { id, name: ENTRY_NAME }] }),
      [`${L}/${id}.json`]: JSON.stringify(doc), [`${L}/${other}.json`]: "{}",
      [HELPER]: "stale", "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: id }),
    });
    secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: [`${D.helper} — will write ${HELPER}`, `${D.notApplied} — will apply it`] });
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    expect(JSON.parse(io.files.get(`${L}/_meta.json`)!).appliedId).toBe(id);
    expect(JSON.parse(io.files.get(`${L}/${id}.json`)!)).toEqual(doc);          // untouched: it already matched
    // now drift the owned keys
    io.files.set(`${L}/${id}.json`, JSON.stringify({ ...doc, inference: { provider: "gateway", baseUrl: "https://old" } }));
    const s2 = await desktopInference.detect(ctx);
    expect(s2).toEqual({ kind: "drifted", details: [`${D.stale} — will rewrite the inference/models/telemetry keys`] });
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s2));
    expect(JSON.parse(io.files.get(`${L}/${id}.json`)!)).toEqual(doc);
  });

  it("blocked: not installed, too old, or a managed source owns the configuration", async () => {
    const none = await makeCtx({ opts, env: { USER: "aca34" } });
    expect(await desktopInference.detect(none.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/not installed/) });
    const old = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST.replace("1.49585.0", "1.5354.0") } });
    expect(await desktopInference.detect(old.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/1\.5354\.0 < 1\.19367\.0/) });
    const managed = await box({ "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist" });
    managed.io.on((c) => c === "plutil", () => ({ code: 0, stdout: "<plist><dict><key>disableAutoUpdates</key><true/><key>inferenceProvider</key><string>vertex</string></dict></plist>", stderr: "" }));
    expect(await desktopInference.detect(managed.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/managed configuration owns Claude Desktop \(\/Library\/Managed Preferences\/com\.anthropic\.claudefordesktop\.plist sets inferenceProvider\).*Configure Third-Party Inference/) });
    const behaviorOnly = await box({ "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist" });
    behaviorOnly.io.on((c) => c === "plutil", () => ({ code: 0, stdout: "<plist><dict><key>disableAutoUpdates</key><true/></dict></plist>", stderr: "" }));
    expect((await desktopInference.detect(behaviorOnly.ctx)).kind).toBe("absent");
  });

  it("apply refuses to touch the library while Desktop is running; the helper step still runs", async () => {
    const { ctx, io } = await box(); secrets(io);
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "2590\n", stderr: "" }));
    const s = await desktopInference.detect(ctx);
    expect(s.details).toContain(`${D.running} — quit it before applying (the configuration is read at launch)`);
    const steps = desktopInference.plan(ctx, s);
    await desktopInference.apply(ctx, [steps[0]]);
    expect(io.files.has(HELPER)).toBe(true);
    await expect(desktopInference.apply(ctx, [steps[1]])).rejects.toThrow(/Claude Desktop is running — quit it/);
    expect(io.files.has(`${L}/_meta.json`)).toBe(false);
  });

  it("verify: probes GET <base>/v1/models with the stored key in-process; statuses map to ok/error/warn; the key never appears", async () => {
    const { ctx, io, events } = await box(); secrets(io);
    await desktopInference.apply(ctx, desktopInference.plan(ctx, await desktopInference.detect(ctx)));
    io.onFetch((u) => u === "https://api.ai.it.cornell.edu/v1/models", (_u, init) => init.headers?.Authorization === "Bearer s3cr3t-val" ? { status: 200, body: JSON.stringify({ data: [{ id: "claude-sonnet-5" }, { id: "claude-opus-5" }] }) } : { status: 401, body: "" });
    const ok = Object.fromEntries((await desktopInference.verify(ctx)).map((c) => [c.id, c]));
    expect(ok.installed).toMatchObject({ status: "ok" }); expect(ok.version).toMatchObject({ status: "ok" }); expect(ok.managed).toMatchObject({ status: "ok" });
    expect(ok.entry).toMatchObject({ status: "ok", message: expect.stringMatching(/boot-slapper entry applied/) });
    expect(ok.helper).toMatchObject({ status: "ok" }); expect(ok.secret).toMatchObject({ status: "ok" });
    expect(ok.models).toEqual({ id: "models", status: "ok", message: "gateway https://api.ai.it.cornell.edu lists 2 model(s)" });
    expect(io.fetches).toHaveLength(1);
    expect(io.writes.filter((w) => !w.startsWith("/h/.config/boot-slapper") && !w.startsWith(L))).toEqual([]);
    io.fetches.length = 0; io.onFetch(() => true, () => ({ status: 401, body: "" }));
    expect((await desktopInference.verify(ctx)).find((c) => c.id === "models")).toMatchObject({ status: "error", message: expect.stringMatching(/rejected the stored key \(HTTP 401\)/) });
    const down = await box(); secrets(down.io);
    expect((await desktopInference.verify(down.ctx)).find((c) => c.id === "models")).toMatchObject({ status: "warn", message: expect.stringMatching(/unreachable/) });
    const nokey = await box(); secrets(nokey.io, false);
    const nk = Object.fromEntries((await desktopInference.verify(nokey.ctx)).map((c) => [c.id, c.status]));
    expect(nk.secret).toBe("error"); expect(nk.models).toBe("warn");
    expect(leak(io, events)).toBe(false);
    expect(JSON.stringify(await desktopInference.verify(ctx))).not.toContain("s3cr3t-val");
  });
});

describe("desktop-inference (win32)", () => {
  it("MSIX install, .ps1 helper, LOCALAPPDATA library, reg-query managed probe", async () => {
    const home = "C:\\Users\\t"; const lad = `${home}\\AppData\\Local`;
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t", LOCALAPPDATA: lad }, dirs: [`${lad}\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`] });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "1.49585.0\r\n", stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    io.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 1, stdout: "", stderr: "" }));
    io.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 1, stdout: "", stderr: "" }));
    const s = await desktopInference.detect(ctx);
    expect(s.kind).toBe("absent");
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    const helper = `${home}\\.config\\boot-slapper\\desktop-inference-credential.ps1`;
    expect(io.files.get(helper)).toContain("$c = $v.Retrieve('cornell-ai-gateway', $env:USERNAME)");
    const meta = JSON.parse(io.files.get(`${lad}\\Claude-3p\\configLibrary\\_meta.json`)!);
    const doc = JSON.parse(io.files.get(`${lad}\\Claude-3p\\configLibrary\\${meta.appliedId}.json`)!);
    expect(doc.inference.credential.command).toBe(helper);
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/desktop-inference.test.ts`
Expected: FAIL — cannot resolve `../../../src/artifacts/desktop-inference.ts`.

- [ ] **Step 3: Write `src/artifacts/desktop-inference.ts`**

```ts
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import {
  bsDir, cfgGet, desktopInstall, desktopRunning, managedSources, managedTakeover, MIN_DESKTOP_VERSION, newEntryId, ourEntry, readLibraryMeta, readLibraryEntry,
  upsertMeta, versionAtLeast, writeLibraryEntry, writeSidecar, ENTRY_NAME, type DesktopInstall, type OurEntry,
} from "../engine/desktop.ts";
import { defaultAccount } from "../engine/secrets/store.ts";
import { deepEqual } from "../engine/settings.ts";
import { HELPER_MODE, helperPath, renderCredentialHelper } from "./templates/desktop-helpers.ts";

const ID = "desktop-inference";
export const HELPER_NAME = "desktop-inference-credential";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { baseUrl: string; authScheme?: "bearer" | "x-api-key" }

export const D = {
  helper: "credential helper absent or stale", entry: "no boot-slapper entry", stale: "boot-slapper entry differs",
  notApplied: "boot-slapper entry is not the applied configuration", running: "Claude Desktop is running",
} as const;
const SECRET = "cornell-ai-gateway" as const;
const trimSlash = (u: string) => u.replace(/\/+$/, "");
const RUNNING_ERR = "Claude Desktop is running — quit it (⌘Q / File → Exit) and re-run bs onboard --only desktop-inference";

/** The nested v2 document boot-slapper owns. desktop-mcp adds `mcp.managedServers` to the same entry; keys outside these three are never touched here. */
export function wantedDoc(o: Opts, helper: string): Record<string, unknown> {
  return {
    $schemaVersion: 2,
    inference: { provider: "gateway", baseUrl: o.baseUrl, credential: { kind: "helper-script", command: helper, ttlSec: 3600, authScheme: o.authScheme ?? "bearer" } },
    models: { discoveryEnabled: true },
    telemetry: { disableNonessential: true, disableNonessentialServices: true },
  };
}
const OWNED = ["$schemaVersion", "inference"] as const;
function merged(existing: Record<string, unknown>, wanted: Record<string, unknown>): Record<string, unknown> {
  const models = { ...((existing.models as Record<string, unknown>) ?? {}), ...(wanted.models as Record<string, unknown>) };
  const telemetry = { ...((existing.telemetry as Record<string, unknown>) ?? {}), ...(wanted.telemetry as Record<string, unknown>) };
  const out: Record<string, unknown> = { ...existing, models, telemetry };
  for (const k of OWNED) out[k] = wanted[k];
  return out;
}

interface Facts {
  install: DesktopInstall; versionOld: boolean; takeover: string | null; managedKeys: number; running: boolean;
  ours: OurEntry | null | "invalid"; adopted: { name: string; baseUrl: string } | null;
  helper: string; helperBody: string; helperCurrent: boolean; wanted: Record<string, unknown>; docCurrent: boolean;
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const install = await desktopInstall(io, env.os, env.home);
  const sources = install.installed ? await managedSources(io, env.os) : [];
  const helper = helperPath(env.os, env.home, HELPER_NAME);
  const helperBody = renderCredentialHelper(env.os, SECRET);
  const wanted = wantedDoc(o, helper);
  const ours = install.installed ? await ourEntry(io, env.os, env.home) : null;
  let adopted: Facts["adopted"] = null;
  const meta = install.installed ? await readLibraryMeta(io, env.os, env.home) : null;
  if (meta && meta !== "invalid" && !(ours && ours !== "invalid" && ours.applied)) {
    const applied = meta.entries.find((e) => e.id === meta.appliedId);
    const doc = applied ? await readLibraryEntry(io, env.os, env.home, applied.id) : null;
    if (applied && doc && doc !== "invalid" && cfgGet(doc, ["inference", "provider"], "inferenceProvider") === "gateway") {
      const base = String(cfgGet(doc, ["inference", "baseUrl"], "inferenceGatewayBaseUrl") ?? "");
      const cred = cfgGet(doc, ["inference", "credential", "kind"], "inferenceCredentialKind") ?? doc.inferenceGatewayApiKey ?? doc.inferenceCredentialHelper;
      if (trimSlash(base) === trimSlash(o.baseUrl) && cred !== undefined && applied.name !== ENTRY_NAME) adopted = { name: applied.name, baseUrl: base };
    }
  }
  const docCurrent = ours !== null && ours !== "invalid" && deepEqual(merged(ours.doc, wanted), ours.doc);
  return {
    install, versionOld: install.version !== null && !versionAtLeast(install.version, MIN_DESKTOP_VERSION),
    takeover: managedTakeover(sources), managedKeys: sources.reduce((n, s) => n + s.keys.length, 0),
    running: install.installed ? await desktopRunning(io, env.os) : false,
    ours, adopted, helper, helperBody, helperCurrent: (await io.readFile(helper)) === helperBody, wanted, docCurrent,
  };
}

function blockedReason(f: Facts, o: Opts): string | null {
  if (!f.install.installed) return `Claude Desktop not installed — https://claude.com/download (macOS .dmg; Windows .msix — the .exe installer has no Cowork)`;
  if (f.versionOld) return `Claude Desktop ${f.install.version} < ${MIN_DESKTOP_VERSION} — update it, then re-run`;
  if (f.takeover) return `managed configuration owns Claude Desktop (${f.takeover}) — the local config library is ignored. Ask IT for the gateway profile, or check Developer → Configure Third-Party Inference… (read-only there): provider gateway, base URL ${o.baseUrl}, credential via bs secrets check ${SECRET}`;
  if (f.ours === "invalid") return "a boot-slapper config-library entry or _meta.json is not valid JSON — fix or delete it by hand, then re-run";
  return null;
}

export const desktopInference: Artifact = {
  id: ID, surfaces: ["desktop"], portability: "translatable", requires: ["prereqs", "secrets"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts;
    const blocked = blockedReason(f, o);
    if (blocked) return { kind: "blocked", reason: blocked };
    if (f.adopted) return { kind: "present" };
    const details: string[] = [];
    if (!f.helperCurrent) details.push(`${D.helper} — will write ${f.helper}`);
    if (f.ours === null) details.push(`${D.entry} — will add an entry named '${ENTRY_NAME}' and apply it (existing entries untouched)`);
    else if (f.ours !== "invalid") {
      if (!f.docCurrent) details.push(`${D.stale} — will rewrite the inference/models/telemetry keys`);
      if (!f.ours.applied) details.push(`${D.notApplied} — will apply it`);
    }
    if (details.length && f.running) details.push(`${D.running} — quit it before applying (the configuration is read at launch)`);
    if (!details.length) return { kind: "present" };
    return f.ours === null ? { kind: "absent", details } : { kind: "drifted", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith(D.helper))) steps.push(step("helper", "write the gateway credential helper for Claude Desktop"));
    if (d.some((x) => x.startsWith(D.entry) || x.startsWith(D.stale))) steps.push(step("entry", `write the '${ENTRY_NAME}' configuration entry (gateway + credential helper)`));
    if (d.some((x) => x.startsWith(D.entry) || x.startsWith(D.notApplied))) steps.push(step("apply-entry", `make '${ENTRY_NAME}' the applied Claude Desktop configuration`));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.helper`: {
          const f = await facts(ctx);
          await io.mkdirp(bsDir(env.os, env.home), { mode: 0o700 });
          await io.writeFile(f.helper, f.helperBody, { mode: HELPER_MODE });
          break;
        }
        case `${ID}.entry`: {
          const f = await facts(ctx);
          if (f.running) throw new Error(RUNNING_ERR);
          if (f.ours === "invalid") throw new Error("boot-slapper entry is not valid JSON — fix or delete it by hand, then re-run");
          const id = f.ours?.id ?? newEntryId();
          await writeLibraryEntry(io, env.os, env.home, id, f.ours ? merged(f.ours.doc, f.wanted) : f.wanted);
          await upsertMeta(io, env.os, env.home, { id, name: ENTRY_NAME }, false);
          await writeSidecar(io, env.os, env.home, { entryId: id });
          ctx.emit({ type: "note", level: "info", message: `${ID}: ${f.ours ? "rewrote" : "added"} config-library entry '${ENTRY_NAME}' (${id})` });
          break;
        }
        case `${ID}.apply-entry`: {
          const f = await facts(ctx);
          if (f.running) throw new Error(RUNNING_ERR);
          if (!f.ours || f.ours === "invalid") throw new Error("no boot-slapper entry — the entry step must run first");
          await upsertMeta(io, env.os, env.home, { id: f.ours.id, name: ENTRY_NAME }, true);
          ctx.emit({ type: "note", level: "info", message: `${ID}: '${ENTRY_NAME}' is now the applied configuration — relaunch Claude Desktop and choose the third-party option on the sign-in screen` });
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts; const out: Check[] = [];
    if (!f.install.installed) { out.push({ id: "installed", status: "error", message: `Claude Desktop not installed (${f.install.path}) — https://claude.com/download` }); return out; }
    out.push({ id: "installed", status: "ok", message: `Claude Desktop at ${f.install.path}` });
    out.push(f.versionOld ? { id: "version", status: "error", message: `Claude Desktop ${f.install.version} < ${MIN_DESKTOP_VERSION}` }
      : f.install.version ? { id: "version", status: "ok", message: `Claude Desktop ${f.install.version} (≥ ${MIN_DESKTOP_VERSION})` } : { id: "version", status: "warn", message: "Claude Desktop version unknown — Help → Troubleshooting → Copy Managed Configuration Report shows it" });
    out.push(f.takeover ? { id: "managed", status: "error", message: `managed configuration owns Claude Desktop: ${f.takeover} — local settings are ignored` }
      : { id: "managed", status: "ok", message: f.managedKeys ? `no managed takeover (${f.managedKeys} app-behavior key(s) managed by MDM)` : "no managed configuration present" });
    if (f.adopted) out.push({ id: "entry", status: "ok", message: `adopted the applied configuration '${f.adopted.name}' (gateway, ${f.adopted.baseUrl}) — not managed by boot-slapper` });
    else if (f.ours && f.ours !== "invalid" && f.ours.applied && f.docCurrent) out.push({ id: "entry", status: "ok", message: `boot-slapper entry applied (${f.ours.id}) — gateway ${o.baseUrl}, credential helper` });
    else out.push({ id: "entry", status: "error", message: f.ours === "invalid" ? "boot-slapper config-library entry is not valid JSON" : `Claude Desktop is not configured for the gateway — run bs onboard --only ${ID}` });
    if (!f.adopted) out.push(f.helperCurrent ? { id: "helper", status: "ok", message: `credential helper current: ${f.helper}` } : { id: "helper", status: "error", message: `credential helper missing or stale: ${f.helper} — run bs onboard` });
    const ref = { service: SECRET, account: defaultAccount(ctx.io) };
    const key = await ctx.secrets.get(ref);
    out.push(key !== null ? { id: "secret", status: "ok", message: `gateway key present (${ctx.secrets.describe(ref)})` } : { id: "secret", status: "error", message: `gateway key missing — bs secrets set ${SECRET}` });
    if (key === null) { out.push({ id: "models", status: "warn", message: "gateway not probed — no key in the store" }); return out; }
    const url = `${trimSlash(o.baseUrl)}/v1/models`;
    const headers = (o.authScheme ?? "bearer") === "bearer" ? { Authorization: `Bearer ${key}` } : { "x-api-key": key };   // in-process only; never logged
    const r = await ctx.io.fetch(url, { headers, timeout: 15_000 });
    if (r.status === 200) {
      let n = -1; try { const j = JSON.parse(r.body) as { data?: unknown[] }; n = Array.isArray(j.data) ? j.data.length : -1; } catch { n = -1; }
      out.push(n >= 0 ? { id: "models", status: "ok", message: `gateway ${trimSlash(o.baseUrl)} lists ${n} model(s)` } : { id: "models", status: "warn", message: `gateway ${trimSlash(o.baseUrl)} answered 200 without a model list — set inferenceModels by hand if the picker is empty` });
    } else if (r.status === 401 || r.status === 403) out.push({ id: "models", status: "error", message: `gateway rejected the stored key (HTTP ${r.status}) — bs secrets set ${SECRET}` });
    else if (r.status === 0) out.push({ id: "models", status: "warn", message: `gateway unreachable: ${r.body.slice(0, 120)}` });
    else out.push({ id: "models", status: "warn", message: `gateway answered HTTP ${r.status} to GET /v1/models — model discovery may not work; set inferenceModels by hand` });
    return out;
  },

  async capture(): Promise<Bundle> {
    return { files: [], instructions: [`${ID}: regenerated on the target by bs onboard (config entry + credential helper); the gateway key comes from bs secrets set ${SECRET}`] };
  },
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/artifacts/desktop-inference.test.ts && npm run typecheck`
Expected: PASS. If the "adopted" test fails on `writes`, check that `facts()` only reads (it must not call `writeSidecar`).

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/desktop-inference.ts tests/unit/artifacts/desktop-inference.test.ts
git commit -m "feat(artifacts): desktop-inference — Claude Desktop 3P gateway config in the per-user config library with a credential helper (S1)"
```

---

### Task 4: `desktop-mcp` artifact (spec §4 row 9, per S2)

**Files:**
- Create: `src/artifacts/desktop-mcp.ts`, `tests/unit/artifacts/desktop-mcp.test.ts`

**Interfaces:**
- Consumes: `ourEntry`, `writeLibraryEntry`, `readSidecar`, `writeSidecar`, `desktopRunning`, `desktopInstall`, `versionAtLeast`, `MIN_DESKTOP_VERSION` (Task 1); `helperPath`, `renderHeadersHelper`, `HELPER_MODE` (Task 2); `defaultAccount`; `deepEqual`.
- Produces:
  - `export const desktopMcp: Artifact` — `id: "desktop-mcp"`, `surfaces: ["desktop"]`, `portability: "translatable"`, `requires: ["desktop-inference", "claude-config"]` (the URLs come from the tracked `~/.claude/mcp/gateway.json`).
  - Options `interface Opts { mcpBundle?: string; tokens: Record<string, SecretService> }` — `tokens` maps the `${VAR}` placeholder found in a bundle entry's `Authorization` header to the `SecretStore` service that holds it (profile: `{ MECP_DEVICE_TOKEN: "mecp-device-token" }`).
  - `export function wantedServers(bundle: BundleDoc, o: Opts, os: Os, home: string): { servers: ManagedServer[]; helpers: Array<{ path: string; body: string }> }` where `interface ManagedServer { name: string; transport: "http" | "sse"; url: string; oauth?: true; headersHelper?: string; headersHelperTtlSec?: number }` and `type BundleDoc = { mcpServers?: Record<string, { type?: string; url?: string; headers?: Record<string, string> }> }`. Rules: entries with `url` and `type` `http` (or `streamable-http`) → `transport: "http"`; `type: "sse"` → `"sse"`; entries without `url` are skipped with a note. An `Authorization` header whose value matches `/\$\{([A-Z0-9_]+)\}/` and whose variable is in `opts.tokens` → `headersHelper: <helperPath(os, home, "desktop-mcp-<name>-headers")>` + `headersHelperTtlSec: 3600`, helper body `renderHeadersHelper(os, service, "Authorization", <text before the placeholder>)`; an `Authorization` header without a known placeholder → skipped with a warn note (never copy a literal token); no `Authorization` → `oauth: true`.
  - `export const D = { helper: "headers helper absent or stale:", servers: "managed MCP servers differ:", entry: "no boot-slapper entry", running: "Claude Desktop is running" } as const`.
  - Step ids: `desktop-mcp.helpers`, `desktop-mcp.servers`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/artifacts/desktop-mcp.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { desktopMcp, wantedServers } from "../../../src/artifacts/desktop-mcp.ts";
import { wantedDoc } from "../../../src/artifacts/desktop-inference.ts";
import { ENTRY_NAME } from "../../../src/engine/desktop.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { tokens: { MECP_DEVICE_TOKEN: "mecp-device-token" as const } };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const L = "/h/Library/Application Support/Claude-3p/configLibrary";
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INF = "/h/.config/boot-slapper/desktop-inference-credential.sh";
const HELPER = "/h/.config/boot-slapper/desktop-mcp-mecp-headers.sh";
const bundle = { mcpServers: { openbrain: { type: "http", url: "https://ob/mcp" }, mecp: { type: "http", url: "https://mecp/mcp", headers: { Authorization: "Bearer ${MECP_DEVICE_TOKEN}" } } } };
const box = (extra: Record<string, string> = {}, entry: Record<string, unknown> = wantedDoc({ baseUrl: "https://gw" }, INF)) => makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: {
  [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/mcp/gateway.json": JSON.stringify(bundle),
  [`${L}/_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }), [`${L}/${ID}.json`]: JSON.stringify(entry),
  "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: ID }), ...extra,
} });
const secrets = (io: FakeIo) => io.on((c) => c === "security", () => ({ code: 0, stdout: "s3cr3t-val\n", stderr: "" }));
const expectedServers = [
  { name: "openbrain", transport: "http", url: "https://ob/mcp", oauth: true },
  { name: "mecp", transport: "http", url: "https://mecp/mcp", headersHelper: HELPER, headersHelperTtlSec: 3600 },
];

describe("desktop-mcp", () => {
  it("wantedServers maps the gateway bundle: OAuth for header-less entries, a headers helper for ${TOKEN} placeholders, skips the rest", () => {
    const w = wantedServers(bundle, opts, "darwin", "/h");
    expect(w.servers).toEqual(expectedServers);
    expect(w.helpers).toEqual([{ path: HELPER, body: expect.stringContaining("mecp-device-token") }]);
    const odd = wantedServers({ mcpServers: { a: { type: "http", url: "https://a", headers: { Authorization: "Bearer literal" } }, b: { type: "stdio" }, c: { type: "sse", url: "https://c" } } }, opts, "darwin", "/h");
    expect(odd.servers).toEqual([{ name: "c", transport: "sse", url: "https://c", oauth: true }]);
  });

  it("fresh: absent → helper + servers written into the boot-slapper entry; other keys untouched; then present", async () => {
    const { ctx, io, events } = await box(); secrets(io);
    const s = await desktopMcp.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`headers helper absent or stale: mecp — will write ${HELPER}`, "managed MCP servers differ: openbrain, mecp — will write them into the boot-slapper entry"] });
    const steps = desktopMcp.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-mcp.helpers", "desktop-mcp.servers"]);
    await desktopMcp.apply(ctx, steps);
    expect(io.modes.get(HELPER)).toBe(0o700);
    const doc = JSON.parse(io.files.get(`${L}/${ID}.json`)!);
    expect(doc.mcp).toEqual({ managedServers: expectedServers });
    expect(doc.inference).toEqual(wantedDoc({ baseUrl: "https://gw" }, INF).inference);
    expect(JSON.parse(io.files.get("/h/.config/boot-slapper/desktop.json")!)).toEqual({ entryId: ID, servers: ["openbrain", "mecp"] });
    expect(await desktopMcp.detect(ctx)).toEqual({ kind: "present" });
    expect(JSON.stringify([...io.files.values(), ...events])).not.toContain("s3cr3t-val");
  });

  it("foreign managed servers in our entry are preserved; ours are updated in place; a removed bundle entry is dropped from ours only", async () => {
    const entry = { ...wantedDoc({ baseUrl: "https://gw" }, INF), mcp: { managedServers: [{ name: "corp", transport: "http", url: "https://corp" }, { name: "mecp", transport: "http", url: "https://old/mcp", headersHelper: HELPER, headersHelperTtlSec: 3600 }] } };
    const { ctx, io } = await box({ "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: ID, servers: ["mecp", "gone"] }), [HELPER]: "stale" }, entry);
    secrets(io);
    const s = await desktopMcp.detect(ctx);
    expect(s.kind).toBe("drifted");
    await desktopMcp.apply(ctx, desktopMcp.plan(ctx, s));
    const doc = JSON.parse(io.files.get(`${L}/${ID}.json`)!);
    expect(doc.mcp.managedServers).toEqual([{ name: "corp", transport: "http", url: "https://corp" }, ...expectedServers]);
  });

  it("blocked without a boot-slapper entry (desktop-inference first), without the bundle, or while Desktop runs at apply time", async () => {
    const noEntry = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/mcp/gateway.json": JSON.stringify(bundle) } });
    expect(await desktopMcp.detect(noEntry.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/desktop-inference/) });
    const noBundle = await box({ "/h/.claude/mcp/gateway.json": "" });
    noBundle.io.files.delete("/h/.claude/mcp/gateway.json");
    expect(await desktopMcp.detect(noBundle.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/gateway\.json/) });
    const { ctx, io } = await box(); secrets(io);
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "1\n", stderr: "" }));
    const steps = desktopMcp.plan(ctx, await desktopMcp.detect(ctx));
    await expect(desktopMcp.apply(ctx, [steps[1]])).rejects.toThrow(/Claude Desktop is running/);
  });

  it("verify: entry servers, helper files, secrets present, version floor; messages never carry a token", async () => {
    const { ctx, io } = await box(); secrets(io);
    await desktopMcp.apply(ctx, desktopMcp.plan(ctx, await desktopMcp.detect(ctx)));
    const c = Object.fromEntries((await desktopMcp.verify(ctx)).map((x) => [x.id, x]));
    expect(c["server.openbrain"]).toMatchObject({ status: "ok", message: expect.stringMatching(/oauth/) });
    expect(c["server.mecp"]).toMatchObject({ status: "ok", message: expect.stringMatching(/headers helper/) });
    expect(c["secret.mecp"]).toMatchObject({ status: "ok" });
    expect(c.version).toMatchObject({ status: "ok" });
    io.files.set(`${L}/${ID}.json`, JSON.stringify(wantedDoc({ baseUrl: "https://gw" }, INF)));
    expect((await desktopMcp.verify(ctx)).filter((x) => x.id.startsWith("server.")).map((x) => x.status)).toEqual(["error", "error"]);
    expect(JSON.stringify(await desktopMcp.verify(ctx))).not.toContain("s3cr3t-val");
  });

  it("win32: .ps1 helper path lands in the entry with backslashes", async () => {
    const home = "C:\\Users\\t"; const lad = `${home}\\AppData\\Local`; const lib = `${lad}\\Claude-3p\\configLibrary`;
    const inf = `${home}\\.config\\boot-slapper\\desktop-inference-credential.ps1`;
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t", LOCALAPPDATA: lad }, dirs: [`${lad}\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`], files: {
      [`${home}\\.claude\\mcp\\gateway.json`]: JSON.stringify(bundle), [`${lib}\\_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }),
      [`${lib}\\${ID}.json`]: JSON.stringify(wantedDoc({ baseUrl: "https://gw" }, inf)), [`${home}\\.config\\boot-slapper\\desktop.json`]: JSON.stringify({ entryId: ID }),
    } });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "1.49585.0\r\n", stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    io.on((c) => c === "reg", () => ({ code: 1, stdout: "", stderr: "" }));
    await desktopMcp.apply(ctx, desktopMcp.plan(ctx, await desktopMcp.detect(ctx)));
    const doc = JSON.parse(io.files.get(`${lib}\\${ID}.json`)!);
    expect(doc.mcp.managedServers[1].headersHelper).toBe(`${home}\\.config\\boot-slapper\\desktop-mcp-mecp-headers.ps1`);
    expect(io.files.get(`${home}\\.config\\boot-slapper\\desktop-mcp-mecp-headers.ps1`)).toContain("Retrieve('mecp-device-token'");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/desktop-mcp.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/artifacts/desktop-mcp.ts`**

```ts
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { desktopInstall, desktopRunning, MIN_DESKTOP_VERSION, ourEntry, readSidecar, versionAtLeast, writeLibraryEntry, writeSidecar, ENTRY_NAME, type OurEntry } from "../engine/desktop.ts";
import { pj, type Os } from "../engine/env.ts";
import { defaultAccount, type SecretService } from "../engine/secrets/store.ts";
import { deepEqual } from "../engine/settings.ts";
import { HELPER_MODE, helperPath, renderHeadersHelper } from "./templates/desktop-helpers.ts";

const ID = "desktop-mcp";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { mcpBundle?: string; tokens: Record<string, SecretService> }
export type BundleDoc = { mcpServers?: Record<string, { type?: string; url?: string; headers?: Record<string, string> }> };
export interface ManagedServer { name: string; transport: "http" | "sse"; url: string; oauth?: true; headersHelper?: string; headersHelperTtlSec?: number }
export const D = { helper: "headers helper absent or stale:", servers: "managed MCP servers differ:", entry: "no boot-slapper entry", running: "Claude Desktop is running" } as const;
const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/;
const RUNNING_ERR = "Claude Desktop is running — quit it (⌘Q / File → Exit) and re-run bs onboard --only desktop-mcp";

/** Desktop entries derived from the tracked Code-surface bundle: same URLs on both surfaces, never a literal token. */
export function wantedServers(bundle: BundleDoc, o: Opts, os: Os, home: string): { servers: ManagedServer[]; helpers: Array<{ path: string; body: string }>; skipped: string[] } {
  const servers: ManagedServer[] = []; const helpers: Array<{ path: string; body: string }> = []; const skipped: string[] = [];
  for (const [name, e] of Object.entries(bundle.mcpServers ?? {})) {
    const type = e.type ?? "http";
    if (!e.url || !["http", "streamable-http", "sse"].includes(type)) { skipped.push(`${name} (no url / ${type})`); continue; }
    const s: ManagedServer = { name, transport: type === "sse" ? "sse" : "http", url: e.url };
    const auth = Object.entries(e.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1];
    if (auth === undefined) { s.oauth = true; servers.push(s); continue; }
    const m = PLACEHOLDER.exec(auth); const service = m ? o.tokens[m[1]] : undefined;
    if (!m || !service) { skipped.push(`${name} (Authorization header without a known \${VAR} placeholder — not copied)`); continue; }
    const path = helperPath(os, home, `desktop-mcp-${name}-headers`);
    helpers.push({ path, body: renderHeadersHelper(os, service, "Authorization", auth.slice(0, m.index)) });
    s.headersHelper = path; s.headersHelperTtlSec = 3600; servers.push(s);
  }
  return { servers, helpers, skipped };
}

interface Facts {
  installed: boolean; version: string | null; running: boolean; bundlePath: string; bundle: BundleDoc | null | "invalid";
  ours: OurEntry | null | "invalid"; wanted: ReturnType<typeof wantedServers>; staleHelpers: string[]; current: ManagedServer[]; owned: string[]; merged: ManagedServer[]; serversCurrent: boolean;
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const bundlePath = o.mcpBundle ?? pj(env.os, env.claudeDir, "mcp", "gateway.json");
  const raw = await io.readFile(bundlePath);
  let bundle: Facts["bundle"] = null;
  if (raw !== null) { try { bundle = JSON.parse(raw) as BundleDoc; } catch { bundle = "invalid"; } }
  const install = await desktopInstall(io, env.os, env.home);
  const ours = install.installed ? await ourEntry(io, env.os, env.home) : null;
  const wanted = wantedServers(bundle && bundle !== "invalid" ? bundle : {}, o, env.os, env.home);
  const staleHelpers: string[] = [];
  for (const h of wanted.helpers) if ((await io.readFile(h.path)) !== h.body) staleHelpers.push(h.path);
  const current = (ours && ours !== "invalid" ? ((ours.doc.mcp as { managedServers?: ManagedServer[] } | undefined)?.managedServers ?? []) : []);
  const owned = (await readSidecar(io, env.os, env.home)).servers ?? [];
  const foreign = current.filter((s) => !owned.includes(s.name) && !wanted.servers.some((w) => w.name === s.name));
  const merged = [...foreign, ...wanted.servers];
  return {
    installed: install.installed, version: install.version, running: install.installed ? await desktopRunning(io, env.os) : false,
    bundlePath, bundle, ours, wanted, staleHelpers, current, owned, merged, serversCurrent: deepEqual(current, merged),
  };
}

export const desktopMcp: Artifact = {
  id: ID, surfaces: ["desktop"], portability: "translatable", requires: ["desktop-inference", "claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.installed) return { kind: "blocked", reason: "Claude Desktop not installed — see desktop-inference" };
    if (f.bundle === null) return { kind: "blocked", reason: `${f.bundlePath} missing — it is a tracked dotclaude file; check the claude-config artifact` };
    if (f.bundle === "invalid") return { kind: "blocked", reason: `${f.bundlePath} is not valid JSON — fix it in dotclaude` };
    if (f.ours === "invalid") return { kind: "blocked", reason: "boot-slapper config-library entry is not valid JSON — see desktop-inference" };
    if (f.ours === null) return { kind: "blocked", reason: "no boot-slapper config-library entry yet — desktop-inference must apply first" };
    for (const s of f.wanted.skipped) ctx.emit({ type: "note", level: "warn", message: `${ID}: skipping ${s}` });
    const details: string[] = [];
    for (const h of f.wanted.helpers) if (f.staleHelpers.includes(h.path)) details.push(`${D.helper} ${f.wanted.servers.find((s) => s.headersHelper === h.path)?.name ?? "?"} — will write ${h.path}`);
    if (!f.serversCurrent) details.push(`${D.servers} ${f.wanted.servers.map((s) => s.name).join(", ")} — will write them into the boot-slapper entry`);
    if (details.length && f.running) details.push(`${D.running} — quit it before applying (the configuration is read at launch)`);
    if (!details.length) return { kind: "present" };
    return f.current.length ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith(D.helper))) steps.push(step("helpers", "write the MCP headers helper(s) for Claude Desktop"));
    if (d.some((x) => x.startsWith(D.servers))) steps.push(step("servers", `write MeCP + Open Brain as managed MCP servers in the '${ENTRY_NAME}' entry`));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.helpers`: {
          const f = await facts(ctx);
          for (const h of f.wanted.helpers) { await io.mkdirp(pj(env.os, env.home, ".config", "boot-slapper"), { mode: 0o700 }); await io.writeFile(h.path, h.body, { mode: HELPER_MODE }); }
          break;
        }
        case `${ID}.servers`: {
          const f = await facts(ctx);
          if (f.running) throw new Error(RUNNING_ERR);
          if (!f.ours || f.ours === "invalid") throw new Error("no boot-slapper entry — run desktop-inference first");
          const mcp = { ...((f.ours.doc.mcp as Record<string, unknown>) ?? {}), managedServers: f.merged };
          await writeLibraryEntry(io, env.os, env.home, f.ours.id, { ...f.ours.doc, mcp });
          await writeSidecar(io, env.os, env.home, { servers: f.wanted.servers.map((x) => x.name) });
          ctx.emit({ type: "note", level: "info", message: `${ID}: wrote ${f.wanted.servers.length} managed server(s) (${f.wanted.servers.map((x) => x.name).join(", ")}) — relaunch Claude Desktop; Open Brain shows a Connect button until authorized (open-brain-auth)` });
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts; const out: Check[] = [];
    if (!f.installed) return [{ id: "installed", status: "error", message: "Claude Desktop not installed" }];
    out.push(f.version && !versionAtLeast(f.version, MIN_DESKTOP_VERSION) ? { id: "version", status: "error", message: `Claude Desktop ${f.version} < ${MIN_DESKTOP_VERSION} — managed MCP servers with helpers need a newer build` } : { id: "version", status: "ok", message: `Claude Desktop ${f.version ?? "(version unknown)"} supports managed MCP servers` });
    if (f.bundle === null || f.bundle === "invalid") { out.push({ id: "bundle", status: "error", message: `${f.bundlePath} missing or invalid` }); return out; }
    for (const w of f.wanted.servers) {
      const cur = f.current.find((s) => s.name === w.name);
      out.push(cur && deepEqual(cur, w) ? { id: `server.${w.name}`, status: "ok", message: `${w.name}: ${w.url} (${w.oauth ? "oauth" : "headers helper"})` } : { id: `server.${w.name}`, status: "error", message: `${w.name} missing or stale in the Claude Desktop configuration — run bs onboard --only ${ID}` });
      if (w.headersHelper) {
        const body = f.wanted.helpers.find((h) => h.path === w.headersHelper)?.body;
        out.push((await ctx.io.readFile(w.headersHelper)) === body ? { id: `helper.${w.name}`, status: "ok", message: `headers helper current: ${w.headersHelper}` } : { id: `helper.${w.name}`, status: "error", message: `headers helper missing or stale: ${w.headersHelper} — run bs onboard` });
        const m = PLACEHOLDER.exec(Object.entries(f.bundle.mcpServers?.[w.name]?.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "");
        const service = m ? o.tokens[m[1]] : undefined;
        if (service) {
          const ref = { service, account: defaultAccount(ctx.io) };
          out.push((await ctx.secrets.get(ref)) !== null ? { id: `secret.${w.name}`, status: "ok", message: `${service} present (${ctx.secrets.describe(ref)})` } : { id: `secret.${w.name}`, status: "warn", message: `${service} missing — bs secrets set ${service} (the helper will fail until then)` });
        }
      }
    }
    return out;
  },

  async capture(): Promise<Bundle> {
    return { files: [], instructions: [`${ID}: regenerated on the target from ~/.claude/mcp/gateway.json (tracked in dotclaude); MeCP needs bs secrets set mecp-device-token, Open Brain is authorized in the app (open-brain-auth)`] };
  },
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/artifacts/desktop-mcp.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/desktop-mcp.ts tests/unit/artifacts/desktop-mcp.test.ts
git commit -m "feat(artifacts): desktop-mcp — MeCP (headers helper) + Open Brain (oauth) as managed MCP servers in the boot-slapper entry, URLs from gateway.json (S2)"
```

---

### Task 5: `desktop-skills` artifact (spec §4 row 10, per Deviations §4)

**Files:**
- Create: `src/artifacts/desktop-skills.ts`, `tests/unit/artifacts/desktop-skills.test.ts`

**Interfaces:**
- Consumes: `desktopDataDir`, `decodeAntDid`, `ourEntry`, `cfgGet`, `ORG_SENTINEL`, `readSidecar`, `writeSidecar` (Task 1); `walkFiles`; `sha256` from `engine/capture.ts`.
- Produces:
  - `export const desktopSkills: Artifact` — `id: "desktop-skills"`, `surfaces: ["desktop"]`, `portability: "portable"`, `requires: ["claude-config", "desktop-inference"]`.
  - Options `interface Opts { skills: string[] }` — dotclaude skill directory names under `~/.claude/skills/`.
  - `export function skillsPluginDir(dataDir: string, os: Os, org: string, account: string): string` → `<dataDir>/local-agent-mode-sessions/skills-plugin/<org>/<account>`.
  - `export function skillDescription(skillMd: string): string` — the `description:` value from the SKILL.md YAML frontmatter (`---` block), else the first non-empty non-heading line, else `""`.
  - `export interface ManifestSkill { skillId: string; name: string; description: string; creatorType: string; syncManaged?: boolean; updatedAt: string | null; enabled: boolean }`; `export interface Manifest { lastUpdated: number; skills: ManifestSkill[] }`.
  - `export const D = { copy: "skill to copy:", foreign: "skill exists in Cowork but is not managed by boot-slapper:", manifest: "manifest entry missing:" } as const`.
  - Step ids: `desktop-skills.copy.<name>`, `desktop-skills.manifest`.
  - Bundle: `desktop-skills/<name>/<rel>` for each listed skill (spec §5).

- [ ] **Step 1: Write the failing tests**

`tests/unit/artifacts/desktop-skills.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { D, desktopSkills, skillDescription, skillsPluginDir } from "../../../src/artifacts/desktop-skills.ts";
import { ENTRY_NAME } from "../../../src/engine/desktop.ts";
import { makeCtx } from "../helpers.ts";

const opts = { skills: ["mecp-conventions", "handoff"] };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const DATA = "/h/Library/Application Support/Claude-3p";
const L = `${DATA}/configLibrary`; const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCT = "831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f";
const PLUGIN = `${DATA}/local-agent-mode-sessions/skills-plugin/00000000-0000-4000-8000-000000000001/${ACCT}`;
const SKILL = "---\nname: mecp-conventions\ndescription: Use when writing to MeCP — guard-rails\n---\n\n# MeCP conventions\n";
const base = (extra: Record<string, string> = {}, entry: Record<string, unknown> = { $schemaVersion: 2, inference: { provider: "gateway" } }) => makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP, `${PLUGIN}/skills`], files: {
  [`${APP}/Contents/Info.plist`]: PLIST, [`${DATA}/ant-did`]: Buffer.from(ACCT).toString("base64") + "\n",
  [`${L}/_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }), [`${L}/${ID}.json`]: JSON.stringify(entry),
  "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: ID }),
  [`${PLUGIN}/manifest.json`]: JSON.stringify({ lastUpdated: 1, skills: [{ skillId: "schedule", name: "schedule", description: "x", creatorType: "anthropic", updatedAt: null, enabled: true }] }),
  "/h/.claude/skills/mecp-conventions/SKILL.md": SKILL, "/h/.claude/skills/mecp-conventions/references/a.md": "A\n",
  "/h/.claude/skills/handoff/SKILL.md": "---\ndescription: Archive what shipped\n---\n", ...extra,
} });

describe("desktop-skills", () => {
  it("helpers", () => {
    expect(skillsPluginDir(DATA, "darwin", "00000000-0000-4000-8000-000000000001", ACCT)).toBe(PLUGIN);
    expect(skillDescription(SKILL)).toBe("Use when writing to MeCP — guard-rails");
    expect(skillDescription("# Title\n\nFirst line.\n")).toBe("First line.");
    expect(skillDescription("")).toBe("");
  });

  it("fresh: copies each listed skill, adds user manifest entries, records source hashes; then present", async () => {
    const { ctx, io } = await base();
    const s = await desktopSkills.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.copy} mecp-conventions — will copy to ${PLUGIN}/skills/mecp-conventions`, `${D.copy} handoff — will copy to ${PLUGIN}/skills/handoff`] });
    expect(io.writes).toEqual([]);
    const steps = desktopSkills.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-skills.copy.mecp-conventions", "desktop-skills.copy.handoff", "desktop-skills.manifest"]);
    await desktopSkills.apply(ctx, steps);
    expect(io.files.get(`${PLUGIN}/skills/mecp-conventions/SKILL.md`)).toBe(SKILL);
    expect(io.files.get(`${PLUGIN}/skills/mecp-conventions/references/a.md`)).toBe("A\n");
    const m = JSON.parse(io.files.get(`${PLUGIN}/manifest.json`)!);
    expect(m.skills.map((x: { name: string; creatorType: string }) => [x.name, x.creatorType])).toEqual([["schedule", "anthropic"], ["mecp-conventions", "user"], ["handoff", "user"]]);
    expect(m.skills[1]).toMatchObject({ skillId: "mecp-conventions", description: "Use when writing to MeCP — guard-rails", syncManaged: false, enabled: true });
    expect(typeof m.skills[1].updatedAt).toBe("string"); expect(typeof m.lastUpdated).toBe("number");
    expect(Object.keys(JSON.parse(io.files.get("/h/.config/boot-slapper/desktop.json")!).skills)).toEqual(["mecp-conventions", "handoff"]);
    expect(await desktopSkills.detect(ctx)).toEqual({ kind: "present" });
    expect(desktopSkills.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("a changed source is re-copied; a skill Cowork already has that boot-slapper never wrote is left alone and reported", async () => {
    const { ctx, io } = await base({ [`${PLUGIN}/skills/handoff/SKILL.md`]: "user's own\n" }, { $schemaVersion: 2 });
    io.files.set(`${PLUGIN}/manifest.json`, JSON.stringify({ lastUpdated: 1, skills: [{ skillId: "skill_01", name: "handoff", description: "theirs", creatorType: "user", updatedAt: "2026-07-14T00:00:00Z", enabled: true }] }));
    const s = await desktopSkills.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.copy} mecp-conventions — will copy to ${PLUGIN}/skills/mecp-conventions`, `${D.foreign} handoff — left alone`] });
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, s));
    expect(io.files.get(`${PLUGIN}/skills/handoff/SKILL.md`)).toBe("user's own\n");
    expect(JSON.parse(io.files.get(`${PLUGIN}/manifest.json`)!).skills.find((x: { name: string }) => x.name === "handoff").skillId).toBe("skill_01");
    io.files.set("/h/.claude/skills/mecp-conventions/SKILL.md", SKILL + "\nmore\n");
    const s2 = await desktopSkills.detect(ctx);
    expect(s2).toMatchObject({ kind: "drifted", details: [expect.stringMatching(/^skill to copy: mecp-conventions — source changed/), `${D.foreign} handoff — left alone`] });
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, s2));
    expect(io.files.get(`${PLUGIN}/skills/mecp-conventions/SKILL.md`)).toBe(SKILL + "\nmore\n");
  });

  it("org segment follows deploymentOrganizationUuid when the boot-slapper entry sets it", async () => {
    const org = "12345678-1234-4123-8123-123456789abc";
    const p = `${DATA}/local-agent-mode-sessions/skills-plugin/${org}/${ACCT}`;
    const { ctx, io } = await makeCtx({ opts: { skills: ["handoff"] }, env: { USER: "aca34" }, dirs: [APP, `${p}/skills`], files: {
      [`${APP}/Contents/Info.plist`]: PLIST, [`${DATA}/ant-did`]: Buffer.from(ACCT).toString("base64"),
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: ID, entries: [{ id: ID, name: ENTRY_NAME }] }), [`${L}/${ID}.json`]: JSON.stringify({ $schemaVersion: 2, telemetry: { orgUuid: org } }),
      [`${p}/manifest.json`]: JSON.stringify({ lastUpdated: 1, skills: [] }), "/h/.claude/skills/handoff/SKILL.md": "---\ndescription: d\n---\n",
    } });
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, await desktopSkills.detect(ctx)));
    expect(io.files.has(`${p}/skills/handoff/SKILL.md`)).toBe(true);
  });

  it("blocked until Desktop has run in 3P mode (ant-did + plugin dir), or when a listed skill is missing from ~/.claude/skills", async () => {
    const noDid = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, "/h/.claude/skills/mecp-conventions/SKILL.md": SKILL, "/h/.claude/skills/handoff/SKILL.md": "x" } });
    expect(await desktopSkills.detect(noDid.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/launch Claude Desktop once in third-party mode/) });
    const { ctx } = await base();
    ctx.io.files.delete("/h/.claude/skills/handoff/SKILL.md");
    expect(await desktopSkills.detect(ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/handoff/) });
  });

  it("verify and capture", async () => {
    const { ctx, io } = await base();
    expect((await desktopSkills.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["cowork", "ok"], ["skill.mecp-conventions", "error"], ["skill.handoff", "error"]]);
    await desktopSkills.apply(ctx, desktopSkills.plan(ctx, await desktopSkills.detect(ctx)));
    expect((await desktopSkills.verify(ctx)).map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    io.files.set("/h/.claude/skills/handoff/SKILL.md", "changed");
    expect((await desktopSkills.verify(ctx)).find((c) => c.id === "skill.handoff")).toMatchObject({ status: "warn", message: expect.stringMatching(/source changed/) });
    const b = await desktopSkills.capture!(ctx);
    expect(b.files.map((f) => f.path)).toEqual(["desktop-skills/mecp-conventions/SKILL.md", "desktop-skills/mecp-conventions/references/a.md", "desktop-skills/handoff/SKILL.md"]);
    expect(io.writes.filter((w) => w.startsWith("/h/.claude"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/desktop-skills.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/artifacts/desktop-skills.ts`**

```ts
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { sha256 } from "../engine/capture.ts";
import { cfgGet, decodeAntDid, desktopDataDir, desktopInstall, ourEntry, readSidecar, writeSidecar, ORG_SENTINEL } from "../engine/desktop.ts";
import { pj, type Os } from "../engine/env.ts";
import { walkFiles } from "../engine/walk.ts";

const ID = "desktop-skills";
interface Opts { skills: string[] }
export const D = { copy: "skill to copy:", foreign: "skill exists in Cowork but is not managed by boot-slapper:", manifest: "manifest entry missing:" } as const;
export interface ManifestSkill { skillId: string; name: string; description: string; creatorType: string; syncManaged?: boolean; updatedAt: string | null; enabled: boolean }
export interface Manifest { lastUpdated: number; skills: ManifestSkill[] }

/** Cowork's user-skills plugin: <data>/local-agent-mode-sessions/skills-plugin/<org>/<account>/{manifest.json, skills/<name>/SKILL.md} (S1/S2 follow-up, Deviations §4). */
export const skillsPluginDir = (dataDir: string, os: Os, org: string, account: string) => pj(os, dataDir, "local-agent-mode-sessions", "skills-plugin", org, account);

export function skillDescription(skillMd: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (fm) { const m = /^description:\s*(.+)$/m.exec(fm[1]); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); }
  const body = fm ? skillMd.slice(fm[0].length) : skillMd;
  return body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
}

interface SkillFacts { name: string; src: string; files: string[]; hash: string; dst: string; inCowork: boolean; ownedHash: string | null; manifest: ManifestSkill | undefined }
interface Facts { installed: boolean; ran3p: boolean; plugin: string; manifestPath: string; manifest: Manifest | null | "invalid"; skills: SkillFacts[]; missingSources: string[] }

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const data = desktopDataDir(io, env.os, env.home);
  const install = await desktopInstall(io, env.os, env.home);
  const account = decodeAntDid(await io.readFile(pj(env.os, data, "ant-did")));
  const entry = install.installed ? await ourEntry(io, env.os, env.home) : null;
  const org = String((entry && entry !== "invalid" && cfgGet(entry.doc, ["telemetry", "orgUuid"], "deploymentOrganizationUuid")) || ORG_SENTINEL);
  const plugin = skillsPluginDir(data, env.os, org, account ?? "");
  const manifestPath = pj(env.os, plugin, "manifest.json");
  const ran3p = account !== null && (await io.isDir(pj(env.os, plugin, "skills")));
  let manifest: Facts["manifest"] = null;
  const raw = ran3p ? await io.readFile(manifestPath) : null;
  if (raw !== null) { try { const j = JSON.parse(raw) as Manifest; manifest = Array.isArray(j.skills) ? j : "invalid"; } catch { manifest = "invalid"; } }
  const owned = (await readSidecar(io, env.os, env.home)).skills ?? {};
  const skills: SkillFacts[] = []; const missingSources: string[] = [];
  for (const name of o.skills ?? []) {
    const src = pj(env.os, env.claudeDir, "skills", name);
    const files = await walkFiles(io, env.os, src);
    if (!files.length) { missingSources.push(name); continue; }
    let acc = "";
    for (const rel of files) acc += `${rel}\0${await io.readFile(pj(env.os, src, ...rel.split("/")))}\0`;
    const dst = pj(env.os, plugin, "skills", name);
    skills.push({ name, src, files, hash: sha256(acc), dst, inCowork: ran3p && (await io.isDir(dst)), ownedHash: owned[name] ?? null, manifest: manifest && manifest !== "invalid" ? manifest.skills.find((s) => s.name === name) : undefined });
  }
  return { installed: install.installed, ran3p, plugin, manifestPath, manifest, skills, missingSources };
}
const foreign = (s: SkillFacts) => s.ownedHash === null && (s.inCowork || s.manifest !== undefined);
const stale = (s: SkillFacts) => s.ownedHash !== null && (s.ownedHash !== s.hash || !s.inCowork);

export const desktopSkills: Artifact = {
  id: ID, surfaces: ["desktop"], portability: "portable", requires: ["claude-config", "desktop-inference"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.installed) return { kind: "blocked", reason: "Claude Desktop not installed — see desktop-inference" };
    if (f.missingSources.length) return { kind: "blocked", reason: `skill(s) not in ~/.claude/skills: ${f.missingSources.join(", ")} — they are tracked in dotclaude; check the claude-config artifact or the profile's desktop-skills list` };
    if (!f.ran3p) return { kind: "blocked", reason: "Cowork has not run in third-party mode on this device yet — launch Claude Desktop once in third-party mode, open Cowork, then re-run" };
    if (f.manifest === "invalid") return { kind: "blocked", reason: `${f.manifestPath} is not valid JSON — Cowork owns it; fix it by hand` };
    const details: string[] = [];
    for (const s of f.skills) {
      if (foreign(s)) details.push(`${D.foreign} ${s.name} — left alone`);
      else if (s.ownedHash === null) details.push(`${D.copy} ${s.name} — will copy to ${s.dst}`);
      else if (stale(s)) details.push(`${D.copy} ${s.name} — source changed, will re-copy to ${s.dst}`);
      else if (s.manifest === undefined) details.push(`${D.manifest} ${s.name} — will add it to Cowork's manifest`);
    }
    if (details.every((d) => d.startsWith(D.foreign))) return { kind: "present" };   // nothing to copy; foreign skills are reported by verify
    return f.skills.some((s) => s.ownedHash !== null) ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    for (const d of state.details ?? []) if (d.startsWith(D.copy)) { const name = d.slice(D.copy.length).trim().split(" ")[0]; steps.push({ id: `${ID}.copy.${name}`, title: `copy skill ${name} into Cowork` }); }
    if ((state.details ?? []).some((d) => d.startsWith(D.copy) || d.startsWith(D.manifest))) steps.push({ id: `${ID}.manifest`, title: "register the copied skills in Cowork's skills manifest" });
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx;
    for (const s of steps) {
      if (s.id.startsWith(`${ID}.copy.`)) {
        const name = s.id.slice(`${ID}.copy.`.length);
        const f = await facts(ctx); const sk = f.skills.find((x) => x.name === name);
        if (!sk) throw new Error(`skill ${name} is not in the profile or has no files`);
        if (foreign(sk)) throw new Error(`skill ${name} exists in Cowork but was not written by boot-slapper — refusing to overwrite`);
        for (const rel of sk.files) {
          const parts = rel.split("/");
          await io.mkdirp(pj(env.os, sk.dst, ...parts.slice(0, -1)));
          await io.writeFile(pj(env.os, sk.dst, ...parts), (await io.readFile(pj(env.os, sk.src, ...parts))) ?? "");
        }
        const side = await readSidecar(io, env.os, env.home);
        await writeSidecar(io, env.os, env.home, { skills: { ...(side.skills ?? {}), [name]: sk.hash } });
      } else if (s.id === `${ID}.manifest`) {
        const f = await facts(ctx);
        if (f.manifest === "invalid") throw new Error(`${f.manifestPath} is not valid JSON`);
        const m: Manifest = f.manifest ?? { lastUpdated: 0, skills: [] };
        let added = 0;
        for (const sk of f.skills) {
          if (sk.ownedHash === null || sk.manifest !== undefined) continue;
          const desc = skillDescription((await io.readFile(pj(env.os, sk.src, "SKILL.md"))) ?? "");
          m.skills.push({ skillId: sk.name, name: sk.name, description: desc, creatorType: "user", syncManaged: false, updatedAt: new Date().toISOString(), enabled: true }); added++;
        }
        if (added) { m.lastUpdated = Date.now(); await io.writeFile(f.manifestPath, JSON.stringify(m, null, 2) + "\n"); }
        ctx.emit({ type: "note", level: "info", message: `${ID}: ${added} manifest entr${added === 1 ? "y" : "ies"} added — Cowork picks them up at the next session` });
      } else throw new Error(`unknown step ${s.id}`);
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const out: Check[] = [];
    if (!f.installed) return [{ id: "cowork", status: "error", message: "Claude Desktop not installed" }];
    if (!f.ran3p) return [{ id: "cowork", status: "warn", message: "Cowork has not run in third-party mode yet — skills are copied after the first launch" }];
    out.push({ id: "cowork", status: "ok", message: `Cowork skills plugin at ${f.plugin}` });
    for (const s of f.skills) {
      if (foreign(s)) out.push({ id: `skill.${s.name}`, status: "warn", message: `${s.name}: present in Cowork but not managed by boot-slapper (uploaded by hand?) — left alone` });
      else if (s.ownedHash === null || !s.inCowork) out.push({ id: `skill.${s.name}`, status: "error", message: `${s.name} not copied into Cowork — run bs onboard --only ${ID}` });
      else if (s.ownedHash !== s.hash) out.push({ id: `skill.${s.name}`, status: "warn", message: `${s.name}: source changed since the last copy — run bs onboard --only ${ID}` });
      else if (s.manifest === undefined) out.push({ id: `skill.${s.name}`, status: "warn", message: `${s.name}: copied but missing from Cowork's manifest — run bs onboard --only ${ID}` });
      else out.push({ id: `skill.${s.name}`, status: "ok", message: `${s.name} in Cowork (${s.files.length} file(s))` });
    }
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const f = await facts(ctx); const files: Bundle["files"] = [];
    for (const s of f.skills) for (const rel of s.files) { const c = await ctx.io.readFile(pj(ctx.env.os, s.src, ...rel.split("/"))); if (c !== null) files.push({ path: `desktop-skills/${s.name}/${rel}`, content: c }); }
    return { files, instructions: f.missingSources.length ? [`skills missing from ~/.claude/skills on the source: ${f.missingSources.join(", ")}`] : [] };
  },
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/artifacts/desktop-skills.test.ts && npm run typecheck`
Expected: PASS. Note the `walkFiles` on a `FakeIo` needs the source files registered under `/h/.claude/skills/<name>/…` (the fixture does that).

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/desktop-skills.ts tests/unit/artifacts/desktop-skills.test.ts
git commit -m "feat(artifacts): desktop-skills — copy dotclaude skills into Cowork's skills-plugin and register them in its manifest"
```

---

### Task 6: `open-brain-auth` and `hosted-connectors` (spec §4 rows 11–12)

**Files:**
- Create: `src/artifacts/open-brain-auth.ts`, `src/artifacts/hosted-connectors.ts`, `tests/unit/artifacts/open-brain-auth.test.ts`, `tests/unit/artifacts/hosted-connectors.test.ts`

**Interfaces:**
- Consumes: `desktopDataDir`, `desktopInstall` (Task 1); `defaultAccount`; `Prompter.gate`.
- Produces:
  - `export const openBrainAuth: Artifact` — `id: "open-brain-auth"`, `surfaces: ["code", "desktop"]`, `portability: "device-bound"`, `requires: ["gateway-launch", "desktop-mcp"]`. Options `interface Opts { server: string }` (the server name in `gateway.json` and in `managedMcpServers`; profile: `"openbrain"`).
  - Grant probes (read-only, never logged): **Code** — darwin `security find-generic-password -w -s "Claude Code-credentials" -a <account>` (exit ≠ 0 → no grant), win32/linux `~/.claude/.credentials.json`; parse JSON; grant present when `mcpOAuth` has a key equal to `<server>` or starting with `<server>|`. **Desktop** — `<Claude-3p data dir>/config.json` (Desktop's electron-store; values are `safeStorage`-encrypted blobs) has `custom3pMcpOAuth[<server>]`.
  - `export const D = { code: "Claude Code has no Open Brain grant", desktop: "Claude Desktop has no Open Brain grant" } as const`. Step id `open-brain-auth.gate` (`interactive: true`).
  - `export const hostedConnectors: Artifact` — `id: "hosted-connectors"`, `surfaces: ["code", "desktop"]`, `portability: "non-transferable"`, `requires: []`. Options `interface Opts { connectors: string[]; features: string[] }`. `detect` → `{ kind: "absent", details: [...] }` (nothing to apply), `plan` → `[]`, `apply` → no-op, `verify` → two `ok` checks that state the absence, `capture` → the same as instructions.

- [ ] **Step 1: Write the failing tests**

`tests/unit/artifacts/open-brain-auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { D, openBrainAuth } from "../../../src/artifacts/open-brain-auth.ts";
import { makeCtx } from "../helpers.ts";

const opts = { server: "openbrain" };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const CFG = "/h/Library/Application Support/Claude-3p/config.json";
const creds = (grant: boolean) => JSON.stringify({ claudeAiOauth: { accessToken: "s3cr3t-val" }, mcpOAuth: grant ? { "openbrain|abc123": { accessToken: "s3cr3t-val", serverName: "openbrain" } } : {} });
const box = (code: boolean, desktop: boolean) => makeCtx({ opts, env: { USER: "aca34" }, interactive: true, dirs: [APP], files: {
  [`${APP}/Contents/Info.plist`]: PLIST, [CFG]: JSON.stringify({ locale: "en", ...(desktop ? { custom3pMcpOAuth: { openbrain: "ENCRYPTEDBLOB==" } } : {}) }),
} }).then((r) => { r.io.on((c, a) => c === "security" && a.includes("Claude Code-credentials"), () => ({ code: 0, stdout: creds(code) + "\n", stderr: "" })); return r; });

describe("open-brain-auth", () => {
  it("absent when either grant is missing; the plan is one interactive gate; apply gates then re-checks; nothing leaks", async () => {
    const { ctx, io, events } = await box(false, false);
    const s = await openBrainAuth.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.code} — Claude Code: /mcp → openbrain → Authenticate`, `${D.desktop} — Claude Desktop: Connectors → openbrain → Connect`] });
    expect(io.writes).toEqual([]);
    const steps = openBrainAuth.plan(ctx, s);
    expect(steps).toEqual([{ id: "open-brain-auth.gate", title: "Authorize Open Brain — Claude Code: /mcp → openbrain → Authenticate; Claude Desktop: Connectors → openbrain → Connect; press Enter when both are done", interactive: true }]);
    await openBrainAuth.apply(ctx, steps);
    expect(events.filter((e) => e.type === "note").map((e) => (e as { message: string }).message)).toEqual(["open-brain-auth: still missing — Claude Code has no Open Brain grant; Claude Desktop has no Open Brain grant (re-run bs doctor after authorizing)"]);
    expect(JSON.stringify([...io.files.values(), ...events])).not.toContain("s3cr3t-val");
  });
  it("present when both grants exist; verify reports each surface", async () => {
    const { ctx } = await box(true, true);
    expect(await openBrainAuth.detect(ctx)).toEqual({ kind: "present" });
    expect((await openBrainAuth.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["code", "ok"], ["desktop", "ok"]]);
    const half = await box(true, false);
    expect((await openBrainAuth.verify(half.ctx)).map((c) => [c.id, c.status])).toEqual([["code", "ok"], ["desktop", "warn"]]);
    expect(JSON.stringify(await openBrainAuth.verify(half.ctx))).not.toContain("s3cr3t-val");
  });
  it("win32 reads ~/.claude/.credentials.json; a missing Desktop is a warn, not an error", async () => {
    const home = "C:\\Users\\t";
    const { ctx } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t" }, files: { [`${home}\\.claude\\.credentials.json`]: creds(true) } });
    ctx.io.on((c) => c === "reg", () => ({ code: 1, stdout: "", stderr: "" }));
    expect((await openBrainAuth.verify(ctx)).map((c) => [c.id, c.status])).toEqual([["code", "ok"], ["desktop", "warn"]]);
  });
  it("headless: the gate step is skipped by the runner (interactive), and capture carries the instruction", async () => {
    const { ctx } = await box(false, false);
    expect((await openBrainAuth.capture!(ctx)).instructions).toEqual(["Authorize Open Brain on the target: Claude Code /mcp → openbrain → Authenticate; Claude Desktop Connectors → openbrain → Connect (OAuth grants are device-bound)"]);
  });
});
```

`tests/unit/artifacts/hosted-connectors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hostedConnectors } from "../../../src/artifacts/hosted-connectors.ts";
import { makeCtx } from "../helpers.ts";

const opts = { connectors: ["Gmail", "Todoist"], features: ["Claude in Chrome"] };

describe("hosted-connectors", () => {
  it("is instructions only: absent with the list, no steps, ok checks, capture instructions; never execs or writes", async () => {
    const { ctx, io } = await makeCtx({ opts });
    const s = await hostedConnectors.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: ["claude.ai-hosted connectors are not available on a gateway box: Gmail, Todoist", "not available in Claude Desktop on 3P: Claude in Chrome", "skills, plugins, hooks, remote MCP, memory, projects and scheduled tasks DO work on 3P (feature matrix, 2026-09-10)"] });
    expect(hostedConnectors.plan(ctx, s)).toEqual([]);
    await hostedConnectors.apply(ctx, []);
    expect(await hostedConnectors.verify(ctx)).toEqual([
      { id: "connectors", status: "ok", message: "not on a gateway box (expected): Gmail, Todoist" },
      { id: "features", status: "ok", message: "not in Claude Desktop on 3P (expected): Claude in Chrome" },
    ]);
    expect((await hostedConnectors.capture!(ctx)).files).toEqual([]);
    expect((await hostedConnectors.capture!(ctx)).instructions).toEqual(s.details);
    expect(io.calls).toEqual([]); expect(io.writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/open-brain-auth.test.ts tests/unit/artifacts/hosted-connectors.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `src/artifacts/open-brain-auth.ts`**

```ts
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { desktopDataDir, desktopInstall } from "../engine/desktop.ts";
import { pj } from "../engine/env.ts";
import { defaultAccount } from "../engine/secrets/store.ts";

const ID = "open-brain-auth";
interface Opts { server: string }
export const D = { code: "Claude Code has no Open Brain grant", desktop: "Claude Desktop has no Open Brain grant" } as const;
const CODE_HINT = (s: string) => `Claude Code: /mcp → ${s} → Authenticate`;
const DESK_HINT = (s: string) => `Claude Desktop: Connectors → ${s} → Connect`;

/** Claude Code keeps MCP OAuth grants in its credentials store under `mcpOAuth`, keyed `<server>|<hash>`. The value is read in-process and discarded. */
async function codeGrant(ctx: Ctx, server: string): Promise<boolean> {
  const { io, env } = ctx; let raw: string | null = null;
  if (env.os === "darwin") { const r = await io.exec("security", ["find-generic-password", "-w", "-s", "Claude Code-credentials", "-a", defaultAccount(io)]); raw = r.code === 0 ? r.stdout : null; }
  else raw = await io.readFile(pj(env.os, env.claudeDir, ".credentials.json"));
  if (raw === null) return false;
  try { const j = JSON.parse(raw) as { mcpOAuth?: Record<string, unknown> }; return Object.keys(j.mcpOAuth ?? {}).some((k) => k === server || k.startsWith(`${server}|`)); } catch { return false; }
}
/** Desktop (3P) keeps its MCP OAuth state in its electron-store, key `custom3pMcpOAuth`, one safeStorage-encrypted blob per server name. */
async function desktopGrant(ctx: Ctx, server: string): Promise<boolean> {
  const raw = await ctx.io.readFile(pj(ctx.env.os, desktopDataDir(ctx.io, ctx.env.os, ctx.env.home), "config.json"));
  if (raw === null) return false;
  try { const j = JSON.parse(raw) as { custom3pMcpOAuth?: Record<string, unknown> }; return typeof j.custom3pMcpOAuth?.[server] === "string" || typeof j.custom3pMcpOAuth?.[server] === "object"; } catch { return false; }
}

export const openBrainAuth: Artifact = {
  id: ID, surfaces: ["code", "desktop"], portability: "device-bound", requires: ["gateway-launch", "desktop-mcp"],

  async detect(ctx): Promise<State> {
    const s = (ctx.opts as unknown as Opts).server;
    const details: string[] = [];
    if (!(await codeGrant(ctx, s))) details.push(`${D.code} — ${CODE_HINT(s)}`);
    if (!(await desktopGrant(ctx, s))) details.push(`${D.desktop} — ${DESK_HINT(s)}`);
    return details.length ? { kind: "absent", details } : { kind: "present" };
  },

  plan(ctx, state): Step[] {
    if (state.kind !== "absent") return [];
    const s = (ctx.opts as unknown as Opts).server;
    return [{ id: `${ID}.gate`, title: `Authorize Open Brain — ${CODE_HINT(s)}; ${DESK_HINT(s)}; press Enter when both are done`, interactive: true }];
  },

  async apply(ctx, steps) {
    for (const st of steps) {
      if (st.id !== `${ID}.gate`) throw new Error(`unknown step ${st.id}`);
      await ctx.prompt.gate(st.title);
      const after = await this.detect(ctx);
      ctx.emit({ type: "note", level: after.kind === "present" ? "info" : "warn", message: after.kind === "present" ? `${ID}: both grants present` : `${ID}: still missing — ${(after.details ?? []).map((d) => d.split(" — ")[0]).join("; ")} (re-run bs doctor after authorizing)` });
    }
  },

  async verify(ctx): Promise<Check[]> {
    const s = (ctx.opts as unknown as Opts).server;
    const code = await codeGrant(ctx, s);
    const desk = (await desktopInstall(ctx.io, ctx.env.os, ctx.env.home)).installed && (await desktopGrant(ctx, s));
    return [
      code ? { id: "code", status: "ok", message: `Claude Code holds an Open Brain OAuth grant (${s})` } : { id: "code", status: "warn", message: `${D.code} — ${CODE_HINT(s)}` },
      desk ? { id: "desktop", status: "ok", message: `Claude Desktop holds an Open Brain OAuth grant (${s})` } : { id: "desktop", status: "warn", message: `${D.desktop} — ${DESK_HINT(s)}` },
    ];
  },

  async capture(ctx): Promise<Bundle> {
    const s = (ctx.opts as unknown as Opts).server;
    return { files: [], instructions: [`Authorize Open Brain on the target: Claude Code /mcp → ${s} → Authenticate; Claude Desktop Connectors → ${s} → Connect (OAuth grants are device-bound)`] };
  },
};
```

- [ ] **Step 4: Write `src/artifacts/hosted-connectors.ts`**

```ts
import type { Artifact, Bundle, Check, Ctx, State } from "../engine/artifact.ts";

const ID = "hosted-connectors";
interface Opts { connectors: string[]; features: string[] }
const WORKS = "skills, plugins, hooks, remote MCP, memory, projects and scheduled tasks DO work on 3P (feature matrix, 2026-09-10)";
const lines = (ctx: Ctx) => {
  const o = ctx.opts as unknown as Opts;
  return [`claude.ai-hosted connectors are not available on a gateway box: ${(o.connectors ?? []).join(", ")}`, `not available in Claude Desktop on 3P: ${(o.features ?? []).join(", ")}`, WORKS];
};

/** Spec §4 row 12: nothing to apply; the plan and the bundle state what a gateway box does not have. */
export const hostedConnectors: Artifact = {
  id: ID, surfaces: ["code", "desktop"], portability: "non-transferable", requires: [],
  async detect(ctx): Promise<State> { return { kind: "absent", details: lines(ctx) }; },
  plan: () => [],
  async apply() {},
  async verify(ctx): Promise<Check[]> {
    const o = ctx.opts as unknown as Opts;
    return [
      { id: "connectors", status: "ok", message: `not on a gateway box (expected): ${(o.connectors ?? []).join(", ")}` },
      { id: "features", status: "ok", message: `not in Claude Desktop on 3P (expected): ${(o.features ?? []).join(", ")}` },
    ];
  },
  async capture(ctx): Promise<Bundle> { return { files: [], instructions: lines(ctx) }; },
};
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/artifacts/open-brain-auth.test.ts tests/unit/artifacts/hosted-connectors.test.ts && npm run typecheck`
Expected: PASS. (`this.detect` inside `apply` works because `openBrainAuth` is a plain object literal with method shorthand; if the reviewer prefers, hoist `detect` into a named function and call it directly.)

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/open-brain-auth.ts src/artifacts/hosted-connectors.ts tests/unit/artifacts/open-brain-auth.test.ts tests/unit/artifacts/hosted-connectors.test.ts
git commit -m "feat(artifacts): open-brain-auth (gate + read-only grant checks on both surfaces) and hosted-connectors (instructions only)"
```

---

### Task 7: Profile on both surfaces, contract allowlist, CLI text, skins parity over the desktop artifacts

**Files:**
- Modify: `src/profiles/aca34.ts`, `src/cli.ts` (USAGE only), `src/artifacts/desktop-skills.ts` (export `sourceHash`), `tests/unit/artifacts/contract.test.ts`, `tests/unit/cli.test.ts`, `tests/parity/skins.test.ts`

**Interfaces:**
- Consumes: the five artifacts (Tasks 3–6), `wantedDoc` (Task 3), `ENTRY_NAME` (Task 1).
- Produces:
  - `aca34.surfaces = ["code", "desktop"]`; artifacts appended in this order: `desktopInference, desktopMcp, desktopSkills, openBrainAuth, hostedConnectors`.
  - Options (exact values):
    ```ts
    "desktop-inference": { baseUrl: "https://api.ai.it.cornell.edu" },
    "desktop-mcp": { tokens: { MECP_DEVICE_TOKEN: "mecp-device-token" } },
    // Cowork copies of dotclaude skills; mecp-conventions first (spec §4 row 10). Add names from ~/.claude/skills as they prove useful in Cowork.
    "desktop-skills": { skills: ["mecp-conventions"] },
    "open-brain-auth": { server: "openbrain" },
    // What the owner uses on claude.ai today that a gateway box cannot have (spec §4 row 12; 3P feature matrix 2026-09-10).
    "hosted-connectors": {
      connectors: ["Gmail", "Google Calendar", "Google Drive", "FGAC.ai (Google Workspace)", "Todoist", "Airtable", "Home Assistant", "Trello", "Wispr Flow", "n8n", "Shopify", "Supabase", "Vercel", "Cloudflare Developer Platform", "Microsoft Learn", "Context7", "AccuWeather"],
      features: ["Claude in Chrome", "claude.ai web access", "Voice mode", "Claude Design", "project and plugin sharing", "chat-history search"],
    },
    ```
  - `export function sourceHash(entries: Array<{ rel: string; content: string }>): string` in `desktop-skills.ts` — `sha256(entries.map(e => `${e.rel}\0${e.content}\0`).join(""))`; `facts()` uses it (same bytes as Task 5's inline accumulation).
  - DAG order with the new profile (Kahn, declaration order among peers): `prereqs, hosted-connectors, claude-config, secrets, project-memory, plugins, gateway-launch, mct, desktop-inference, desktop-mcp, desktop-skills, open-brain-auth`.

- [ ] **Step 1: Update the tests first**

`tests/unit/artifacts/contract.test.ts` — replace `assertAllowedCall` with:
```ts
function assertAllowedCall(call: { cmd: string; args: string[] }) {
  const { cmd, args } = call;
  if (cmd === "git") { const sub = args[0] === "-C" ? args[2] : args[0]; expect(["rev-parse", "status", "ls-remote"]).toContain(sub); return; }
  if (cmd === "security") { expect(args[0]).toBe("find-generic-password"); return; }   // any service — the value is read in-process and never written
  if (cmd === "powershell") return;      // read-only PasswordVault / $PROFILE / Get-AppxPackage probes
  if (cmd === "ssh") return;             // BatchMode auth probe
  if (cmd === "node") { expect(args[0] === "--version" || (/dist[\\/]cli\.js$/.test(args[0]) && args[1] === "doctor")).toBe(true); return; }
  if (cmd === "bash") { expect(args[0]).toMatch(/sync-memory$/); expect(args.at(-1)).toBe("list"); return; }
  if (cmd === "plutil") { expect(args.slice(0, 4)).toEqual(["-convert", "xml1", "-o", "-"]); return; }   // managed plist → xml on stdout
  if (cmd === "reg") { expect(args[0]).toBe("query"); return; }
  if (cmd === "pgrep" || cmd === "tasklist") return;   // is Desktop running
  throw new Error(`detect/verify made an unexpected exec call: ${cmd} ${JSON.stringify(args)}`);
}
```
and, in the per-artifact test after the exec loop, add `for (const f of io.fetches) expect(f.init.method ?? "GET", `${artifact.id} fetch ${f.url}`).toBe("GET");`. Give the Desktop-present case coverage too: add a second loop `describe("… with Claude Desktop installed")` that seeds `dirs: ["/h/.claude", "/Applications/Claude.app"]` and `files: { "/Applications/Claude.app/Contents/Info.plist": "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>", "/h/.config/mecp/api_key": "k\n" }` with the same handlers plus `io.on((c) => c === "plutil", () => ({ code: 0, stdout: "<plist><dict/></plist>", stderr: "" }))`, and asserts the same three things (no writes, allowlisted calls, GET-only fetches) for every artifact.

`tests/unit/cli.test.ts`:
- `env` case: add `desktopVersion: null` to the `toMatchObject`.
- `capture --out` case: the manifest id list becomes
  `["prereqs", "hosted-connectors", "claude-config", "secrets", "project-memory", "plugins", "mct", "desktop-inference", "desktop-mcp", "desktop-skills", "open-brain-auth"]` (DAG order; `gateway-launch` has no capture) and the summary line becomes `==> bundle written: /tmp/b (2 file(s), 11 artifact(s))`; also assert `expect(io.files.get("/tmp/b/instructions.md")).toMatch(/## hosted-connectors \(non-transferable\)/)`.

`tests/parity/skins.test.ts` — extend `box()` so every desktop artifact is already satisfied (the two skins must not each mint a random entry id or a timestamped manifest):
```ts
import { sourceHash } from "../../src/artifacts/desktop-skills.ts";
import { wantedDoc } from "../../src/artifacts/desktop-inference.ts";
import { ENTRY_NAME } from "../../src/engine/desktop.ts";
// …
const APP = "/Applications/Claude.app"; const DATA = "/h/Library/Application Support/Claude-3p"; const LIB = `${DATA}/configLibrary`;
const EID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; const ACCT = "831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f";
const PLUGIN = `${DATA}/local-agent-mode-sessions/skills-plugin/00000000-0000-4000-8000-000000000001/${ACCT}`;
const INF = "/h/.config/boot-slapper/desktop-inference-credential.sh"; const MECP_HELPER = "/h/.config/boot-slapper/desktop-mcp-mecp-headers.sh";
const SKILL = "---\nname: mecp-conventions\ndescription: guard-rails\n---\n";
// same order as the bundle's mcpServers keys (mecp, then openbrain) — desktop-mcp compares the arrays with deepEqual
const servers = [{ name: "mecp", transport: "http", url: "https://mecp/mcp", headersHelper: MECP_HELPER, headersHelperTtlSec: 3600 }, { name: "openbrain", transport: "http", url: "https://ob/mcp", oauth: true }];
```
Inside `box()`: change the bundle fixture's `mecp` entry to carry `headers: { Authorization: "Bearer ${MECP_DEVICE_TOKEN}" }`; add `APP` and `${PLUGIN}/skills/mecp-conventions` to `dirs`; add to `files`:
```ts
      [`${APP}/Contents/Info.plist`]: "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>",
      [`${DATA}/ant-did`]: Buffer.from(ACCT).toString("base64"),
      [`${DATA}/config.json`]: JSON.stringify({ custom3pMcpOAuth: { openbrain: "BLOB==" } }),
      [`${LIB}/_meta.json`]: JSON.stringify({ appliedId: EID, entries: [{ id: EID, name: ENTRY_NAME }] }),
      [`${LIB}/${EID}.json`]: JSON.stringify({ ...wantedDoc({ baseUrl: "https://api.ai.it.cornell.edu" }, INF), mcp: { managedServers: servers } }),
      [INF]: renderCredentialHelper("darwin", "cornell-ai-gateway"), [MECP_HELPER]: renderHeadersHelper("darwin", "mecp-device-token", "Authorization", "Bearer "),
      "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: EID, servers: ["openbrain", "mecp"], skills: { "mecp-conventions": sourceHash([{ rel: "SKILL.md", content: SKILL }]) } }),
      "/h/.claude/skills/mecp-conventions/SKILL.md": SKILL, [`${PLUGIN}/skills/mecp-conventions/SKILL.md`]: SKILL,
      [`${PLUGIN}/manifest.json`]: JSON.stringify({ lastUpdated: 1, skills: [{ skillId: "mecp-conventions", name: "mecp-conventions", description: "guard-rails", creatorType: "user", syncManaged: false, updatedAt: "2026-09-10T00:00:00.000Z", enabled: true }] }),
```
(import `renderCredentialHelper`, `renderHeadersHelper` from `../../src/artifacts/templates/desktop-helpers.ts`). Handlers to add:
```ts
  io.on((c, a) => c === "security" && a.includes("Claude Code-credentials"), () => ({ code: 0, stdout: JSON.stringify({ mcpOAuth: { "openbrain|h": {} } }) + "\n", stderr: "" }));
  io.onFetch((u) => u.endsWith("/v1/models"), () => ({ status: 200, body: JSON.stringify({ data: [{ id: "claude-sonnet-5" }] }) }));
```
(register the `Claude Code-credentials` handler **before** the generic `security` handler — `FakeIo.exec` takes the first match). Keep the existing assertions; add `expect(a.json.checks["desktop-inference"].map((c: { status: string }) => c.status)).not.toContain("error");` and the same for `desktop-mcp`, `desktop-skills`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/contract.test.ts tests/unit/cli.test.ts && npx vitest run tests/parity/skins.test.ts`
Expected: FAIL — manifest id list, missing `sourceHash`, desktop checks absent.

- [ ] **Step 3: Update the profile, the CLI usage text, and `sourceHash`**

`src/profiles/aca34.ts`: import the five artifacts; `surfaces: ["code", "desktop"]`; `artifacts: [prereqs, claudeConfig, secrets, gatewayLaunch, projectMemory, mct, plugins, desktopInference, desktopMcp, desktopSkills, openBrainAuth, hostedConnectors]`; add the options block above (keep every existing option). Remove the `// "desktop" joins in Phase 3` comment.

`src/cli.ts` USAGE: after the `--headless` line add `  --only desktop-inference,desktop-mcp,desktop-skills   # just the Claude Desktop (3P) surface`.

`src/artifacts/desktop-skills.ts`: add
```ts
export const sourceHash = (entries: Array<{ rel: string; content: string }>) => sha256(entries.map((e) => `${e.rel}\0${e.content}\0`).join(""));
```
and make `facts()` build `entries` then call `sourceHash(entries)` instead of the inline accumulator.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test && npm run test:parity`
Expected: unit suite green (143 + the new files' cases); parity: `doctor-parity` self-skips or passes (this Mac has `bootstrap.sh`; the bash doctor has no desktop lines, so `PARITY_MAP` is unchanged), `skins` passes.

- [ ] **Step 5: Commit**

```bash
git add src/profiles/aca34.ts src/cli.ts src/artifacts/desktop-skills.ts tests/unit/artifacts/contract.test.ts tests/unit/cli.test.ts tests/parity/skins.test.ts
git commit -m "feat(profile): aca34 on code + desktop; contract allowlist for the Desktop probes; skins parity covers the desktop artifacts"
```

---

### Task 7b: `project-memory` resolves Git Bash on win32 (gate-2 prerequisite; CLAUDE.md follow-up)

**Why here:** on a stock Git-for-Windows install only `Git\cmd` is on PATH, so a bare `bash` spawn resolves to WSL's `bash.exe` (a different filesystem, no `sync-memory`) or to nothing. `git --exec-path` prints `<git root>/mingw64/libexec/git-core` (forward slashes); the bash `sync-memory` needs is `<git root>\bin\bash.exe`. Placed after Task 7 so the contract allowlist is edited once, in its final shape.

**Files:**
- Modify: `src/artifacts/project-memory.ts`, `tests/unit/artifacts/project-memory.test.ts`, `tests/unit/artifacts/contract.test.ts` (allowlist line only)

**Interfaces:**
- Produces: `export async function bashCmd(io: Io, os: Os): Promise<string>` — `"bash"` on darwin/linux without any exec; on win32 runs `git --exec-path` once, walks the printed directory upward with `path.win32.dirname` until `pj("win32", dir, "bin", "bash.exe")` exists (`io.exists`), and returns that path; returns `"bash"` when git fails (non-zero code) or no `bin\bash.exe` is found. Never spawns `.cmd`/`.bat`.
- Consumes: nothing new. `apply` (`sync` step) and `verify` spawn `await bashCmd(io, env.os)` instead of the literal `"bash"`; the argv is unchanged.
- Contract allowlist: `git` gains `--exec-path` — `expect(["rev-parse", "status", "ls-remote", "--exec-path"]).toContain(sub)` (a `--exec-path` call has no `-C`, so `sub === args[0]`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/artifacts/project-memory.test.ts` — import `bashCmd` alongside the existing imports and add a `describe("bashCmd", …)` block:
```ts
describe("bashCmd", () => {
  it("is the bare `bash` off Windows and makes no exec call", async () => {
    const { io } = await makeCtx();
    expect(await bashCmd(io, "darwin")).toBe("bash");
    expect(await bashCmd(io, "linux")).toBe("bash");
    expect(io.calls).toEqual([]);
  });
  it("win32: walks up from `git --exec-path` to <git root>\\bin\\bash.exe", async () => {
    const { io } = await makeCtx({ platform: "win32", home: "C:\\Users\\t", files: { "C:\\Program Files\\Git\\bin\\bash.exe": "" } });
    io.on((c, a) => c === "git" && a[0] === "--exec-path", () => ({ code: 0, stdout: "C:/Program Files/Git/mingw64/libexec/git-core\n", stderr: "" }));
    expect(await bashCmd(io, "win32")).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(io.calls).toEqual([expect.objectContaining({ cmd: "git", args: ["--exec-path"] })]);
  });
  it("win32: falls back to `bash` when git is missing or no bin\\bash.exe exists above exec-path", async () => {
    const { io: noGit } = await makeCtx({ platform: "win32", home: "C:\\Users\\t" });
    noGit.on((c) => c === "git", () => ({ code: 127, stdout: "", stderr: "spawn git ENOENT" }));
    expect(await bashCmd(noGit, "win32")).toBe("bash");
    const { io: noBash } = await makeCtx({ platform: "win32", home: "C:\\Users\\t" });
    noBash.on((c, a) => c === "git" && a[0] === "--exec-path", () => ({ code: 0, stdout: "C:/Program Files/Git/mingw64/libexec/git-core\n", stderr: "" }));
    expect(await bashCmd(noBash, "win32")).toBe("bash");
  });
  it("win32 verify spawns the resolved bash for `sync-memory list`", async () => {
    const home = "C:\\Users\\t"; const repo = `${home}\\projects\\claude-memory-sync`;
    const { ctx, io } = await makeCtx({ platform: "win32", home, opts, dirs: [`${repo}\\.git`, `${repo}\\projects\\mecp`, `${home}\\.claude\\projects`], files: { "C:\\Program Files\\Git\\bin\\bash.exe": "", [`${repo}\\devices\\testbox.json`]: JSON.stringify({ device_label: "testbox", platform: "win32", mappings: {} }), [`${home}\\.claude\\scripts\\memory-auto-sync.mjs`]: "", [`${home}\\.claude\\scripts\\load-mecp-context.mjs`]: "" } });
    io.on((c, a) => c === "git" && a[0] === "--exec-path", () => ({ code: 0, stdout: "C:/Program Files/Git/mingw64/libexec/git-core\n", stderr: "" }));
    io.on((c) => c.endsWith("bash.exe"), () => ({ code: 0, stdout: "", stderr: "" }));
    const checks = await projectMemory.verify(ctx);
    expect(checks.find((c) => c.id === "resolves")?.status).toBe("ok");
    const spawn = io.calls.find((c) => c.cmd !== "git");
    expect(spawn?.cmd).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(spawn?.args).toEqual(["/c/Users/t/projects/claude-memory-sync/bin/sync-memory", "--device", "testbox", "list"]);
  });
});
```
(`FakeIo.addParents` uses posix `dirname`, so seed the win32 directories explicitly in `dirs` as above; `env.label` defaults to the fake hostname `testbox` — check `resolveEnv` if the assertion on `"testbox"` fails and use whatever `ctx.env.label` is.)

`tests/unit/artifacts/contract.test.ts`: in `assertAllowedCall`, change the git list to `["rev-parse", "status", "ls-remote", "--exec-path"]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/project-memory.test.ts`
Expected: FAIL — `bashCmd` is not exported.

- [ ] **Step 3: Implement `bashCmd` and use it**

`src/artifacts/project-memory.ts`:
```ts
/** Git Bash on win32: a stock Git-for-Windows install has only Git\cmd on PATH, where `bash` resolves to WSL or nothing.
 *  `git --exec-path` → <root>/mingw64/libexec/git-core; sync-memory needs <root>\bin\bash.exe. Falls back to `bash`. */
export async function bashCmd(io: Io, os: Os): Promise<string> {
  if (os !== "win32") return "bash";
  const r = await io.exec("git", ["--exec-path"], { timeout: 10_000 });
  if (r.code !== 0) return "bash";
  let dir = r.stdout.trim();
  while (dir) {
    const cand = pj(os, dir, "bin", "bash.exe");
    if (await io.exists(cand)) return cand;
    const up = path.win32.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "bash";
}
```
In `apply`'s `sync` case: `const bash = await bashCmd(io, env.os);` and spawn `io.exec(bash, [bin, …])` for both push and pull. In `verify`: `const r = await io.exec(await bashCmd(io, env.os), [syncBin(f, env.os), "--device", env.label, "list"], { timeout: 30_000 });`.

- [ ] **Step 4: Run the suite**

Run: `npm run typecheck && npx vitest run tests/unit/artifacts/project-memory.test.ts tests/unit/artifacts/contract.test.ts`
Expected: PASS — existing darwin cases still see `cmd === "bash"`; the four new cases pass; the contract test still passes for every artifact (darwin fixture makes no `--exec-path` call).

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/project-memory.ts tests/unit/artifacts/project-memory.test.ts tests/unit/artifacts/contract.test.ts
git commit -m "fix(project-memory): resolve Git Bash via git --exec-path on win32 — stock Git-for-Windows keeps only Git\\cmd on PATH"
```

---

### Task 8: Stage the gate-2 / gate-3 cutover material under `docs/cutover/`

**Files:**
- Create: `docs/cutover/gate-2-runbook.md`, `docs/cutover/gate-3-note.md`, `docs/cutover/staged/bootstrap.sh`, `docs/cutover/staged/dotfiles-install-step3.sh`, `docs/cutover/staged/dotfiles-install-step3.ps1`, `docs/cutover/staged/gateway-sessions.md`, `tests/unit/cutover.test.ts`

**Interfaces:**
- Consumes: `install.sh` / `install.ps1` (Phase 2 shims), spec §6 and §8.
- Produces: files the owner copies into `dotclaude`, `dotfiles` and `claude-memory-sync` at gate 2 / gate 3 — nothing in this repo executes them. The staged shell files are `text eol=lf` by the existing `.gitattributes` rule.

- [ ] **Step 1: Write the failing test**

`tests/unit/cutover.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("staged cutover files", () => {
  it("bootstrap.sh shim is ≤ 15 lines, keeps --doctor, delegates onboard, and falls back to install.sh", () => {
    const s = read("docs/cutover/staged/bootstrap.sh");
    expect(s.split("\n").filter((l) => l.trim()).length).toBeLessThanOrEqual(15);
    expect(s).toMatch(/--doctor/); expect(s).toMatch(/dist\/cli\.js" doctor --headless/); expect(s).toMatch(/dist\/cli\.js" onboard/);
    expect(s).toMatch(/raw\.githubusercontent\.com\/merpuya\/boot-slapper\/main\/install\.sh/);
    expect(s).not.toMatch(/\r/);
  });
  it("dotfiles step-3 replacements call the boot-slapper shims", () => {
    expect(read("docs/cutover/staged/dotfiles-install-step3.sh")).toMatch(/install\.sh \| bash/);
    expect(read("docs/cutover/staged/dotfiles-install-step3.ps1")).toMatch(/install\.ps1 \| iex/);
  });
  it("the runbook names every repo change from spec §6 gate 2 and the verification evidence", () => {
    const r = read("docs/cutover/gate-2-runbook.md");
    for (const s of ["dotclaude/bootstrap.sh", "dotfiles/install.sh", "dotfiles/install.ps1", "dotfiles/zsh/claude-gw.zsh", "docs/gateway-sessions.md", "doctor --json", "sync-memory", "Managed Configuration Report"]) expect(r).toContain(s);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/cutover.test.ts` — Expected: FAIL (files missing).

- [ ] **Step 3: Write the staged files**

`docs/cutover/staged/bootstrap.sh` (goes to `dotclaude/bootstrap.sh` at gate 2):
```bash
#!/usr/bin/env bash
# bootstrap.sh — shim since gate 2 (2026-09): the onboarding logic lives in merpuya/boot-slapper.
#   bootstrap.sh            → bs onboard (Ink screens in a terminal; --auto for headless)
#   bootstrap.sh --doctor   → bs doctor --headless
set -euo pipefail
DIR="${BOOT_SLAPPER_DIR:-$HOME/projects/boot-slapper}"
if [[ -f "$DIR/dist/cli.js" ]]; then
  if [[ "${1:-}" == "--doctor" ]]; then exec node "$DIR/dist/cli.js" doctor --headless; fi
  exec node "$DIR/dist/cli.js" onboard "$@"
fi
if [[ "${1:-}" == "--doctor" ]]; then echo "boot-slapper is not installed at $DIR — run: curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash" >&2; exit 1; fi
curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash -s -- "$@"
```

`docs/cutover/staged/dotfiles-install-step3.sh` (replaces dotfiles `install.sh` step 3):
```bash
# step 3 — Claude setup is owned by boot-slapper (gate 2, 2026-09). Idempotent; safe to re-run.
say "step 3: boot-slapper onboard"
curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
```

`docs/cutover/staged/dotfiles-install-step3.ps1` (replaces dotfiles `install.ps1` step 3):
```powershell
# step 3 — Claude setup is owned by boot-slapper (gate 2, 2026-09). Idempotent; safe to re-run.
Write-Host "==> step 3: boot-slapper onboard"
irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex
```

`docs/cutover/staged/gateway-sessions.md` (replaces `dotclaude/docs/gateway-sessions.md`):
```markdown
# Gateway sessions

Claude Code and Claude Desktop on this device run against the Cornell AI gateway with no claude.ai sign-in.
Everything below is set up and checked by **boot-slapper** (`~/projects/boot-slapper`, public repo `merpuya/boot-slapper`).

| Want to… | Run |
|---|---|
| Set up or repair a box | `bs onboard` (or `curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh \| bash` on a fresh Mac; `irm …/install.ps1 \| iex` on Windows) |
| Check everything | `bs doctor` (`--json` for a report you can commit as evidence) |
| See what onboard would do | `bs plan` |
| Store a secret | `bs secrets set cornell-ai-gateway \| mecp-device-token \| mecp-api-key \| mct-sync-token` (hidden prompt; Keychain / Credential Manager) |
| Start a Code session on the gateway | `claude-gw …` — the wrapper boot-slapper generates in `~/.config/boot-slapper/` |
| Move to a new box without GitHub | `bs capture --out <dir>` on the old one, then `bs onboard` on the new one with the bundle at hand |

Claude Desktop: `bs onboard` writes a `boot-slapper` configuration into Desktop's per-user 3P config library and registers MeCP and
Open Brain as connectors; relaunch Desktop and pick the third-party option on the sign-in screen. Open Brain needs a one-time
*Connect* in Desktop and `/mcp → openbrain → Authenticate` in Code (`bs doctor` shows both grants).

`bootstrap.sh` is a shim that calls `bs`; `claude-gw.zsh` in dotfiles is gone — the wrapper is generated. Design and plans:
`boot-slapper/docs/superpowers/`.
```

`docs/cutover/gate-2-runbook.md`:
```markdown
# Gate 2 — cutover from bootstrap.sh (spec §6)

**Condition:** `bs onboard` green on the new Mac and the new Windows box; `bs doctor` green on both; memory-sync round-trip
verified from each. Until then nothing below is applied.

## On each new box

1. Fresh-box shim: macOS `curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash`, Windows
   `irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex`. Read the plan screen before confirming.
2. Secrets when prompted: `cornell-ai-gateway`, `mecp-device-token` (minted on an admin box), `mecp-api-key`, `mct-sync-token`
   (`mct devices add <slug>` on an admin box). Never paste them anywhere else.
3. Claude Desktop: install the `.dmg` / `.msix` first (the `.exe` has no Cowork). After onboard: quit and relaunch Desktop, choose the
   third-party option, open Cowork once (creates `ant-did` and the skills plugin), then `bs onboard --only desktop-skills,open-brain-auth`.
   Help → Troubleshooting → Copy Managed Configuration Report must show the keys read from the *user store* and the credential validated.
   On the Cornell Windows box check `HKLM\SOFTWARE\Policies\Claude` holds only app-behavior keys (`disableAutoUpdates` …) — anything
   else means IT owns the configuration and `desktop-inference` reports `blocked` by design.
4. Evidence: `bs doctor --json > docs/evidence/<label>-<date>.json` in this repo (redact nothing — doctor prints no values — but do read it).
5. Memory round-trip: create a memory file in a mapped project on box A, `sync-memory --device <A> push`, on box B
   `sync-memory --device <B> pull`, confirm the file; then the reverse direction. No `.conflict-<device>` sidecars may appear.

## Repo changes (one commit each, with a handoff note)

| Repo | Change | Source |
|---|---|---|
| dotclaude | replace `bootstrap.sh` with the shim | `docs/cutover/staged/bootstrap.sh` |
| dotclaude | replace `docs/gateway-sessions.md` | `docs/cutover/staged/gateway-sessions.md` |
| dotfiles | `install.sh` step 3 → shim | `docs/cutover/staged/dotfiles-install-step3.sh` |
| dotfiles | `install.ps1` step 3 → shim | `docs/cutover/staged/dotfiles-install-step3.ps1` |
| dotfiles | delete `zsh/claude-gw.zsh` and its `source` line in `.zshrc` (the generated wrapper's marker line stays) | — |

`dotclaude-self-update.sh`, `apply-settings-template.sh`, `apply-canonical-hooks.sh` are untouched (spec §8). A regression
reverts one commit.

## After the commits

- `bs doctor` on every box: the `legacy-wrapper` warning from `gateway-launch` disappears once `.zshrc` no longer sources the old wrapper.
- `tests/parity/doctor-parity.test.ts` keeps working: the shim's `--doctor` prints the same lines through `bs doctor --headless`.
- MeCP: flip the gate-2 work item to COMPLETED with the evidence file SHAs; write the handoff note.
```

`docs/cutover/gate-3-note.md`:
```markdown
# Gate 3 — deprecate claude-memory-sync/install.sh (spec §6)

**Condition:** one week of SessionStart/End hooks with no sync drift on the fleet after gate 2 (no `.conflict-<device>` sidecars,
`bs doctor` `project-memory.coverage` ok on every box).

**Change (one commit in claude-memory-sync):** `install.sh` prints "device configs are built by `bs onboard` (boot-slapper) —
this script is kept for reference" and exits 0 without writing; the README's device-config section points at `bs onboard`
and `bs doctor`. The `bin/sync-memory` CLI and the hook scripts are unchanged — boot-slapper calls them.
```

- [ ] **Step 4: Run the test, then commit**

Run: `npx vitest run tests/unit/cutover.test.ts` — Expected: PASS.

```bash
git add docs/cutover tests/unit/cutover.test.ts
git commit -m "docs(cutover): stage the gate-2 shims (bootstrap.sh, dotfiles step 3, gateway-sessions.md) and the gate-2/gate-3 runbooks"
```

---

### Task 9: Docs, spec amendments, final verification, phase report

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-09-boot-slapper-design.md` (append-only amendments)

- [ ] **Step 1: README**

Replace the paragraph starting `Artifacts on the \`code\` surface` with:
```
Artifacts (profile `aca34`, surfaces `code` + `desktop`): `prereqs`, `claude-config`, `secrets`, `gateway-launch`,
`project-memory`, `mct`, `plugins`, `desktop-inference`, `desktop-mcp`, `desktop-skills`, `open-brain-auth`, `hosted-connectors`.

Claude Desktop (third-party mode): `bs onboard` writes one configuration named `boot-slapper` into Desktop's per-user config
library (`~/Library/Application Support/Claude-3p/configLibrary/`, `%LOCALAPPDATA%\Claude-3p\configLibrary\`) — gateway provider,
a credential helper that prints the key from the secret store, MeCP (headers helper) and Open Brain (OAuth) as managed connectors —
and copies the listed dotclaude skills into Cowork's skills plugin. Quit Desktop before applying; relaunch and choose the third-party
option afterwards. A device whose MDM profile sets more than the update/proxy keys is reported `blocked`: IT owns that configuration.
```
Change the first line's parenthetical to `(and Claude Desktop)`. Add Phase 3 to the last line of Develop: `Phase 3 \`docs/superpowers/plans/2026-09-10-boot-slapper-phase3-desktop-cutover.md\``. Add after the Fresh box block: `Gate-2 cutover material: \`docs/cutover/\`.`

- [ ] **Step 2: Spec amendments** (append after the Phase 2 amendments paragraph in §4; do not rewrite rows)

```
**Amendments (2026-09-10, Phase 3 — see docs/spikes/2026-09-10-s1-*.md, s2-*.md):** row 8 — Desktop never reads user defaults; the
per-user target is the `Claude-3p/configLibrary/` entry boot-slapper owns (nested v2 document), the gateway key is delivered by a
credential helper (`inferenceCredentialHelper`), `disableAutoUpdates` is not written locally (the update group is managed-only when MDM
sets it), and a managed source that sets any non-app-behavior key makes the artifact `blocked` with the in-app-window instructions.
Row 9 — remote servers live in `managedMcpServers` of the same entry (`claude_desktop_config.json` is stdio-only); MeCP uses a
headers helper, Open Brain `oauth: true`; no `mcp-remote` bridge. Row 10 — skills are copied into Cowork's
`local-agent-mode-sessions/skills-plugin/<org>/<account>/skills/` and registered in its manifest; no symlinks, no `~/Documents/Claude`.
Row 12 — skills, plugins, hooks and remote MCP do load in Cowork on 3P (feature matrix 2026-09-10); the row now lists the hosted
connectors and the claude.ai-only features. §2 — `selectArtifacts` pulls off-surface `requires` in, so a desktop-only profile still
runs `claude-config`. §5 bundle — `desktop-skills/` lands with row 10. §6 — gate-2 shims are staged in `docs/cutover/`.
```
In §7 "Layout" add `docs/cutover/        # gate-2 shims + runbooks (staged, applied in the other repos at the gate)` after the `docs/spikes/` line.

- [ ] **Step 3: `CLAUDE.md`**

Under "Rules that are not obvious from the code" add:
```
- Desktop artifacts write exactly one Claude Desktop config-library entry (named `boot-slapper`, id in `~/.config/boot-slapper/desktop.json`) and only the Cowork skills they copied (hashes in the same sidecar). Foreign entries, skills and manifest rows are reported, never edited. Quit Desktop before `apply`; the app reads the library at launch.
- Desktop gets secrets only through helper executables (`~/.config/boot-slapper/desktop-*.sh|.ps1`, mode 700) that print the value from the secret store; `desktop-inference` verify sends the key as an in-process header to `GET /v1/models` and never logs it.
```
Under "Known follow-ups" replace the "Deferred engine cleanups" bullet's list with the remainder (`State.facts`, tests typecheck, `_writeToOutput` guard, non-44 Keychain exit codes, `doctor --json` redaction, `BS_REQUIRE_PARITY=1`, `homeRel` boundary check, gateway-launch `.bak`) and add:
```
- Desktop (unverified on a real box until gate 2): that a library entry authored outside the app is loaded exactly as the in-app window's own (compare with an *Export → JSON config* from this Mac after the first onboard); that Cowork lists a copied skill without a manifest `updatedAt` from the app; that the `open-brain-auth` Desktop check's key (`custom3pMcpOAuth` in `Claude-3p/config.json`) appears after the first Connect. Each is a one-line `bs doctor` on the box.
- `desktop-inference` never writes `disableDeploymentModeChooser`; the owner keeps the claude.ai option on this Mac. A gateway-only box may want it `true` — profile option to add when the second Mac arrives.
```
Update the header line to `Phase 3 desktop + cutover staging (`docs/cutover/`)`.

- [ ] **Step 4: Final verification**

Run: `npm run typecheck && npm test && npm run test:parity && npm run build && node dist/cli.js env && node dist/cli.js plan --headless && node dist/cli.js doctor --headless; echo "exit=$?"`
Expected: all suites green; `env` shows `desktopInstalled: true, desktopVersion: "1.49585.0"` on this Mac; `plan` lists twelve artifacts — the desktop ones as `absent` (this Mac has no `boot-slapper` entry yet) or `blocked` only for the reasons the artifacts document (`desktop-skills`: "Cowork has not run in third-party mode" is expected if the 3P plugin dir is missing; on this Mac it exists); `doctor` exits 1 only for reds that were red before Phase 3 plus the expected desktop reds (`desktop-inference.entry`, `desktop-mcp.server.*`, `desktop-skills.skill.*`) — paste the desktop section into the phase report.

Then in a real terminal: `npx tsx src/cli.ts doctor` — the Ink Doctor screen shows the five new artifact groups; `hosted-connectors` rows read as informational `✓` lines.

**Do not run `bs onboard` on this Mac in this task.** The phase report ends with the one question the owner decides: run `bs onboard --only desktop-inference,desktop-mcp,desktop-skills` on this Mac now as a gate-2 rehearsal (Desktop quit first; afterwards relaunch, pick the third-party option, and compare *Developer → Configure Third-Party Inference… → Export → JSON config* with the written entry), or wait for the new boxes.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-09-boot-slapper-design.md
git commit -m "docs: Phase 3 — README desktop section, spec amendments (rows 8–12, §2, §5, §6), CLAUDE.md rules and follow-ups"
```

---

## Self-review

**Spec coverage (Phase 3 scope):**
- §4 row 8 `desktop-inference` — Task 3 (config library entry, credential helper, `GET /v1/models` verify with the stored key; `disableNonessential*` written; `disableAutoUpdates` deliberately not — Deviations §1). Row 9 `desktop-mcp` — Task 4 (`managedMcpServers` from `gateway.json`; headers helper / oauth; version floor as the capability probe — Deviations §3). Row 10 `desktop-skills` — Task 5 (copy + manifest, `desktop-skills/` in the bundle — Deviations §4). Row 11 `open-brain-auth` — Task 6 (gate step, two grant checks; stays manual by design). Row 12 `hosted-connectors` — Task 6 (instructions from profile data — Deviations §5).
- §2 `selectArtifacts` cross-surface `requires` — Task 1 (Phase 1 roadmap item 7). `Env` gains `desktopVersion` — Task 1. Invariants 1, 2, 6 hold per artifact; invariant 3 extended in Global Constraints; invariant 4 covered by the leak assertions in Tasks 3, 4, 6 and the in-process fetch header.
- §4 spikes — done before this plan (`docs/spikes/`), referenced as binding.
- §5 bundle `desktop-skills/` — Task 5 `capture`; `instructions.md` gains the three manual artifacts — Task 7's CLI test asserts the `hosted-connectors` section.
- §6 gates 2–3 — Task 8 stages the shims and runbooks; nothing applied (Global Constraints).
- §7 layout — `docs/cutover/` added to the spec in Task 9; error classes reused (`blocked` for missing Desktop / too old / managed takeover / no entry; apply failure with a message that names the fix; drift never overwritten).
- §8 fate table — unchanged until gate 2; the staged files are the gate-2 diffs.
- **Gap, deliberate:** no Linux desktop support beyond path constants (Desktop on Linux is out of scope for A); `disableDeploymentModeChooser` left to the owner (follow-up); Windows helper `.ps1` path verified from the bundle's interpreter table but not on a real Windows box (gate 2).

**Placeholder scan:** none — every step carries its code or exact text; troubleshooting notes follow concrete expected results (Task 3 Step 4, Task 6 Step 5, Task 9 Step 4).

**Type consistency:**
- `Io.fetch(url, init?) → { status, body }`, `FakeIo.fetches`, `FakeIo.onFetch(match, handler)` — Task 1; used by `desktop-inference.verify` (Task 3), the contract test's GET-only assertion (Task 7), the skins fixture (Task 7).
- `engine/desktop.ts` signatures listed in Task 1 are the ones Tasks 3–6 import: `desktopInstall`, `versionAtLeast`, `MIN_DESKTOP_VERSION`, `managedSources`, `managedTakeover`, `desktopRunning`, `readLibraryMeta`, `readLibraryEntry`, `ourEntry` (returns `OurEntry | null | "invalid"`), `newEntryId`, `writeLibraryEntry`, `upsertMeta(io, os, home, entry, apply)`, `readSidecar`/`writeSidecar` (`Sidecar { entryId?, servers?, skills? }`), `cfgGet(doc, nested, flat)`, `desktopDataDir(io, os, home)`, `decodeAntDid`, `ORG_SENTINEL`, `ENTRY_NAME`.
- `helperPath(os, home, name)`, `renderCredentialHelper(os, service)`, `renderHeadersHelper(os, service, header, prefix)`, `HELPER_MODE` — Task 2; consumed by Tasks 3, 4 and the skins fixture (Task 7).
- `wantedDoc(o, helper)` (Task 3) is imported by Task 4's and Task 7's tests; `merged()` in Task 3 preserves `mcp` so Task 4's writes survive a `desktop-inference` rewrite, and Task 4 spreads `f.ours.doc` so Task 3's keys survive its write.
- `sourceHash(entries)` — added in Task 7 to `desktop-skills.ts` and used by its `facts()` (same bytes as Task 5's inline accumulator) and by the skins fixture.
- Step ids: `desktop-inference.{helper,entry,apply-entry}`, `desktop-mcp.{helpers,servers}`, `desktop-skills.copy.<name>` + `desktop-skills.manifest`, `open-brain-auth.gate` — each `plan()` parses only its own `D` prefixes.
- Contract allowlist after Task 7: `git` (rev-parse/status/ls-remote), `security find-generic-password` (any service), `powershell`, `ssh`, `node --version` / `node <…dist/cli.js> doctor`, `bash <…sync-memory> … list`, `plutil -convert xml1 -o -`, `reg query`, `pgrep`, `tasklist`; fetches GET-only.
- Manifest artifact order in the CLI test (Task 7) follows `resolveOrder`'s Kahn queue for the twelve-artifact profile: `prereqs, hosted-connectors, claude-config, secrets, project-memory, plugins, gateway-launch, mct, desktop-inference, desktop-mcp, desktop-skills, open-brain-auth` minus `gateway-launch` (no `capture`).
