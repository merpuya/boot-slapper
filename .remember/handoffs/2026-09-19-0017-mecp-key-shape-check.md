# Handoff: the MeCP credential trap is closed here and guarded everywhere

**Session date:** 2026-09-19 (began 2026-09-18 evening)
**Author:** merpuya via Claude
**Scope:** Verify that three sessions of MeCP write-debt actually drained, replace the suspected master key on `yogaNovo`, and build the guard that would have caught it — then a full `/save` pass across every persistence surface.

## What shipped

- **The staging-block debt was already drained** — and the 2026-09-18 handoff saying "MeCP is still unwritten" was stale by ~25 minutes when this session read it. A session identifying itself as `claude:drain-staging-2026-09-18` wrote all of it at 02:56–02:59Z: `decision-log/2026-09-17-gate-2-windows-box-is-yoganovo`, `decision-log/2026-09-18-desktop-config-library-flat-v1-only`, `decision-log/2026-09-18-verify-the-effect-not-the-artifact`, the `.ps1`-helper supersede amended into `decision-log/desktop-secrets-via-helper-executables`, the `windows_2026_09_18` block on `phase-3-desktop-cutover`, and three work items to COMPLETED including `gateway-launch-both-powershell-profiles`. Nothing needed rewriting. **Provenance (`created_by`) is what settled it** — not diffing content against the staging blocks.
- **`~/.config/mecp/api_key` now holds the write-scoped device token** (199-char JWT). It had held a 39-character non-JWT — the master `API_KEY` — since 2026-08-06. Six weeks of sending a master credential to MeCP on every session start from a personal laptop.
- **The guard shipped: dotclaude `7647d17`.** Both hook twins (`load-mecp-context.mjs`, `load-mecp-context.sh`) shape-check the file-sourced key and emit a `<mecp-credential-warning>` block on stdout naming the remedy.
- **boot-slapper `e23d2c3`** — the `mecp-api-key` / `mecp-device-token` bullet amended: cleared here, **still armed on every other box** until self-update propagates.
- **boot-slapper `a4ffa6a`** — `Known follow-ups` split: five of sixteen bullets were verified fact records, not follow-ups, and moved to `Rules that are not obvious from the code`. Now 15 rules / 11 follow-ups.
- **Full `/save` pass** — see "Persistence" below.

## Two design calls worth carrying

- **Warn, never refuse.** The hook fails open by contract and the wrong credential still *works*; refusing would strip context from a functioning box to punish a hygiene problem.
- **stdout, not the log.** The log recorded this correctly for six weeks and nobody read it, because there was no failure to send anyone looking. For a SessionStart hook, stdout *is* the session context — it lands in front of a reader every session until fixed. Choose the channel by where attention already is.
- **Check at the read site, not the write site.** `bs secrets set` faithfully stores whatever was pasted and is not wrong to; the reader knows what it is about to send and to whom. The master key was installed by a hand-run shell redirect no setter ever saw.

## Verification performed

- **`scripts/tests/parity-session-hooks.mjs`: 27/27, PARITY OK.** Five new assertions; the 22 pre-existing cases unchanged.
- `makeHome` gained a `keyFile` option because **every pre-existing case injected the key via `MECP_API_KEY`** — the file branch, where the bug lived, had zero coverage. The harness's convenience path was not the production path.
- Each new case is compared **and** asserted independently, per `parity_gate_2026_09_09`: parity cannot see a defect present in both twins.
- One assertion checks the warning never echoes the credential.
- **Live, by effect not inspection:** `load-mecp-context.mjs` run end-to-end logged `identity: fetched OK (6796 bytes), cache refreshed` — a real authenticated fetch. An immediate second run logged only `cache hit`, which is what a shape-only check would have accepted. Zero warning blocks on the live box.
- **Not run this session:** boot-slapper's own unit suite, typecheck, or build — no `src/` changes were made to it. `bs secrets check` is untouched.

## Persistence (full `/save`)

- **MeCP:** `project:dotclaude/mecp-key-file-shape-check` created, then SCOPED → IN_PROGRESS with a `shipped_2026_09_19` narrative. `phase-3-desktop-cutover` gained `credentials_2026_09_18`, later extended with both SHAs.
- **Vault:** `20-projects/boot-slapper/README.md` Status rewritten — its **Pending** line still listed three things all now closed, including the v2 question, which closed *negatively* (a "pending" line cannot express that). Spikes line now names S3/S4 and flags S1/S2 as inference.
- **Vault sweep otherwise clean:** 40 project dirs vs 40 portfolio projects, identical sets; daily notes healthy (162, latest `2026-09-18.md`, today's not due until 23:30Z — note `vault_list` pages **oldest-first**, so this required paging to the last page); inbox empty but for a placeholder README.
- **Open Brain:** three thoughts — inferred claims should decay until exercised against real hardware; a shared install path collapses a privilege distinction maintained everywhere else; a fail-open system needs a loud channel that is not its log.
- **Auto-memory:** `reference_dotclaude_live_checkout.md` added.

## Open items / known follow-ups

- **Site 3 of the shape check:** `bs secrets check` reports only `present`/`missing` — true and useless for six weeks. Separate repo; not where the time was lost.
- **Master-key rotation** after six weeks on a personal laptop — owner's call, deliberately not folded into the work item. Nothing depends on it.
- **Code-side Open Brain grant** (`/mcp → openbrain → Authenticate`) — needs an interactive session. Last item from the 2026-09-18 handoff's list of four.
- **`~/projects/dotclaude` is stale** at `17210d4` with no node port in it. Edits there succeed and change nothing; `~/.claude` is live. Now in auto-memory.
- **`State.facts` / `BS_REQUIRE_PARITY=1`** dropped from the deferred list on zero-hits evidence. Absence is weak — re-add if the Phase 2 plan still names them.
- **README ↔ summary check was scoped** to boot-slapper and dotclaude, not all 40 projects.

## Files of interest

- `~/.claude/scripts/load-mecp-context.mjs` — key resolution + the shape check and its rationale
- `~/.claude/scripts/load-mecp-context.sh` — the twin; note `jwt_shape` must be a variable, since an unquoted regex inside `[[ =~ ]]` gets word-split
- `~/.claude/scripts/tests/parity-session-hooks.mjs` — `makeHome`'s `keyFile`, the five assertions
- `CLAUDE.md` — restructured; the `mecp-api-key` bullet now carries both a closed fact and an open one
- `docs/spikes/2026-09-18-s4-desktop-rejects-the-v2-config-entry.md` — where the 40-byte key was first noticed

## Next session — suggested starting point

Gate 2's Windows leg is closed and the credential work is done. The remaining named items are **macOS**: whatever `docs/cutover/gate-2-runbook.md` assigns there, plus the Code-side Open Brain grant (one interactive `/mcp` step, doable anywhere).

If you want a small, self-contained win first, site 3 — teaching `bs secrets check` to say more than `present`/`missing` — is maybe an hour and closes `project:dotclaude/mecp-key-file-shape-check`.

**Method note this session earned twice.** Both the 2026-09-18 handoff ("MeCP is still unwritten") and the vault README ("Pending: … whether a v2 entry survives an in-app apply") were accurate when written and false when read. A handoff is a report about a past state, not a standing invariant. The surface that can later say "done" is the work item — which is exactly why site 3 is filed as one and not as a line in this note.
