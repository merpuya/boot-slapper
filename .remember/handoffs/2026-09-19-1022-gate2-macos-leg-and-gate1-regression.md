# Handoff: gate 2's macOS leg assessed, gate 1 regressed and fixed, this Mac at zero errors

**Session date:** 2026-09-19
**Author:** merpuya via Claude
**Scope:** Resume on JCB-AL-ACA34, verify `8f2634a`, then push gate 2 as far as this Mac can take it without the Yoga present.

## What shipped

- **`8f2634a` verified** (site 3 of the MeCP key-shape check, written the night before without a test run): typecheck clean, build clean, unit 274/274. MeCP `project:dotclaude/mecp-key-file-shape-check` was already COMPLETED.
- **`gateway-launch` onboarded on this Mac** (`bs onboard --only gateway-launch --auto`, allowed by the Phase 2 plan): wrapper at `~/.config/boot-slapper/claude-gw.zsh`, one line appended to `.zshrc` (diffed against a backup: exactly that line). The legacy dotfiles wrapper is still sourced first and is shadowed — `whence -v` in a clean zsh names the boot-slapper file. `bs doctor` here went from 2 errors / 5 warnings to 0 errors / 6 warnings (the sixth is the expected `legacy-wrapper`).
- **Gate 2 status recorded on both legs — neither meets the runbook's condition block** (`ebd1c49`: runbook Status table + CLAUDE.md wording; MeCP `phase-3-desktop-cutover` key `macos_2026_09_19`). Windows: three desktop artifacts present 2026-09-18, but no whole-box doctor result, no `docs/evidence/` file (the directory has never existed) and no memory round-trip. macOS: the spec's "new Mac" is a second Mac that has not arrived; this box only ever exercised the adopt route, so the fresh-entry writer is proven on one OS. CLAUDE.md no longer says the Windows leg is closed.
- **Gate 1 regression found and fixed** — `npm run test:parity` failed on `claude-config.hooks-match: bash=error bs=ok`. Cause: `apply-canonical-hooks.sh` has rendered canonical per platform since dotclaude `e9bd156` (2026-09-06), stripping the dotclaude-only `platforms` key, while `bootstrap.sh --doctor` still compared the raw file — red on every rendered box, and pointing at an applier that then says "already in sync". The live block was byte-identical to the darwin render. **dotclaude `24c6835`**: the doctor now compares against the applier's `DOTCLAUDE_RENDER_ONLY=1` output. Same commit ignores `skills/synced/` (Claude Code's claude.ai synced-skills cache, tool-written at session start), which the `!skills/**` unignore surfaced as untracked drift. Parity 2/2 again; bash doctor "all checks passed".
- **Memory round-trip, push half** (runbook step 5): probe `gate2-roundtrip-JCB-AL-ACA34.md` in the `dotfiles` memory project — the only project mapped on both this Mac and `yogaNovo`, so no new mapping was needed — mirrored with `sync-memory push` and committed + pushed by `memory-auto-sync.mjs end` as claude-memory-sync `a191fa5` (verified on origin).
- **`9d9ed99`**: CLAUDE.md follow-up for the parity test's vitest worker RPC timeout (below).
- Owner declined gateway-key rotation again; recorded, not filed.

## Verification performed

- boot-slapper at `8f2634a`: `npm run typecheck` clean, `npm run build` clean, `npm test` 274/274 (33 files).
- `npm run test:parity`: 1 failed / 1 passed before the dotclaude fix; **2/2 after**. Every run also prints one vitest unhandled error, `Timeout calling "onTaskUpdate"` — the 66 s blocking `spawnSync` starves the worker's RPC. Present in the failing run too, so it is noise, not a verdict; filed in CLAUDE.md.
- `~/.claude/bootstrap.sh --doctor` after the fix: "Doctor: all checks passed"; `bash -n` clean.
- `bs doctor --json` on this box after onboarding: status `warn`, 0 errors. JSON kept in the session scratchpad, deliberately not in `docs/evidence/` (this box is not the gate box).
- `.zshrc` diffed against its pre-onboard copy: one added line. Both wrappers sourced in `zsh -f`; boot-slapper's definition wins.
- claude-memory-sync `a191fa5` contains the probe (10 insertions) and `git ls-remote` matches local.
- **Not run:** the Ink TUI path; anything on Windows; `bs doctor` on `yogaNovo`.

## Open items / known follow-ups

- **Gate 2 needs the second Mac** for the macOS leg, unless the owner decides JCB-AL-ACA34 stands in (a decision, not a finding — it would leave the fresh-entry writer verified on Windows only).
- **Next `yogaNovo` session, in order:** whole-box `bs doctor --json` into `docs/evidence/`; `sync-memory pull`, confirm the probe, create the reverse probe, push; then pull here and delete both probes. No `.conflict-*` sidecars allowed.
- **This box, owner-only:** `mct devices add` with `MCT_ADMIN_TOKEN` exported for that one command, then `bs secrets set mct-sync-token`; `/mcp → openbrain → Authenticate` for the Code-side grant.
- **Network, not code:** every `kearnsapuya.net` host timed out through the system resolver on Cornell campus DNS (`en18`, search domain `business.cornell.edu`) while `dig` and `curl --resolve` answered instantly. That blocked `mct sync` (fetch failed), the Open Brain grant and Desktop's MCP from here. One observation; in auto-memory as such.
- Parity test: make the doctor spawn async so vitest stops printing the RPC timeout (`9d9ed99`).
- 14 memory dirs unmapped on this device, including boot-slapper's own; archives and a `/private/var` temp dir among them. Mapping is the owner's call (Known follow-ups already carries the interactive re-offer nuisance).
- `~/.claude` drift after this session: none (`git status` clean after `24c6835`).

## Files of interest

- `docs/cutover/gate-2-runbook.md` — new Status section with the per-leg table
- `CLAUDE.md` — Windows bullet reworded; parity-spawn follow-up added
- `~/.claude/bootstrap.sh` — hooks compare now via the applier's render (dotclaude `24c6835`)
- `~/.claude/.gitignore` — `skills/synced/` re-ignored after the skills unignore
- `~/.config/boot-slapper/claude-gw.zsh` — generated wrapper, now live on this Mac
- `~/.claude/projects/-Users-aca34-projects-dotfiles/memory/gate2-roundtrip-JCB-AL-ACA34.md` — round-trip probe (delete after both directions confirm)

## Next session — suggested starting point

Check the hostname. On `yogaNovo`: the three unrecorded Windows-leg items above, in order — that is the whole remaining Windows work, and the round-trip's pull half is already waiting on the sync remote. On this Mac: nothing is pending beyond the two owner-only items; `bs doctor` should read `warn` with zero errors. Gate 2 as a whole still waits on the second Mac, and the runbook Status table is now the place that says so.

**Method note this session earned.** Two "green" claims were one observation deep: CLAUDE.md's "gate-2 leg closed" meant three artifacts, not the runbook's condition, and the bash doctor's hooks check had been red since the applier changed shape on 2026-09-06 without anyone running parity between then and now. Parity only catches what it is run against; a gate test that is not in CI is a gate that closes by hand.
