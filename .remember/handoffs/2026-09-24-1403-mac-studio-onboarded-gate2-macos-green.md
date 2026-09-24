# Handoff: mac-studio onboarded — gate 2's macOS leg is green

**Session date:** 2026-09-23 (22:35 EDT) → 2026-09-24 (14:03 EDT), one session across the date line
**Author:** Alex Kearns-Apuya via Claude
**Scope:** Finish onboarding the spec §6 "second Mac" (`mac-studio`, Apple M5 Max, personal, login `alex`) with boot-slapper, from a half-run `bs onboard` with every secret blank to `bs doctor: all checks passed`; record what the box taught us.

## What shipped

- **The box is done.** `bs doctor` all checks passed 2026-09-24 13:50 EDT: 67 ok, 0 errors, 3 expected warns (a `/private/var` temp memory dir; the live-session `mct` transcript; the Code-side Open Brain grant, which needs a `claude-gw` session). Evidence: `docs/evidence/mac-studio-2026-09-24.json` (`56c9b57`), the directory's first file, scanned for secret-shaped strings — none.
- **Fresh-entry Desktop route proven on macOS** (the runbook had it as "unproven"): `desktop-inference` wrote the `boot-slapper` entry on a box that had never run 3P; the owner's first in-app *Apply Changes* (13:39) relaunched Desktop 2.7032.0 in third-party mode; `main.log` shows both helpers `ok`, `mecp` connected with 97 tools (write-scoped device token), `openbrain` OAuth granted, Cowork carrying `mecp-conventions`.
- **All four secrets installed**, values never printed: gateway key pasted by owner (191 models listed); MeCP device token minted on-box with `API_KEY` from `op read` inside one pipeline, written to the Keychain and `~/.config/mecp/api_key` the way `src/engine/secrets/*` does, verified by effect (MCP `initialize` 200 vs 401 unauthenticated; SessionStart hook "identity: fetched OK"); `mct` registered via `onboard --register` with the admin token from the `mct-admin` vault item (sync green; token mirrored into the Keychain; config chmod 600).
- **Fleet identity:** MeCP device `mac-studio-m5-max` created; `mct` device id set to the slug (rows re-stamped before sync was configured, the only window where the rename is allowed); profile `deviceIds` maps the label to it (`56c9b57`). Memory sync: `boot-slapper` is a new logical project, first mapped here; claude-memory-sync `1649001` and later on origin.
- **Three bugs found on this box, each fixed with a test:**
  - `730341a` — a global `bs` (`npm link`) was a silent exit-0 no-op: the ESM main-module guard compared the unresolved symlink path. `src/main-guard.ts` resolves `argv[1]`.
  - `f00a7d5` — the in-app apply dropped two owned keys (`inferenceGatewayAuthScheme`, `inferenceCredentialHelperTtlSec`) while inference kept working; `docCurrent` called that drift and the doctor said "not configured". `docSatisfies` reads an app-dropped key as the app default (`APP_DEFAULTED`), the `sameServer` rule applied to inference. Closes the runbook's "does a `bs`-written entry survive an in-app apply" question: no, and it need not.
  - Not code: macOS with no `scutil` HostName takes `uname -n` from the reverse PTR, so the label read `mac-studio`, then `alexsmacstudio`, then `Alexs-Mac-Studio.local` within a day and orphaned the memory device config. Pinned with `DEVICE_LABEL` in `~/.claude/settings.local.json` (the fleet's WSL fix). Filed as `project:boot-slapper/pin-device-label-at-first-onboard`.
- **Docs:** runbook Status table (macOS leg green, evidence path, pull half open); CLAUDE.md bullet with the findings; follow-up reframed (`2745996`). Vault README Status patched; MeCP `phase-3-desktop-cutover` carries `macos_2026_09_24`.
- **Decided, not built:** `cornell_secure_tools` is out of scope by design (spec S1/S2: never write `claude_desktop_config.json`; no secret in argv). Owner chose to add it properly as a third managed server with a `headersHelper` — `project:boot-slapper/desktop-cornell-secure-tools`, SCOPED. Also filed: `project:mecp/desktop-mcp-host-rejects-draft-07-outputschema` (Desktop's MCP host failed `portfolio_list_devices` and `portfolio_think` on a draft-07 `outputSchema`).

## Verification performed

- boot-slapper at `2745996`: `npm run typecheck` clean, `npm run build` clean, `npm test` 280/280 (34 files). New tests: `tests/unit/main-guard.test.ts` (5), the re-serialization case in `tests/unit/artifacts/desktop-inference.test.ts`. Both written first and seen to fail.
- `bs doctor --headless` through the `npm link` symlink prints and exits 1 on failures (it printed nothing and exited 0 before `730341a`).
- Gateway key: `bs secrets check` present; live probe 191 models; `curl /v1/models` 200; helper prints 26 bytes.
- MeCP token: `bs secrets check` present with JWT shape on both stores; `initialize` 200 with the Keychain copy, 401 without; SessionStart hook fetched identity (6796 bytes).
- `mct doctor` all ok after registration (watermark current, identity maps to the slug); the one later `[!!]` is the live transcript of this session.
- Memory sync: `sync-memory push`/`pull` clean; `memory-auto-sync.mjs end` committed and pushed; repo and local copies of the note identical.
- **Not run:** `npm run test:parity` (gate 1; the bash doctor is present here but parity was not exercised this session); the Ink TUI path; anything on Windows.

## Open items / known follow-ups

- **Gate 2 round-trip, pull half** on both legs: from another box, `sync-memory pull` must show `projects/boot-slapper/` arriving; the reverse probe from JCB-AL-ACA34 lives in `dotfiles`, which is not mapped here — map it or pick a project mapped on both. No `.conflict-*` sidecars allowed.
- **yogaNovo** still owes the runbook its whole-box doctor and evidence file (unchanged since 2026-09-19).
- **Code-side Open Brain grant** on this box: `claude-gw`, then `/mcp` → `openbrain` → Authenticate.
- **`desktop-cornell-secure-tools`** — next piece of work, owner-chosen. Needs the endpoint URL and header name from KB article 9077 / Cornell's Confluence page before design.
- `pin-device-label-at-first-onboard` (P3) and the mecp draft-07 `outputSchema` item (P2) — filed, not started.
- Second Mac has arrived: decide whether it is gateway-only and add the `disableDeploymentModeChooser` profile option if so (CLAUDE.md follow-up, reframed).
- 1Password: the service token is in `~/.zshenv`; the 1Password 8 app is installed but CLI app-integration is off. Either is fine; the decision-log says the token is inventory once the integration is on.

## Files of interest

- `src/main-guard.ts`, `tests/unit/main-guard.test.ts`, `src/cli.ts` — symlink-safe entry guard
- `src/artifacts/desktop-inference.ts`, `tests/unit/artifacts/desktop-inference.test.ts` — `docSatisfies` / `APP_DEFAULTED`
- `src/profiles/aca34.ts` — `deviceIds["mac-studio.kearnsapuya.net"] = "mac-studio-m5-max"`
- `docs/evidence/mac-studio-2026-09-24.json` — gate-2 step-4 evidence
- `docs/cutover/gate-2-runbook.md` — Status table, macOS row
- `CLAUDE.md` — the mac-studio bullet; reframed follow-up
- `~/.claude/settings.local.json` (this box, gitignored) — `env.DEVICE_LABEL`
- `~/.config/boot-slapper/desktop.json` (this box) — entry id, servers, skill hash

## Next session — suggested starting point

On this Mac: `bs doctor` should still read all-green (three warns); if the label ever reads wrong again, `settings.local.json` is the first thing to check. Then start `desktop-cornell-secure-tools` with the brainstorming skill — first question is the endpoint URL. On any other box: run the round-trip pull half against `projects/boot-slapper/` and close gate 2.

**Method note this session earned.** Two greens were one observation deep in the other direction this time: the doctor's red on `desktop-inference` was a working box being compared byte-for-byte against our own template, and `bs` printing nothing would have read as "no problems" to anyone who did not also run `node dist/cli.js`. Compare facts, not bytes; and a tool that can exit 0 without output needs a smoke assertion at install time.
