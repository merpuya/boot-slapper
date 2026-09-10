# boot-slapper

Cross-platform onboarding for Claude Code against a third-party provider. Design: `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`.
Plans: `docs/superpowers/plans/` (Phase 1 engine, Phase 2 artifacts + TUI + capture + shims; Phase 3 desktop + cutover pending).
Spikes: `docs/spikes/` — S1/S2 (2026-09-10) settle where the Phase 3 desktop artifacts write: the per-user `Claude-3p/configLibrary/` document (inference + `managedMcpServers`), never user defaults or `claude_desktop_config.json`.

## Commands

    npm ci && npm test              # unit suite against the recording Io fake (no machine access)
    npm run test:parity             # gate 1 (bs doctor vs ~/.claude/bootstrap.sh --doctor; self-skips without it) + TUI-vs-headless skins parity
    npm run typecheck && npm run build && node dist/cli.js plan

## Rules that are not obvious from the code

- `src/engine/` and `src/artifacts/` never import `src/ui/`. Ink/React only under `src/ui/tui/`; `model.ts` and `prompter.ts` stay renderer-free.
- `detect` / `verify` / `capture` never write; `tests/unit/artifacts/contract.test.ts` enforces it with an exec allowlist — extend the allowlist when an artifact gains a read-only probe.
- Secret values never touch argv, events, logs, or bundles. Child processes get them on stdin or in a mode-600 file they own (`~/.mct/config.json`).
- Windows: never spawn `.cmd`/`.bat` directly (see `npmArgv` in `src/artifacts/mct.ts`); build paths with `pj(env.os, …)`.
- Cutover state (spec §6): `bootstrap.sh` and `claude-gw.zsh` stay live until gate 2. Only `bs env | plan | doctor | capture` are meant to touch a real box before then.

## Known follow-ups

- Deferred engine cleanups (Phase 1 roadmap item 7, minus what Phase 2 landed): `State.facts`, cross-surface `requires` in `resolveOrder` (Phase 3), tests typecheck, `_writeToOutput` guard, non-44 Keychain exit codes, `doctor --json` redaction, `BS_REQUIRE_PARITY=1`, `homeRel` boundary check, gateway-launch `.bak` before regenerating — see the Phase 2 plan, "Deviations" §4.
- `bs capture` reads bundle files as UTF-8 text; extend `Io.readFile` to bytes if dotclaude ever tracks a binary.
- Interactive `project-memory` re-offers a guessed-but-declined memory dir on every run; map it by hand (or accept) to silence it.
- Windows: `project-memory` spawns `bash` for `sync-memory`; on a stock Git-for-Windows install only `Git\cmd` is on PATH, so `bash` resolves to WSL or nothing. Resolve `<git root>\bin\bash.exe` via `git --exec-path` (or `which git`) on win32 before the first Windows onboard (gate 2).
- TUI Ctrl+C: Ink swallows SIGINT in raw mode and `runTui` resolves 130, so a child `git clone` / `npm install` started by an artifact keeps running after `process.exit`; headless mode kills the process group. Track the live child in `RealIo` and kill it on exit, or document the difference.
- `plugins`: `claude plugin install` runs without `-y` on purpose — a marketplace-declared install command is not auto-accepted headlessly; the CLI's error names the flag, and the owner runs that one install by hand. Revisit if a listed plugin ever declares one.
- `mct`: the activate step reports ✓ when it soft-skips (old node, no device id, no token) and leaves the explanation in a warn note; `verify` then says "not activated". A distinct step outcome for "skipped" would read better.
- TUI: long check messages wrap at the terminal width and the continuation lines lose the four-space indent (`components.tsx` — Ink `Text` `wrap="truncate-end"` or a hanging indent). MeCP `project:boot-slapper/tui-output-cosmetics`.
- Headless onboard prints each artifact's detected state twice — once from the live reporter (`artifact:detected`), once from `renderPlanText` in `cli.ts`; drop one. Same MeCP item.
