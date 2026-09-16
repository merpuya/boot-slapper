# Handoff: First gate-2 rehearsal on JCB-AL-ACA34 (adopt route); gate 1 re-asserted; three seams fixed

**Session date:** 2026-09-16
**Author:** merpuya via Claude
**Scope:** After the morning's adopt-path fix, walk the gate-2 rehearsal on this Mac the way the box actually is (hand-authored applied entry, no boot-slapper entry), fix what it exposed, and close the gate-1 parity disagreement. Session on **JCB-AL-ACA34**, Desktop 2.110.0.

## What shipped

- **Rehearsal, adopt route, complete.** Desktop quit; `openbrain` (oauth) and `mecp` (headers helper) added by hand to the applied v1 flat "Cornell" entry under `managedMcpServers` (backup under `~/.config/boot-slapper/backups/`); `bs onboard --only desktop-mcp` wrote the helper (mode 700); `bs onboard --only desktop-skills` copied `mecp-conventions` into Cowork and added the manifest row; owner signed out of claude.ai and chose the third-party option; Open Brain connected in-app. `~/Library/Logs/Claude-3p/main.log`: helper ok (44–126 ms), mecp connected with 97 tools (`auth: headers-helper`), openbrain 4 tools (`auth: oauth-cached`), no validation errors. Owner confirmed Cowork lists the skill. `bs doctor`: all four desktop artifacts green.
- **`4cb42fb`** desktop-mcp reads `managedMcpServers` from a v1 flat entry (it only read v2's `mcp.managedServers`; servers added to the hand-authored entry were invisible).
- **`ea801ff`** desktop-mcp compares servers with oauth by presence and keeps the app's oauth object on rewrite. Desktop's in-app apply had normalized `oauth: true` to `{ mode: "dcr" }` and added five default keys, so strict equality called openbrain stale.
- **`911a9c8`** claude-config verify's `clean` check counts untracked paths like `bootstrap.sh --doctor`; detect's drift stays tracked-only. Plus **dotclaude `1318efe`**: the four 2026-07-14 handoff notes that caused the disagreement are archived (tracked by fleet convention since `c600e40`).
- **`9dd7dfb`** gate-2 runbook: "Adopt route" section (six steps, the doctor-cannot-see-mode caveat, the re-serialization fact). **`dcbc705`, `0df300a`**: CLAUDE.md verification bullet corrected and extended.
- **MeCP:** `desktop-adopt-path-dead-end`, `gate-2-runbook-adopt-route`, `doctor-parity-clean-check-untracked` all COMPLETED with commit links; `phase-3-desktop-cutover` carries box, rehearsal and verified notes; vault README Status updated.

## Verification performed

- Unit **250/250** (34 files); typecheck and build clean after every change; `npm run test:parity` **2/2** on this Mac (live doctor parity + skins) after `911a9c8` and dotclaude `1318efe`.
- Each fix TDD-first: the v1 flat, oauth-normalization and untracked-clean tests were watched failing before the code changed.
- Controlled test for the re-serialization claim: sha256 + mtime of both library files before and after quit-and-relaunch — byte-identical; both servers reconnected. The one rewrite (10:10:24, relaunch at 10:10:28) was an in-app apply. The OAuth token save did not touch the entry.
- **Not run:** the Ink TUI path; nothing on Windows.

## Open items / known follow-ups

- **Gate 2 proper** still needs the two new boxes (second Mac fresh-entry route, Cornell Windows box) and the memory round-trip; the cutover commits stay staged. `bootstrap.sh` / `claude-gw.zsh` remain live.
- **Unverified:** a `bs`-written v2 entry surviving an in-app apply (needs a fresh-entry box); the Windows `.ps1` helper through `powershell.exe -File`.
- **Remaining doctor reds on this Mac** are the gate-2 items themselves: hooks block drift (claude-config) and the gateway-launch wrapper + `.zshrc` line.
- CLAUDE.md follow-ups unchanged otherwise (TUI cosmetics, mct skipped outcome, duplicate detected print, etc.).

## Files of interest

- `src/artifacts/desktop-mcp.ts` — `sameServer`, `keepOauth`, `cfgGet` read of servers
- `src/artifacts/claude-config.ts` — `untracked` in Facts, verify `clean`
- `tests/unit/artifacts/desktop-mcp.test.ts`, `tests/unit/artifacts/claude-config.test.ts`
- `docs/cutover/gate-2-runbook.md` — "Adopt route" section
- `CLAUDE.md` — applied-entry rule; Desktop verification bullet

## Next session — suggested starting point

Verify the hostname first. On JCB-AL-ACA34 nothing is pending; `bs doctor` should show only the two gate-2 reds. The next real step is gate 2 on a second box: follow the runbook's step 3 (fresh entry) there, and use that box to answer the v2-entry survival question by opening the in-app window and applying once.
