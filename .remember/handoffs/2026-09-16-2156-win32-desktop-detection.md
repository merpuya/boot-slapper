# Handoff: Windows desktop detection fixed on YOGANOVO; 3P-mode proof still owed

**Session date:** 2026-09-16
**Author:** merpuya via Claude
**Scope:** A `/resume` on a Windows box — not the Mac the previous handoff assumed. Establish which box this is, find out why the desktop artifacts are inert on it, fix what that exposed, and hand back the steps that need the owner's hands. Session on **YOGANOVO** (`device:yoga-snapdragon`, Lenovo Yoga Slim 7x Gen 9, Snapdragon X Elite, arm64), Claude Desktop 2.110.0.0.

## What shipped

- **`f708816`** — both win32 desktop facts the Phase 3 plan asserted were wrong, and together they made `bs` report *"Claude Desktop not installed"* on a box that has it, blocking all three desktop artifacts.
  - **Package identity.** The shipping package is named `Claude` (family `Claude_pzs8sxrjxfjjc`), not `AnthropicPBC.Claude_fnn82j28hfe8t`. The family is now discovered from `Get-AppxPackage` (accepting either name) instead of matched against a hard-coded constant; `MSIX_FAMILY` is gone, replaced by `MSIX_FAMILY_RE` + `MSIX_PROBE`. The probe is an exec rather than a dir check now, so the two artifact tests call `resetDesktopProbeCache(io)` after registering their handlers — `makeCtx` probes the env, and so the install, before those handlers exist.
  - **Config library location.** `desktopDataDir` on win32 was `%LOCALAPPDATA%\Claude-3p`; it is roaming AppData — `%APPDATA%\Claude-3p` — which is Electron's `userData` and the true analogue of macOS `Application Support`. As written, every Windows desktop artifact would have written its config library where Desktop never looks.
- **`6d9d268`** — CLAUDE.md carries the Windows verification bullet: what the box settled and what it cannot.
- **Evidence for the roaming-AppData call** (this is the part worth not re-deriving): the *running* first-party app writes `%APPDATA%\Claude\*.json` live — timestamps moved during the session — while `%LOCALAPPDATA%\Claude` holds only `Logs`, the `~/Library/Logs/Claude-3p` analogue. MSIX AppData redirection is **not** active for this package: the container at `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude-3p` holds nothing newer than an April migration copy of `claude_desktop_config.json`. So an unpackaged writer targets real roaming AppData, not the container.

## Verification performed

- Unit **251/251** (32 files) after the change; typecheck and build clean.
- Live on this box, before: `bs env` → `desktopInstalled: false`; all three desktop artifacts `blocked — Claude Desktop not installed`.
- Live on this box, after: `bs env` → `desktopInstalled: true`, `desktopVersion: "2.110.0.0"`. `bs plan` now plans the **fresh-entry route** — `desktop-inference` *absent* (will write `desktop-inference-credential.ps1` and add an entry named `boot-slapper`), `desktop-mcp` *absent* (helper + `openbrain`/`mecp` servers), and `desktop-skills` *blocked* with the correct reason: "Cowork has not run in third-party mode on this device yet".
- **Not run:** `npm run test:parity` (gate 1 is a Mac-only comparison against `~/.claude/bootstrap.sh --doctor`); the Ink TUI path; anything that writes.

## Open items / known follow-ups

- **The three Windows unknowns are still unknown.** 3P mode has never run on this box, so nothing here proves the configLibrary *write* path end-to-end, the `.ps1` helper spawn through `powershell.exe -File`, or v2-entry survival across an in-app apply. The fix gets `bs` as far as planning correctly; it does not prove Desktop reads what we write.
- **Two gates sit in front of finishing it here**, which is why it was handed back rather than driven:
  1. Switching Desktop to third-party mode means signing out of claude.ai in the app — and Claude Code sessions run *inside* Claude Desktop, so doing it mid-session ends the session.
  2. `cornell-ai-gateway` is absent from this box's Windows Credential Manager. Onboarding `desktop-inference` here puts the Cornell gateway key on a personal machine — an owner decision, not an incidental step.
- **Package identity is confirmed on exactly one box**, arm64 and personal. If the Cornell Windows box ships `AnthropicPBC.Claude_*`, the discovery handles it; if it ships a third name, `MSIX_FAMILY_RE` needs widening.
- Gate 2 proper still needs the two new boxes and the memory round-trip; `bootstrap.sh` / `claude-gw.zsh` remain live. CLAUDE.md follow-ups otherwise unchanged.

## Files of interest

- `src/engine/desktop.ts` — `MSIX_FAMILY_RE`, `MSIX_PROBE`, `roamingAppData`, `desktopDataDir`, `probeDesktopInstall`
- `tests/unit/engine/desktop.test.ts` — win32 install + data-dir cases
- `tests/unit/artifacts/desktop-inference.test.ts`, `tests/unit/artifacts/desktop-mcp.test.ts` — roaming-AppData fixtures, probe-cache reset
- `CLAUDE.md` — the Windows verification bullet

## Next session — suggested starting point

Verify the hostname first. On **YOGANOVO**, to finish the Windows proof the owner drives it in this order, with Claude Code *not* running inside Desktop:

1. Quit Claude Desktop.
2. `node dist/cli.js onboard --only desktop-inference` — pastes the Cornell gateway key into Windows Credential Manager, writes the `.ps1` helper, creates the `boot-slapper` v2 entry under `%APPDATA%\Claude-3p\configLibrary`.
3. `node dist/cli.js onboard --only desktop-mcp` — headers helper + `openbrain`/`mecp` servers.
4. Launch Desktop, sign out of claude.ai, choose the third-party option.
5. Read `%LOCALAPPDATA%\Claude-3p\Logs\main.log` (the Windows twin of `~/Library/Logs/Claude-3p/main.log`) for helper exit codes and server connections — that single file answers both the configLibrary-read and `.ps1`-spawn questions.
6. Open Cowork once, then `bs onboard --only desktop-skills`; then open the in-app window and apply once to test v2-entry survival.

If step 5 shows Desktop never ran the `.ps1`, the fallback already named in CLAUDE.md applies: the owner types the key into the in-app window, and a static-credential profile option becomes a follow-up.

Alternatively, if the Cornell Windows box lands first, prefer it — it is the box gate 2 actually needs, and it avoids the Cornell key on a personal machine entirely.
