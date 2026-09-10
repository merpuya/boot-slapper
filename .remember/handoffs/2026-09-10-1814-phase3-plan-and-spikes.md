# Handoff: Phase 3 spikes done, Phase 3 plan written — execution not started

**Session date:** 2026-09-10
**Author:** merpuya via Claude
**Scope:** After the Phase 2 merge (PR #2 → `cce3adf`): fix the Ink summary-line bug, file two cosmetics follow-ups, run the two Desktop spikes read-only on JCB-AL-ACA34, and write the Phase 3 plan. Pick-up point for any device.

## What shipped

- Ink Doctor summary line survived `npx`'s spinner cleanup after the fix in `e8fa79c` (trailing newline after `waitUntilExit`; test asserts the last frame is `\n`).
- Two cosmetics follow-ups filed in `CLAUDE.md` and MeCP `project:boot-slapper/tui-output-cosmetics` (`53dd64a`).
- Spikes S1 and S2 in `docs/spikes/2026-09-10-s1-desktop-3p-config-location.md` and `…-s2-desktop-http-mcp-headers.md` (`fa1aa33`). Findings that bind the plan: Claude Desktop 1.49585.0 never reads user defaults; the per-user target is the `Claude-3p/configLibrary/` entry (`_meta.json` + `<uuid>.json`, v1 flat or v2 nested schema), overridden by MDM plists / `HKLM`+`HKCU` unless they set only app-behavior keys (this Mac's Cornell profile sets only `disableAutoUpdates`); `claude_desktop_config.json` is stdio-only, so remote MCP goes through `managedMcpServers` in the same entry with a headers helper (MeCP) or `oauth: true` (Open Brain), no `mcp-remote`; Cowork user skills live under `local-agent-mode-sessions/skills-plugin/<org>/<account>/skills/` with a manifest; Windows helpers may be `.ps1` (Desktop runs them through `powershell.exe -File`).
- Phase 3 plan `docs/superpowers/plans/2026-09-10-boot-slapper-phase3-desktop-cutover.md` (`ace2d92`): nine tasks (engine `Io.fetch` + cross-surface `requires` + `engine/desktop.ts`; prereqs + helper templates; `desktop-inference`; `desktop-mcp`; `desktop-skills`; `open-brain-auth` + `hosted-connectors`; profile on both surfaces + contract allowlist + skins parity; staged gate-2 shims under `docs/cutover/`; docs), seven recorded spec deviations, self-review done.
- MeCP `project:boot-slapper/phase-3-desktop-cutover` flipped to IN_PROGRESS with links to `fa1aa33` and `ace2d92`; vault README status updated.

## Verification performed

- `npm test`: 143/143 passed on `main` at `fa1aa33` (2026-09-10 17:44 EDT). The two later commits are docs only; not re-run.
- Spikes: read-only; no `defaults write`, registry, or Desktop config touched. Permission-classifier denials left three things unverified (keys-only shape of the existing applied library entry; Desktop's helper spawn code beyond the interpreter table; a Tailscale doc page) — listed in the spike notes.
- Phase 3 plan: placeholder scan clean; DAG order for the twelve-artifact profile hand-checked (`prereqs, hosted-connectors, claude-config, secrets, project-memory, plugins, gateway-launch, mct, desktop-inference, desktop-mcp, desktop-skills, open-brain-auth`).

## Open items / known follow-ups

- **Execution not started.** The plan was written; the execution-mode question (subagent-driven on a worktree branch like Phase 2, vs inline) was left unanswered when the session was saved.
- **Gap in the plan:** Windows `bash` resolution for `project-memory` (`<git root>\bin\bash.exe` via `git --exec-path` on win32) is a `CLAUDE.md` follow-up and a gate-2 prerequisite but has no task; add it as Task 1b or fold into Task 7 before executing.
- Gate 2 waits for the two new boxes; `bootstrap.sh` and `claude-gw.zsh` stay live. Only `bs env | plan | doctor | capture` touch this Mac; a `bs onboard --only desktop-inference,desktop-mcp,desktop-skills` rehearsal here is the owner's call after Task 9.
- `CLAUDE.md` Known follow-ups all still open (verified by grep this session): deferred engine cleanups, UTF-8 capture, project-memory re-offer, TUI Ctrl+C child kill, plugins `-y`, mct soft-skip, TUI wrapped-line indent, headless double detected line.
- `.remember/now.md` on this Mac still says "Phase 3 plan in progress"; it is device-local — this note is the cross-device truth.

## Files of interest

- `docs/spikes/2026-09-10-s1-desktop-3p-config-location.md`, `docs/spikes/2026-09-10-s2-desktop-http-mcp-headers.md`
- `docs/superpowers/plans/2026-09-10-boot-slapper-phase3-desktop-cutover.md`
- `src/ui/tui/index.tsx` (summary-line fix), `CLAUDE.md` (follow-ups + spikes pointer)

## Next session — suggested starting point

Read the Phase 3 plan header and Deviations, decide the execution mode, add the Windows-bash task, then start Task 1 with `npm test` reporting 143 passed as the baseline. MeCP: `bootstrap_context` scope `project:boot-slapper`.
