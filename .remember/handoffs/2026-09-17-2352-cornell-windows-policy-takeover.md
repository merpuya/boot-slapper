# Handoff: the Cornell Windows box is a policy takeover; gate 2 retargets to yogaNovo

> **Read this first: the session's code commit was dropped, not shipped.** It rediscovered the MSIX
> detection bug that `f708816` had already fixed the previous evening, and wrote a second, worse fix.
> Nothing of that survives on `main`. What shipped is two docs commits. The cause is the one procedural
> lesson worth carrying forward: **this session never fetched before starting work.** The 6-commit
> divergence was there the whole time.

**Session date:** 2026-09-17
**Author:** merpuya via Claude
**Scope:** A `/resume` on a Windows box that turned out to be neither the Mac the last-but-one handoff
assumed nor the YOGANOVO the last one used. Establish which box this is, run `bs doctor`, and follow
what it exposed. Session on **JCB-L-T000692** (Windows 11 Enterprise 26200, Cornell-managed, *not* a
`JCB-*-ACA34` asset — the Windows pilot box), Claude Desktop 2.110.0.0, MSIX `Claude_pzs8sxrjxfjjc`.
This session was hosted *inside* Claude Desktop on the box it was inspecting.

## What shipped

- **`3df78f0`** — S3 spike: `docs/spikes/2026-09-17-s3-windows-managed-policy-owns-desktop.md`.
  `HKLM\SOFTWARE\Policies\Claude` sets **16 keys** on this box, including `inferenceProvider`,
  `inferenceGatewayBaseUrl`, `inferenceCredentialHelper` and `managedMcpServers`. Only two
  (`isDesktopExtensionEnabled`, `chatTabEnabled`) are near app-behavior and none are in
  `APP_BEHAVIOR_KEYS`, so `managedTakeover` reports a takeover and the local config library is not
  consulted at all. `desktop-inference` and `desktop-mcp` are therefore **`blocked` by design** — the
  gate-2 runbook's step-3 prediction coming true, not a defect. IT already supplies both the credential
  helper and the managed servers through policy. `desktop-skills` is unaffected: Cowork's plugin
  directory was found under the org sentinel and is writable.
- **`5b37599`** — gate 2's Windows box becomes **`yogaNovo`**. Amended in the spec's §6 gate table *and*
  the runbook condition block, because the runbook's condition is a restatement of the spec and editing
  one alone leaves the two disagreeing. The spec keeps a dated note saying what the row used to say, so
  an older handoff quoting the original wording stays traceable. Step 3's registry check also flipped
  meaning: on the target box the key should be **absent** — it is a precondition, not a diagnostic, and
  if it is set the box is wrong and onboarding cannot fix it.

## The dropped commit, in full

`d52543a` (local only, never pushed, elided by `git rebase --onto origin/main d52543a`) fixed
`probeDesktopInstall`'s hardcoded `AnthropicPBC.Claude_fnn82j28hfe8t` by asking `Get-AppxPackage` and
matching on the publisher CN. It was TDD'd, 252/252 green, and verified live. It was also **redundant**:
`f708816` (2026-09-16 21:55, YOGANOVO) had already done the same thing, and `4efe63a` went further by
replacing the constant `desktopDataDir` with `resolveDesktopStore` — a second win32 assumption sitting
one function below the one this session fixed, which this session never questioned.

Dropped rather than reverted: the change never reached the remote, so there was no reason to record both
a wrong fix and its undo. Rebasing re-parented the two docs commits and elided the duplicate in one step.

Two things the remote history got right that this session would have got wrong:

- **`0805944`'s reasoning.** `6d9d268` moved the config library to roaming AppData; `0805944` reverted it
  because a box where 3P has never run shows the *first-party* layout, which looks like it argues for
  roaming and does not. This session read `%LOCALAPPDATA%\Claude-3p` here and treated it as settled — the
  right answer reached by luck, never distinguishing first-party from third-party layout. JCB-LL-ACA34 had
  already adjudicated this on 2026-09-15.
- **`4efe63a`'s premise.** Windows can carry several stores Desktop might read and the categories are not
  mutually exclusive; a constant `desktopDataDir` silently writes a library Desktop never reads. Two
  failed tdx-mcp pilot installs came from that.

## Verification performed

- After the rebase onto `4efe63a`: typecheck clean, **unit 256/256** (32 files, origin's suite — four more
  than the dropped branch had), build clean.
- `git diff origin/main --stat` before pushing: **docs only**, four files. Confirmed this session's
  `MSIX_QUERY` is absent and origin's `MSIX_PROBE` + `resolveDesktopStore` are intact.
- **The S3 finding reproduces against origin's code**, which is the claim that matters — the docs describe
  verified behavior, not this session's build. `bs doctor` on `5b37599`:
  `✓ Claude Desktop 2.110.0.0 at C:\Users\aca34\AppData\Local\Packages\Claude_pzs8sxrjxfjjc`, then the
  16-key takeover `✗` under both `desktop-inference` and `desktop-mcp`.
- Pushed `4efe63a..5b37599`; `main` and `origin/main` in sync, verified after.
- **Not run:** `npm run test:parity` — gate 1 needs the `cornell-ai-gateway` key and this box's store has
  none, so gate 1 is unassertable here. Nothing on macOS. Nothing on `yogaNovo`. No `bs onboard`, no write
  of any kind to this box.

## Open items / known follow-ups

- **MeCP was not written.** No MeCP tools in the session and no `mecp-device-token` on this box, so the
  conventions' belief-revision lookup could not run either. The exact entries are staged in the S3 doc's
  "MeCP staging" section for a connected session: work item
  `project:boot-slapper/windows-desktop-config-owned-by-cornell-it` at **SCOPED** (not BLOCKED — its
  blocker was the gate-2 scope question, resolved the same day), a **SUPERSEDE** for the gate-2 decision
  (it contradicts the spec's original row rather than refining it — close the old belief `valid_to:
  2026-09-17`, successor `valid_from: 2026-09-17`, two-part pointers), and an update to
  `project:boot-slapper/phase-3-desktop-cutover`.
- **`yogaNovo` cannot yet answer the three Windows unknowns either.** Per `4efe63a`, 3P mode has never run
  there — `desktop-skills` blocks on "Cowork has not run in third-party mode" and `resolveDesktopStore`
  reports the default store with `live: false`. Choosing it as gate 2's target is a decision about *where*
  to prove Windows, not a result. First action on that box: sign into third-party mode and open Cowork once.
  Recorded in both the spec note and the runbook condition block.
- **arm64 is a new axis.** `yogaNovo` is Snapdragon X Elite, so a `.ps1`-helper result there is an arm64
  result and does not automatically transfer to the x64 Cornell fleet. `alienTop` (x64, personal) is the
  tiebreak box. Detection itself is architecture-agnostic since `f708816`.
- **An unexplained merge was in progress** when the push was attempted — `.git/MERGE_HEAD` present, six
  files conflicted, and nothing in this session's reflog created it (reflog showed only the three local
  commits and the original clone). Aborted after confirming the one file that differed from origin was a
  handoff note already present in `f3f5ed3`/`c7dd403`. Worth knowing something outside the session can
  leave a merge staged in this checkout.
- **`tests/unit/shims.test.ts` flakes on Windows**, ~1 run in 4, either test. It shells out to `bash -n`
  and `powershell [scriptblock]::Create` to syntax-check the shims and a cold `powershell` spawn exceeds
  vitest's 5 s default `testTimeout`. Confirmed pre-existing and independent of any change here (the test
  reads the shim files off disk and touches no engine code; reproduced with the doc edits stashed). Filed
  in CLAUDE.md — give those two tests an explicit timeout, or warm the spawn.
- The Cornell box is still worth onboarding for what works there (`desktop-skills`, the Code-surface
  artifacts). It just does not gate the cutover. Its remaining doctor reds beyond the takeover are the
  never-onboarded ones: `cornell-ai` marketplace, four plugins, the `claude-gw.ps1` wrapper, and the
  PowerShell profile line — note that profile path resolves into OneDrive (`…\OneDrive - Cornell
  University\Documents\WindowsPowerShell\…`) because Known Folder Move is active, so a per-box wrapper
  line written there would sync to every box the account touches. Worth a look before onboarding it.

## Files of interest

- `docs/spikes/2026-09-17-s3-windows-managed-policy-owns-desktop.md` — the finding, the two questions this
  box cannot answer, and the MeCP staging block
- `docs/superpowers/specs/2026-09-09-boot-slapper-design.md` §6 — amended gate table + the dated note
- `docs/cutover/gate-2-runbook.md` — condition block (why not the Cornell box, arm64, 3P-mode prerequisite)
- `src/engine/desktop.ts` — `managedSources` / `managedTakeover` (the takeover logic, correct as-is);
  `resolveDesktopStore`, `MSIX_PROBE` (origin's, from `4efe63a` / `f708816`)

## Next session — suggested starting point

**Fetch first.** Then: if on `yogaNovo`, the first real step is signing Desktop into third-party mode and
opening Cowork once — that unblocks `desktop-skills` and makes the configLibrary write path, the `.ps1`
helper spawn, and v2-entry survival answerable for the first time on Windows. If on a MeCP-connected box,
drain the S3 doc's staging block instead; it is the only unrecorded output of this session.
