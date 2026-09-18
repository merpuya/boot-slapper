# S4 — Claude Desktop 2.2553 rejects boot-slapper's v2 config-library entry outright

**Spec question (the two Windows unknowns carried in CLAUDE.md since 2026-09-16):** does a
boot-slapper-owned **v2** config-library entry survive Claude Desktop, and does Desktop spawn a
`.ps1` credential/headers helper through `powershell.exe -File`? Both were assigned to `yogaNovo`
and both were unanswerable until 3P mode actually ran there (S3, 2026-09-17).

**Both are now answered — v2 no, `.ps1` yes — and a third bug fell out of the second one: `bs secrets
set` had never once worked on Windows.** Read the vault section below before trusting any Windows
secret-store result recorded before 2026-09-18.

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

### Both unknowns, resolved — v2 negatively, `.ps1` affirmatively (the latter after the flat-write fix below)

- **v2-entry survival: disproved on this build.** The open question was whether a boot-slapper v2
  entry survives an *in-app apply*. It does not get that far — 2.2553.0.0 does not recognize
  `$schemaVersion`, `inference`, `mcp`, `models` or `telemetry` at **launch**. The macOS evidence in
  CLAUDE.md (JCB-AL-ACA34, 2026-09-16) was gathered against a **v1 flat applied entry**; v2 has now
  been written to a real box exactly once, and was rejected. Treat `writeLibraryEntry`'s v2 shape as
  **never validated against a shipping app**, not as validated-and-then-regressed — no evidence
  exists for an app version that ever accepted it.
- **The `.ps1` helper spawn: unreachable on the v2 entry, then verified once the entry was flat.** On
  the v2 launch no spawn appears in `main.log` — the only PowerShell strings are `PATH` dumps and an
  unrelated `preview-hidden-park-helper` (an Electron quit-cleanup handler, nothing to do with
  credentials) — because the blocks that *name* the helpers were discarded first. After the flat-write
  fix, the 01:07:18 launch spawns **both**:

      01:07:18 [info] [custom-3p] Credentials loaded from managed config { provider: 'gateway', mcpServerCount: 2 }
      01:07:18 [info] [custom-3p] running helper { helperPath: 'C:\Users\merpu\.config\boot-slapper\desktop-inference-credential.ps1', args: [] }
      01:07:18 [info] [custom3p-mcp-headers] running helper { helperPath: 'C:\Users\merpu\.config\boot-slapper\desktop-mcp-mecp-headers.ps1', args: [] }

  So the CLAUDE.md claim taken from the bundle's interpreter table — Desktop runs a `.ps1`, no
  arguments — **holds, and is now observed** rather than inferred. `args: []` matches S1 exactly.
  `mcpServerCount: 2` (was 0) is the same launch proving flat `managedMcpServers` is read. This box is
  arm64, so this is an arm64 result; `alienTop` (x64) remains the tiebreak if the two ever diverge.
  Also newly visible: the app retries a rejected helper (`server rejected helper credential —
  re-running headers helper now`) and backs off (`failCount: 1, backoffMs: 30000`) rather than
  dropping the server — so a credential that arrives late should connect without a relaunch.

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
  00:22:42 — **before** the onboard run (00:34), so it is not caused by the v2 write. Consistent with
  the empty secret store the vault bug below explains.

## The third bug: `bs secrets set` had never worked on Windows

Chasing why the helpers failed turned up a defect with a much wider blast radius than the schema one.

After the flat-write onboard, Desktop spawned both helpers and both exited 1:

    01:07:20 [error] [custom-3p] helper exited code=1 (elapsed=1008ms stdoutBytes=0)
      stderr="Exception calling "Retrieve" with "2" argument(s): "Element not found. Cannot get credential from Vault""
      At ...\desktop-inference-credential.ps1:6 char:1 + $c = $v.Retrieve('cornell-ai-gateway', 'merpu')

Inference stopped and the owner restored the static key by hand. The obvious reading — "the owner never
stored the key" — was wrong. **`bs secrets set` reported success and stored nothing, every time.**

`PasswordVault` commits asynchronously. The old `set` script was:

    try {
      try { $old = $v.Retrieve(svc, acct); $v.Remove($old) } catch {}
      $v.Add((New-Object ...PasswordCredential(svc, acct, value)))
      exit 0                        # ← tears the process down before the commit lands
    } catch { exit 45 }

The `exit 0` reached through a `try`, immediately after `Add`, killed PowerShell mid-commit: exit code
0, no stderr, credential gone. **Deterministic — 5/5 distinct pairs lost, exit 0 every time.** Ablation
on the box, one variable at a time:

| script | result |
|---|---|
| the store's script verbatim | **LOST** (5/5) |
| minus the outer `try` (`exit 0` at top level) | PERSISTED |
| minus `$ErrorActionPreference` | LOST |
| minus `exit 0` (still inside `try`) | LOST |
| minus the `Retrieve`/`Remove` preamble | LOST |
| `try { Add } catch {}` then `exit 0` *after* the try | PERSISTED |
| `try { Add; exit 0 } catch {}` | LOST |
| `Add` alone, or `Add; exit 0` with no `try` | PERSISTED |

So `$ErrorActionPreference` and the `Retrieve`/`Remove` preamble were both red herrings; the trigger is
precisely **an `exit` after `Add` inside a `try` block**. `Add` + `Retrieve` in the *same* PowerShell
always worked, which is why nothing local ever caught it — only a fresh process sees the loss.

Fixed (`c0984b0`): the script now ends on `Add`. With `EAP='Stop'` an `Add` failure is already a
terminating error, so PowerShell exits non-zero on its own — the hand-rolled `exit 45` bought nothing
and cost the commit. `set` also **reads the value back in a fresh process** and throws if it is absent;
the old `set` trusted its own exit code, which is exactly why this was invisible for a day. stderr
stays out of the thrown error: a PowerShell error record echoes the offending source line, which is the
`PasswordCredential(...)` call carrying the plaintext (an existing test asserts this, and caught the
attempt to add it).

Verified after the fix: `bs secrets set cornell-ai-gateway` → `bs secrets check` reports **present**;
the helper that failed an hour earlier now exits 0 with a 25-byte `sk-`-prefixed value (shape checked,
never printed); `desktop-inference` moved `blocked` → `drifted`, releasing the guard below.

**Consequence for the record: no Windows secret-store result recorded before 2026-09-18 can be
trusted.** Every "key missing" on a Windows box may have been this bug rather than an unstored key —
including the reds in S3's Cornell-box `bs doctor` run. macOS is unaffected (`KeychainStore` shells out
to `security -i` and never had the pattern).

### And the guard that should have prevented the outage

`desktop-inference` planned the helper-script credential without asking whether the secret it would read
exists — `verify` checked, `detect`/`plan` did not. So onboard could take down a working box, which is
worse than failing to improve one. `118f6b1` blocks in `detect` (and re-checks in the entry apply step)
when the store has no key **and** the applied entry is currently authenticating some other way: a static
key, or a foreign helper — replacing IT's policy-supplied helper fails identically. A box with nothing to
lose is deliberately *not* blocked, so a fresh onboard cannot stall. Blocking rather than warning because
apply steps run unattended under `--auto`, where a warning is read by nobody.

Both fixes are needed and neither is sufficient alone: the guard stops the unsafe write, the vault fix
stops the store from lying about it. The guard by itself would have blocked forever on a box where `set`
could never succeed.

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

- Work item `project:boot-slapper/desktop-v2-config-entry-rejected` at **DONE** — the schema question is
  answered and fixed in `da1802c` (flat v1 only, readers still accept both).
- A **SUPERSEDE** on any belief that v2-entry survival was an open-but-likely question: it is now
  answered *no* for 2.2553.0.0 (`valid_from: 2026-09-18`). The predecessor belief closes
  `valid_to: 2026-09-18`.
- A **SUPERSEDE** on the `.ps1`-helper belief, which was held as *inferred from the bundle's interpreter
  table, unobserved*. Now **observed** on arm64 (`running helper { helperPath: …ps1, args: [] }`),
  `valid_from: 2026-09-18`. Note it is an arm64 observation; `alienTop` is the x64 tiebreak.
- Work item `project:boot-slapper/windows-secret-store-never-committed` at **DONE** (`c0984b0`) — with
  the correction that matters more than the fix: **every Windows secret-store result before 2026-09-18 is
  suspect**, including S3's Cornell-box doctor reds. Any decision-log entry that reasoned from "the key is
  missing on Windows" should be re-read with this in mind.
- Update `project:boot-slapper/phase-3-desktop-cutover`: on `yogaNovo`, `desktop-skills` and `desktop-mcp`
  verified end-to-end, `desktop-inference` is `drifted` and applyable now that the vault works. The
  remaining Windows gap is the flat-entry relaunch check (below), not a schema or policy question.

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

Verified: **264/264 unit** (32 files, 8 new tests across the three fixes), typecheck and build clean.
`bs plan` on this box moved `desktop-mcp` from the false `present` to `absent`, then to `present` once the
servers were written flat; `desktop-skills` reports `present` throughout — it never depended on the schema.

Three commits, in the order the bugs were found: `da1802c` (flat write), `118f6b1` (credential guard),
`c0984b0` (vault commit). The docs commit `f2e9ed2` predates the last two.

### What this run says about the method

The v2 schema, the "flat is typical of a hand-authored entry" comment, and the `.ps1` interpreter claim
were all **inferred from documents and reasoned about confidently for a week**. Two were wrong. The
schema error survived because adopt-mode never exercised the writer, and the vault error survived because
`set` and `get` were only ever tested against the same PowerShell process (and, in units, against a fake
that cannot model an async commit). Both are the same shape of gap: **the code was never run against the
real thing in the one configuration where it mattered.** S1/S2 flagged their own inference honestly
("inferred from the document") — the failure was downstream, in treating the inference as settled.

## State of the box when this note was written

`bs plan` on `yogaNovo`: `desktop-mcp` **present**, `desktop-skills` **present**, `desktop-inference`
**drifted** (will rewrite the inference keys; Desktop running). `cornell-ai-gateway` is in the vault and
the credential helper resolves — exit 0, 25 bytes, `sk-` prefix (shape checked, value never printed).
`mecp-device-token` and `mct-sync-token` are still absent and must be minted on an admin box.

## Next

**(1) is done — closed at 12:02 the same day; the rest stand.**

1. ~~Quit Desktop, `bs onboard --only desktop-inference`, relaunch.~~ **Done 2026-09-18 12:02. All three
   desktop artifacts report `present` on Windows for the first time.** The 12:02:47 launch shows **zero**
   `Ignoring local configuration value` lines and **zero** `credential helper failed` — both present at
   01:07:58 with the same helper — plus `mcpServerCount: 2` and `ConfigHealth` `provider_error` →
   `not_testable`. The dead v2 block is gone from the entry, so (2) is moot. Final entry is pure flat v1
   with `inferenceCredentialKind: "helper-script"`; `openbrain`'s `oauth` returned as `{ mode: "dcr" }`,
   confirming `sameServer`'s oauth-by-presence rule on Windows.
2. ~~Clearing the dead v2 block~~ — no longer needed; the onboard rewrote the entry without it.
3. **Rotate the gateway key — now load-bearing, not hygiene.** `inferenceGatewayApiKey` is *still in the
   entry* in plaintext: `merged()` only overwrites `OWNED` keys by design, so boot-slapper never deletes
   what it did not write, which means the old static key sits beside the helper meant to replace it and
   the app may still prefer it. Rotation is the only way to prove the helper is the live credential path.
   It is also still in `claude_desktop_config.json`'s `cornell_secure_tools` argv.
4. **MeCP remains unwritten** — the staging block above plus S3's. First box with a real
   `mecp-device-token` drains both. **Do not shortcut this with the value already in
   `~/.config/mecp/api_key` on `yogaNovo`:** it is 39 chars with no dots — not a JWT — and
   `mint-device-token.ts` mints device tokens *as* JWTs, so that is the **master `API_KEY`** shape, which
   the script's own header says devices should never hold. It does authenticate (`Authorization: Bearer`
   → 200 OK on `POST /mcp` initialize, verified 2026-09-18), which is the problem rather than the
   reassurance. Present since 2026-08-06; six weeks unnoticed because the mint script installs *both*
   credential kinds to that same path, so only JWT shape distinguishes them. Mint
   `--device yoga-novo --scope write`, install over the file, `bs secrets set mecp-device-token`, then
   consider rotating the master (kills all derived tokens — plan re-minting). A shape check at that read
   site would prevent a recurrence, and other devices are worth checking for the same condition.

Open, and not answered here: `MIN_DESKTOP_VERSION` is `1.19367.0`, but S2 records the `managedMcpServers`
3P scope as **≥1.2581.0** — a different threshold. `versionAtLeast("2.2553.0", "1.19367.0")` passes, so
nothing is blocked today, but these version strings do not order the way semver would suggest and the
floor may be checking the wrong thing. Filed in CLAUDE.md.

## Files of interest

- `%LOCALAPPDATA%\Claude-3p\logs\main.log` — lines 1970–1990: the v2 rejection block and
  `mcpServerCount: 0`; line ~3139 onward: the flat-entry launch with `mcpServerCount: 2` and both
  `running helper` spawns; lines 3023/3349: the `Element not found. Cannot get credential from Vault`
  failures that led to the vault bug
- `%LOCALAPPDATA%\Claude-3p\configLibrary\866c62c2-….json` — the union entry: live flat keys beside the
  dead v2 block
- `~/.config/boot-slapper/desktop.json` — sidecar (entryId, servers, skill hash)
- `~/.config/boot-slapper/backups/_meta.json.bs-backup-20260918-003216` — pre-rename meta, kept outside
  the store because Desktop may enumerate that directory
- `src/artifacts/desktop-inference.ts` — `wantedDoc` (the flat emitter), `blockedReason` (the credential
  guard); `src/artifacts/desktop-mcp.ts` — `facts()`'s `current` vs `active` split
- `src/engine/secrets/passwordvault.ts` — `set`, and the comment explaining why nothing may follow `Add`
