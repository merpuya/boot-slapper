# Handoff: four bugs between boot-slapper and a working Windows 3P box

**Session date:** 2026-09-18
**Author:** merpuya via Claude
**Scope:** A `/resume` on **`yogaNovo`** that found 3P mode already running — the precondition the
last handoff said was missing — and spent the session closing the two Windows unknowns it unblocked.
Both closed. Three separate bugs fell out on the way, each hidden behind the previous one. Box:
yogaNovo (Windows 11 Home 26340, personal, **arm64** Snapdragon X Elite), Claude Desktop
**2.2553.0.0** (up from 2.110.0.0), CCD 2.1.274. This session was hosted *inside* the Desktop app it
was reconfiguring, which shaped what could be done from here.

## What shipped

Five commits on `boot-slapper` (`b17b281..2c9cb47`, pushed) and one on `~/.claude`
(`744de6b`, pushed):

- **`da1802c` — Desktop rejects the nested v2 config shape; write flat v1.** 2.2553.0.0 discards
  `$schemaVersion`, `inference`, `mcp`, `models`, `telemetry` *by name* and reports
  `mcpServerCount: 0`. S1 (2026-09-10) *inferred* both shapes from the bootstrap schema doc and
  called v2 "what the app's own JSON export writes"; no shipping build is known to accept it. The
  defect was an asymmetry — `cfgGet` read both shapes while the writers emitted v2 only, so
  boot-slapper could read what the app writes and could not write what the app reads. Adopt-mode hid
  it on macOS (adopting writes nothing); only the fresh-entry route exposes it. Two further bugs
  surfaced while testing the fix, both from conflating "named in the entry" with "loaded by the app":
  non-convergence (`cfgGet` prefers nested, so drift was reported forever after writing flat), and a
  **false green** — `bs plan` said `desktop-mcp: present` while Desktop loaded nothing. `facts()` now
  splits `current` (every server named anywhere) from `active` (the flat key alone); drift, the
  absent/drifted choice and `verify` all judge `active`.
- **`118f6b1` — `desktop-inference` no longer swaps a live credential for a helper the store cannot
  fill.** It planned the helper-script credential without asking whether the secret existed —
  `verify` checked, `detect`/`plan` did not — so onboard could take down a working box. Now blocks
  when the store is empty *and* the applied entry authenticates some other way (static key, or a
  foreign/IT helper, which fails identically). A box with nothing to lose is deliberately not
  blocked. Blocks rather than warns because apply steps run unattended under `--auto`.
- **`c0984b0` — `bs secrets set` had never once committed on Windows.** `PasswordVault` commits
  asynchronously, and the `exit 0` immediately after `$v.Add(...)`, reached through a `try`, tore
  PowerShell down mid-commit: exit code 0, no stderr, credential gone. **Deterministic, 5/5.**
  Ablation isolated the trigger precisely — `try { Add; exit 0 }` loses it; the same `Add` with the
  `exit` outside the `try`, or with no `exit`, persists every time. `$ErrorActionPreference` and the
  `Retrieve`/`Remove` preamble were red herrings. The script now ends on `Add` (with `EAP='Stop'` a
  failure already exits non-zero, so the hand-rolled `exit 45` bought nothing and cost the commit)
  and `set` reads the value back in a fresh process, throwing if absent.
- **`f2e9ed2` + `2c9cb47` — the S4 spike note** (`docs/spikes/2026-09-18-s4-*`, 293 lines) and the
  three CLAUDE.md claims it flips.
- **`744de6b` (`~/.claude`) — memory-auto-sync was invoking WSL, not Git Bash.** `syncMemory` spawned
  a bare `'bash'`, which resolves against the PATH of whatever runs the hook; Claude Desktop's
  process carries the *registry* PATH, where the first `bash.exe` is `C:\WINDOWS\system32\bash.exe`
  (the WSL launcher) because Git Bash's bin is never persisted there. WSL is broken on this box
  (`getpwuid(0) failed 2`, `Failed to mount C:\`), so every sync failed. `resolveBash()` now prefers
  `$MEMORY_SYNC_BASH`, then the bash beside git itself (derived from `git --exec-path` — arm64 puts
  `git.exe` under `clangarm64\bin`, so it walks up rather than assuming `<root>\bin`), then standard
  roots, then bare `bash` on macOS/Linux. Not a regression: the same code worked on 09-04 and 09-17
  under a different PATH, which is exactly why the interpreter cannot be left to the environment.

### Both Windows unknowns, closed

- **v2-entry survival: NO.** The question was whether a boot-slapper v2 entry survives an in-app
  apply; it never gets that far, because the app rejects it at *launch*. Treat the v2 shape as never
  validated against a shipping app, not as validated-then-regressed.
- **The `.ps1` helper spawn: YES, observed.** After the flat fix, the 01:07:18 launch logs
  `[custom-3p] running helper { helperPath: '…desktop-inference-credential.ps1', args: [] }` and the
  same for the mecp headers helper, alongside `mcpServerCount: 2`. S1's interpreter table was right;
  it is now observed rather than inferred. **arm64 observation** — `alienTop` (x64) is the tiebreak.
  Also newly visible: the app retries a rejected helper with backoff (`failCount: 1,
  backoffMs: 30000`) instead of dropping the server, so a late credential should connect without a
  relaunch.

### The correction that outlives all four fixes

**No Windows secret-store result recorded before 2026-09-18 is trustworthy** — every "key missing" on
a Windows box may have been the vault bug rather than an unstored key. That includes **S3's
Cornell-box `bs doctor` reds** (2026-09-17, JCB-L-T000692). macOS is unaffected (`KeychainStore`
shells out to `security -i` and never had the pattern). Any decision-log entry reasoning from "the key
is missing on Windows" should be re-read.

## Verification performed

- **boot-slapper: 264/264 unit tests, 32 files** (was 256 at session start — 8 new tests across the
  three fixes). `npm run typecheck` and `npm run build` clean. The contract test passing matters
  specifically: it proves the new `ctx.secrets.get` inside `detect` still writes nothing and only
  makes allowlisted probes.
- **`~/.claude`: parity gate PASS on all 9 scenarios** (`scripts/tests/parity-memory-sync.mjs` —
  clean-start, end-commit-push, conflict-adopt, wedge-recovery, offline-alert, lock-contention,
  stale-lock-steal, missing-repo, bad-action; bash and node implementations identical). The file
  header calls this gate the contract, so it ran before the fix was trusted.
- **Live, on the box:** `bs plan` moved `desktop-mcp` from the false `present` → `absent` → `present`
  as the servers were written flat; `desktop-inference` moved `blocked` → `drifted` when the vault
  started working, releasing the new guard exactly as designed. `bs secrets check cornell-ai-gateway`
  reports **present**, and the credential helper that failed with `Element not found` an hour earlier
  now exits 0 with a 25-byte `sk-`-prefixed value (length and prefix checked; value never printed).
  A real `memory-auto-sync start` logs `OK` with push and pull both running, picking up a file stuck
  since 2026-09-17.
- **Not run:** `npm run test:parity` (gate 1 needs `~/.claude/bootstrap.sh`, absent here). Nothing on
  macOS. No `bs onboard --only desktop-inference` yet — that is the next step and it ends the session.

## Postscript (same session, after the note was first written): gate 2's Windows leg is CLOSED

`bs onboard --only desktop-inference` ran at 12:02. **All three desktop artifacts now report
`present` on Windows for the first time.** The 12:02:47 launch is clean, and two of the three signals
are confirmations by *absence*:

- **zero** `Ignoring local configuration value` lines (the dead v2 block is gone from the entry)
- **zero** `[custom-3p] credential helper failed` after 12:02 — the inference helper is spawned at
  12:02:47 and nothing follows it, versus 01:07:58 where the same helper logged both an exit-1 and a
  failure
- `mcpServerCount: 2`, and `ConfigHealth` improved from `provider_error` → `not_testable` (the app
  declining to probe a helper-supplied credential, not a fault)

The final entry is pure flat v1: `inferenceCredentialKind: "helper-script"`,
`inferenceCredentialHelper` pointing at the `.ps1`, both managed servers under flat
`managedMcpServers`, no nested `mcp`/`inference` block. Note `openbrain`'s `oauth` came back as
`{ mode: "dcr" }` — boot-slapper wrote `true` and the app normalized it, which is exactly what
`sameServer` (oauth by presence) exists to tolerate; a 2026-09-16 Mac rule now confirmed on Windows.

**The helper is confirmed live, not the leftover static key.** Desktop re-spawned
`desktop-inference-credential.ps1` at 12:02:47, 14:49:28 and 18:52:35 — roughly the 3600 s TTL — which
it would have no reason to do if it were reading `inferenceGatewayApiKey`. And the decisive evidence
needed no log at all: a Claude Code session ran in Desktop's 3P mode against the Cornell gateway for
hours afterwards. Inference through the `.ps1` helper is verified end-to-end.

**Still in the entry: `inferenceGatewayApiKey` in plaintext.** `merged()` only overwrites `OWNED` keys,
deliberately, so boot-slapper never deletes what it did not write. Rotation is ordinary hygiene for two
plaintext copies (this entry and `claude_desktop_config.json`'s argv) — *not* a diagnostic, as the
refresh cadence already settles which path is live. An earlier draft of this note claimed rotation was
the only way to know; that was wrong.

One `credential helper failed (reason=spawn-failed)` at 18:52:35 — a different class from the
`non-zero-exit` failures fixed today: the process never started, and the app retried in the same second
and carried on. n=1 across ~7 hours and three refreshes, so not chased. Noted because a cold
`powershell` spawn is also the suspected cause of the `shims.test.ts` flake on this box, so a
recurrence probably shares a cause and a fix.

## Second postscript (22:22): MeCP connected on Windows; a fifth bug found and fixed

A `--device yoga-novo --scope write` token was minted (locally — the master was already on the box),
stored via `bs secrets set mecp-device-token`, and Desktop picked it up **on its own retry cycle, no
relaunch**:

    22:22:46 [custom3p-mcp-headers] running helper { helperPath: '…desktop-mcp-mecp-headers.ps1', args: [] }
    22:22:47 [custom3p-mcp-headers] resolved { server: 'mecp', headerNames: [ 'Authorization' ] }
    22:22:47 [custom3p-mcp] server connected { name: 'mecp', toolCount: 97, hostPid: 22252 }

**97 tools — the same count as the Mac (CLAUDE.md, JCB-AL-ACA34 2026-09-16)**, which settles the scope
question empirically: had `applyReadOnlyToolFilter` run, the count would be lower. So write-scoped
device tokens are genuinely write-capable and no master key is needed on a device. The `headersHelper`
path is now proven on Windows with a live credential — the last thing the Mac had that Windows did not.
`desktop-mcp` verify is fully green (both servers, helper current, token present), and the **Desktop
half of `open-brain-auth` turned ✓ unprompted**; only the Claude Code grant is outstanding.

**A fifth bug surfaced on the way (`f9c2cb6`): `bs secrets set` showed no prompt on Windows.** `ask()`
in `src/ui/prompt.ts` passed `""` as readline's prompt when hiding the answer and wrote the prompt by
hand; readline then redrew an empty line over it (`ESC[1G ESC[0J` — cursor to column 1, erase to end of
screen). Most terminals raced and usually showed the text; PowerShell erased it every time, so the
command sat at a blank line looking like it had exited. Readline now owns the prompt string, and
`ttyPrompter` takes injectable streams — which is *why* this shipped in the first place: it hardcoded
`process.stdin`/`stdout`, so only `headlessPrompter` had coverage. Three new tests against a fake tty,
verified by reverting the fix on a scratch copy and watching them fail. **This retires the
`_writeToOutput` guard** from the deferred Phase 1 cleanups, where it had sat since Phase 2.

## Open items / known follow-ups
- **Rotate the gateway key — deliberately deferred by the owner 2026-09-18, not forgotten.** Hygiene,
  not a diagnostic (see postscript): two plaintext copies, the config-library entry and
  `claude_desktop_config.json`'s `cornell_secure_tools` argv (`--header x-litellm-api-key:Bearer sk-…`),
  the latter visible to any process listing. Cornell-side action when convenient.
- **`~/.config/mecp/api_key` on this box appears to hold the MASTER MeCP key, not a device token.**
  Found while looking for an existing token to reuse. It is 39 chars with **no dots — not a JWT**,
  and `mecp/scripts/mint-device-token.ts` mints device tokens as JWTs (`createJwt("device",
  { device, scope }, …)` — per-device, `read`/`write`, ≤366-day expiry, revocable via
  `MECP_DEVICE_DENYLIST`). The script's own header says the master is needed only where minting
  happens, "so devices never need it". It **does** authenticate: `Authorization: Bearer <value>` →
  200 OK on `POST https://mecp.kearnsapuya.net/mcp` (initialize), verified 2026-09-18 — which is the
  problem, not the reassurance. Present since 2026-08-06.
  **Do not copy it into the vault as `mecp-device-token`**: that would give a master-scoped credential
  a second home and wire it into two shims that feed Claude Desktop, with none of the per-device
  revocation, scope limit or expiry the device-token design exists to provide. Correct fix is the
  runbook's: `API_KEY=… npx tsx scripts/mint-device-token.ts --device yoga-novo --scope write`,
  install over that file (mode 600), then `bs secrets set mecp-device-token` with the same value.
  Then consider rotating the master (which kills all derived tokens — plan re-minting).
  **There is no read-only-vs-master tradeoff here, which is the natural objection** (and the work item
  is even named `mecp-readonly-session-token-and-rotation`): read-only is only the *default*.
  `--scope write` grants the **full MCP tool surface** — `api/mcp.ts:215` filters tools only when
  `principal.scope === "read"`, `api/_lib/mcp-auth.ts:53` honors the write claim, and
  `api/__tests__/mcp-auth-device.test.ts:46` covers it. The sole thing a write device token cannot reach
  is `/api/api-usage/*`, which stays master/OAuth-only and is not what boot-slapper's `mecp` server
  talks to. Since the master is already on this box, minting can happen here rather than on an admin box.
  Why it hid for six weeks: the mint script's install path is `~/.config/mecp/api_key` for *both*
  credential kinds, so a master key installed there is indistinguishable from a provisioned device
  except by JWT shape. A shape check at that read site would surface it, and other devices are worth
  checking for the same condition. Spawned as its own task; boot-slapper's two service names
  (`mecp-api-key` vs `mecp-device-token`) are confirmed *not* redundant.
- **MeCP is still unwritten** — no `mecp-device-token` in the vault (and, now known, no way to have
  stored one before today's fix). S3's staging block *and* S4's are both undrained: a **DONE** for the
  v2 schema item, two **SUPERSEDE**s (v2 answered no; the `.ps1` belief moves from inferred to
  observed), a **DONE** for the vault bug carrying the pre-09-18 correction above, and a
  `phase-3-desktop-cutover` update. First box with a device token drains both.
- **`MIN_DESKTOP_VERSION` is `1.19367.0`** but S2 records the `managedMcpServers` 3P scope as
  ≥`1.2581.0` — a different threshold, and these strings do not order the way semver suggests.
  Nothing is blocked today. Filed in CLAUDE.md, not chased.
- **Optional:** clear the dead v2 block from the entry by hand to quiet the log, after the onboard
  confirms. Back it up first; not boot-slapper's job.
- Stale `projects/dotfiles/onepassword-secret-retrieval.md.conflict-yogaNovo` sidecar — already
  tracked as MeCP `memory-sync-sidecar-resolution-tooling`, not new.
- **`_meta.json` was renamed by hand** this session (`Default` → `boot-slapper`) to take ownership of
  the app-authored applied entry; `ourEntry` falls back to the name when no sidecar id matches, and
  `bs onboard` then pinned the id. Backup kept at
  `~/.config/boot-slapper/backups/_meta.json.bs-backup-20260918-003216`, deliberately *outside* the
  store because Desktop may enumerate that directory.

## Files of interest

- `docs/spikes/2026-09-18-s4-desktop-rejects-the-v2-config-entry.md` — the finding, the ablation
  table, the MeCP staging block, and what the run says about method
- `src/artifacts/desktop-inference.ts` — `wantedDoc` (flat emitter), `blockedReason` (credential guard)
- `src/artifacts/desktop-mcp.ts` — `facts()`'s `current` vs `active` split
- `src/engine/secrets/passwordvault.ts` — `set`, and why nothing may follow `Add`
- `~/.claude/scripts/memory-auto-sync.mjs` — `resolveBash()`
- `%LOCALAPPDATA%\Claude-3p\logs\main.log` — lines 1970–1990 (v2 rejection, `mcpServerCount: 0`),
  ~3139 onward (flat launch, `mcpServerCount: 2`, both helper spawns), 3023/3349 (the vault failures)

## Next session — suggested starting point

**Fetch first.** Gate 2's Windows leg is closed (see postscript), so the next moves are the two
credential items, in this order:

1. **Drain the two MeCP staging blocks** (S3's and S4's). MeCP tools are now live in Desktop's Chat and
   Cowork surfaces, so this is finally doable from *that* surface — the Code session where all this work
   happened has no MeCP tools wired in, which is why it could not be done here. The entries are listed
   below and include a correction that invalidates earlier Windows secret-store findings; the longer it
   sits, the more likely something reasons from the bad data.
2. **Replace the suspected master key in `~/.config/mecp/api_key`.** A write-scoped device token now
   exists in the vault and is proven working (97 tools), so the remaining task is narrower than it was:
   install that token over the file, decide whether the master needs rotating after six weeks on a
   personal laptop, and add a shape check so a non-JWT value there is visible rather than silent.
3. ~~Rotate the Cornell gateway key~~ — **deferred by the owner 2026-09-18.** Still worth doing
   eventually; nothing depends on it.
4. `open-brain-auth`: the Desktop grant is ✓; the Claude Code grant is a one-time `/mcp → openbrain →
   Authenticate`.

Then, on a MeCP-connected box, drain the two staging blocks. They are the only unrecorded output of the
last three sessions, and one is a correction that invalidates earlier Windows findings — the longer it
sits, the more likely something reasons from the bad data.

Gate 2 itself: the Windows box is done. What remains for the gate as a whole is whatever the runbook
still assigns to macOS, plus `open-brain-auth` (a manual in-app Connect on this box) — neither blocked.

**Method note worth carrying:** the v2 schema, the "flat is typical of a hand-authored entry" comment,
and the `.ps1` interpreter claim were all inferred from documents and held confidently for a week. Two
were wrong. Both survived because the code was never run against the real thing in the one
configuration that mattered — adopt-mode never exercised the writer; `set`/`get` were only ever
exercised within a single PowerShell process. S1/S2 flagged their own inference honestly; the failure
was downstream, in treating inference as settled.
