# S4 — Claude Desktop 2.2553 rejects boot-slapper's v2 config-library entry outright

**Spec question (the two Windows unknowns carried in CLAUDE.md since 2026-09-16):** does a
boot-slapper-owned **v2** config-library entry survive Claude Desktop, and does Desktop spawn a
`.ps1` credential/headers helper through `powershell.exe -File`? Both were assigned to `yogaNovo`
and both were unanswerable until 3P mode actually ran there (S3, 2026-09-17).

**Date / box:** 2026-09-18, **`yogaNovo`** (Windows 11 Home 26340, personal, **arm64** Snapdragon
X Elite), Claude Desktop **2.2553.0.0** (`appVersion: '2.2553.0'`, `arch: 'arm64'`,
`nodeVersion: '24.20.0'`), CCD 2.1.274, MSIX family `Claude_pzs8sxrjxfjjc`. Note the version jump:
S3 and the macOS rehearsal both ran **2.110.0.0**.

**Method:** 3P mode was already signed in and Cowork had run, so `resolveDesktopStore` reported
`%LOCALAPPDATA%\Claude-3p` **live** — the first Windows box ever to do so on evidence
(a `configLibrary\_meta.json`) rather than as a tie-break default. The applied entry was named
`Default` and app-authored, so `desktop-mcp` was `blocked`; the entry was renamed
`Default` → `boot-slapper` in `_meta.json` (id untouched, entry doc untouched, backup at
`~/.config/boot-slapper/backups/_meta.json.bs-backup-20260918-003216`) to take ownership via
`ourEntry`'s name fallback. Then `bs onboard --only desktop-inference,desktop-mcp,desktop-skills`
from a terminal **outside** Desktop, Desktop quit first. Relaunch at 00:35:07.

## Answer: the app never accepts the v2 shape, so the helper question cannot be reached this way

`~/AppData/Local/Claude-3p/logs/main.log`, at the 00:35:07 launch — every nested key boot-slapper
wrote, discarded by name:

    2026-09-18 00:35:07 [warn] Ignoring local configuration value "models": not a recognized configuration key
    2026-09-18 00:35:07 [warn] Ignoring local configuration value "telemetry": not a recognized configuration key
    2026-09-18 00:35:07 [warn] Ignoring local configuration value "$schemaVersion": not a recognized configuration key
    2026-09-18 00:35:07 [warn] Ignoring local configuration value "inference": not a recognized configuration key
    2026-09-18 00:35:07 [warn] Ignoring local configuration value "mcp": not a recognized configuration key

Emitted **twice** per launch (lines 1970–1974 and 1985–1989), bracketing `Starting app` — the
config is parsed once before and once after app init. Immediately after:

    2026-09-18 00:35:07 [info] [custom-3p] Credentials loaded from managed config { provider: 'gateway', mcpServerCount: 0 }
    2026-09-18 00:35:07 [info] [custom-3p] 3P mode active { provider: 'gateway' }

`mcpServerCount: 0`. The `mcp.managedServers` array holding `openbrain` and `mecp` was dropped
wholesale, so neither server was ever offered to the client. `mcp.log` shows only
`cornell_secure_tools` connecting, and that one comes from `claude_desktop_config.json`
(`mcpServers`, an `npx mcp-remote` stdio server), **not** from the config library.

### Both unknowns, resolved — one negatively, one still open

- **v2-entry survival: disproved on this build.** The open question was whether a boot-slapper v2
  entry survives an *in-app apply*. It does not get that far — 2.2553.0.0 does not recognize
  `$schemaVersion`, `inference`, `mcp`, `models` or `telemetry` at **launch**. The macOS evidence in
  CLAUDE.md (JCB-AL-ACA34, 2026-09-16) was gathered against a **v1 flat applied entry**; v2 has now
  been written to a real box exactly once, and was rejected. Treat `writeLibraryEntry`'s v2 shape as
  **never validated against a shipping app**, not as validated-and-then-regressed — no evidence
  exists for an app version that ever accepted it.
- **The `.ps1` helper spawn: still unverified, and unreachable by this route.** No `.ps1` spawn
  appears in `main.log`; the only PowerShell strings are `PATH` dumps and an unrelated
  `preview-hidden-park-helper` (an Electron quit-cleanup handler, nothing to do with credentials).
  The `inference.credential` and `mcp.managedServers[].headersHelper` blocks that *name* the helpers
  were discarded before anything could spawn. The claim in CLAUDE.md — that Desktop runs a `.ps1`
  through `powershell.exe -File`, taken from the bundle's interpreter table and never observed —
  remains unobserved. It cannot be tested until the app accepts a config that references a helper.
  Because this box is arm64, a future result here is an arm64 result; `alienTop` (x64) is the tiebreak.

## Why nothing broke — `writeLibraryEntry` unions, it does not replace

The entry grew 537 → 1456 bytes: the v2 nested blocks were **added alongside** the app's original
flat keys, which all survived —

    inferenceGatewayBaseUrl   inferenceGatewayApiKey   inferenceProvider: "gateway"
    inferenceCredentialKind: "static"   chatTabEnabled   isDesktopExtensionEnabled
    modelPrefer1mContext   inferenceModelPricingEnabled   inferenceModelPricingMultiplier
    disableNonessentialTelemetry   disableNonessentialServices   autoModeEnabled
    toolSearchEnabled   builtinBrowserEnabled

so inference kept working off the flat pair and the session hosted inside Desktop survived the
relaunch. Had the write *replaced* the doc, the flat keys would have gone and Desktop would have lost
its gateway configuration — the backup would have been load-bearing. Worth keeping the union
behavior deliberately, and worth noting the flat keys are the ones the app actually reads.

Two consequences to hold onto:

- **The plaintext gateway key is still plaintext.** `inferenceCredentialKind: "static"` and
  `inferenceGatewayApiKey` are what the app honors; the `helper-script` credential landed only in the
  ignored `inference` block. The same key also sits in `claude_desktop_config.json` in
  `cornell_secure_tools`' argv (`--header x-litellm-api-key:Bearer sk-…`), which is a *second* copy
  and, being argv, is visible to any process listing. Rotation is the clean exit once a helper route
  works.
- `[custom-3p] ConfigHealth recomputed { state: 'provider_error', provider: 'gateway' }` appears at
  00:22:42 — **before** the onboard run (00:34), so it is not caused by the v2 write. Unexplained;
  probably the missing gateway key in the secret store. Not chased here.

## What did work

- **`desktop-skills`: fully verified on Windows, first time.** `mecp-conventions` copied to
  `…\local-agent-mode-sessions\skills-plugin\<ORG_SENTINEL>\4eb34eeb-…\skills\mecp-conventions` at
  00:34, and the manifest row was registered — 12 rows total, ours carrying
  `"creatorType": "user"`, `"syncManaged": false`, `"enabled": true`,
  `"updatedAt": "2026-09-18T04:34:52.220Z"`. Sidecar records the hash
  (`ea6c2586…`). The Cowork skills path is entirely independent of the config-library schema, which
  is why it survived a launch that discarded everything else.
- The rename → ownership route works: `desktop-mcp` moved `blocked` → `absent` with a real plan the
  moment `_meta.json` carried `boot-slapper`, and `bs onboard` then wrote
  `~/.config/boot-slapper/desktop.json` pinning `entryId`, so ownership no longer depends on the name.
- Both helpers were written as expected:
  `desktop-inference-credential.ps1` (507 B) and `desktop-mcp-mecp-headers.ps1` (539 B).

## MeCP staging (this box has no `mecp-device-token`; nothing was written)

Draining S3's staging block is **still** outstanding — this session had no MeCP tools either, for the
same reason the servers did not load. Add to it:

- Work item `project:boot-slapper/desktop-v2-config-entry-rejected` at **SCOPED** — `writeLibraryEntry`
  emits a nested v2 shape no shipping Desktop is known to accept; decide whether v1 flat keys are the
  real target schema.
- A **SUPERSEDE** on any belief that v2-entry survival was an open-but-likely question: it is now
  answered *no* for 2.2553.0.0 (`valid_from: 2026-09-18`). The predecessor belief closes
  `valid_to: 2026-09-18`.
- Update `project:boot-slapper/phase-3-desktop-cutover`: `desktop-skills` verified on Windows;
  `desktop-inference`/`desktop-mcp` blocked on a schema question, not a policy question, on `yogaNovo`.

## Root cause, and the fix (same session)

`writeLibraryEntry` was not the problem — it is a plain writer. The v2 shape came from the artifacts:
`wantedDoc` in `src/artifacts/desktop-inference.ts` and the servers step in `desktop-mcp.ts`. The defect
was an **asymmetry**: `cfgGet` reads both shapes (and `desktop-mcp` even commented that flat is "typical
of a hand-authored entry" — backwards; flat is what *the app itself* writes), while the writers emitted v2
only. boot-slapper could read what the app writes and could not write what the app reads. Adopt-mode hid
this on macOS because adopting writes nothing; only the fresh-entry route exposes it.

Fixed by emitting **flat v1 only**, per S1 §"Keys the owner profile needs" and S2's key definition
(`flatKey managedMcpServers`, item shapes identical between v1 and v2 — so only the location changed).
Readers stay shape-agnostic, so a v2 entry is still understood. Two bugs surfaced while testing the fix,
both from treating "mentioned in the entry" as "loaded by the app":

1. **Non-convergence.** `cfgGet` prefers *nested*, so after writing flat, the next `detect` re-read the
   stale nested list and reported drift forever. Caught by a migration test as it was written.
2. **A false green, which is worse.** The live yogaNovo entry had servers *only* nested, and `bs plan`
   said `desktop-mcp: present` while Desktop loaded none of them. `facts()` now separates `current`
   (every server named anywhere — so a foreign one is never dropped and the app's normalized `oauth`
   object survives a rewrite) from `active` (the flat key alone). Drift, `detect`'s absent/drifted
   choice, and `verify`'s per-server checks all judge `active`. Nested-only now reads `absent`.

Verified: **260/260 unit** (32 files, 4 new tests), typecheck and build clean, and `bs plan` on this box
moved `desktop-mcp` from the false `present` to `absent` with a real plan. `desktop-skills` reports
`present` throughout — it never depended on the schema.

## Next

Quit Desktop, `bs onboard --only desktop-inference,desktop-mcp`, relaunch, and read `main.log`: no
`Ignoring local configuration value` lines and `mcpServerCount: 2` is the result to look for. That
also finally puts the **`.ps1` helper spawn** question in reach, since the accepted entry will name
both helpers — the first chance to observe `powershell.exe -File` rather than infer it. `mecp` will
still fail auth until `mecp-device-token` is minted on an admin box; a *spawn* in the log is the finding,
not a successful connection.

Open, and not answered here: `MIN_DESKTOP_VERSION` is `1.19367.0`, but S2 records the `managedMcpServers`
3P scope as **≥1.2581.0** — a different threshold. `versionAtLeast("2.2553.0", "1.19367.0")` passes, so
nothing is blocked today, but these version strings do not order the way semver would suggest and the
floor may be checking the wrong thing.

## Files of interest

- `%LOCALAPPDATA%\Claude-3p\logs\main.log` lines 1970–1990 — the rejection block and `mcpServerCount: 0`
- `%LOCALAPPDATA%\Claude-3p\configLibrary\866c62c2-….json` — the union entry, both shapes
- `~/.config/boot-slapper/desktop.json` — sidecar (entryId, servers, skill hash)
- `src/engine/desktop.ts` — `writeLibraryEntry` (the v2 emitter), `ourEntry` name fallback (line ~262)
