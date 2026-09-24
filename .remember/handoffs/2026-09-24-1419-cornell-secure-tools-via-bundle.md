# Handoff: cornell_secure_tools via the bundle — third managed server, no bridge, no key on disk

**Session date:** 2026-09-24 (13:54–14:20 EDT), same session as the mac-studio onboarding handoff
**Author:** Alex Kearns-Apuya via Claude
**Scope:** Carry Cornell's secure-tools connector on both surfaces through boot-slapper's existing bundle-derived design, replacing the hand-installed `mcp-remote` recipe of KB article 9077.

## What shipped

- **dotclaude `1e21dff`** — `cornell_secure_tools` in `mcp/gateway.json`: HTTP server at `https://api.ai.it.cornell.edu/mcp/`, one header `x-litellm-api-key: Bearer ${ANTHROPIC_AUTH_TOKEN}`. Claude Code expands the variable `claude-gw` already exports.
- **boot-slapper `a80461b`** — `secretHeader()` in `src/artifacts/desktop-mcp.ts` replaces the Authorization-only lookup at the derivation and verify sites: any bundle header carrying a `${VAR}` placeholder the profile's `tokens` maps becomes the helper's header under its own name. No headers → OAuth; literal `Authorization` or unmapped placeholder → skipped with a reason. Profile maps `ANTHROPIC_AUTH_TOKEN` → `cornell-ai-gateway` (no new secret). Plan step names the servers it writes.
- **boot-slapper `0f02fd7`** — spec §4 row 9 amended; S2 spike addendum with the probe; runbook adopt-route line; CLAUDE.md rule.
- **Probe that settled the design** (read-only, key never printed): the gateway's `/mcp/` answers a direct streamable-HTTP `initialize` with `x-litellm-api-key` → 200 (`litellm-mcp-server`), with or without the `Bearer` prefix; 401 without the header. So no `mcp-remote`, on either surface.

## Verification performed

- Test written first (`tests/unit/artifacts/desktop-mcp.test.ts`, the `${VAR}` on any header case, including win32 helper body, unmapped-placeholder skip, end-to-end apply + verify) and seen failing; then 15/15 in the file, unit 281/281 (34 files), skins parity 1/1, typecheck and build clean.
- Live on mac-studio: Desktop quit, `bs onboard --only desktop-mcp --auto` wrote the helper (mode 700, prints one header, 56 bytes) and the third server; relaunch → `main.log` 14:16:24 `resolved { server: 'cornell_secure_tools', headerNames: [ 'x-litellm-api-key' ] }`, 14:16:27 `connected { name: 'cornell_secure_tools', toolCount: 6, auth: 'headers-helper' }`, `mcpServerCount: 3`, `+3 connected, +0 pending`. Whole-box `bs doctor`: all checks passed.
- **Not verified:** the Claude Code side (`claude-gw` → `/mcp` should list the connector with 6 tools); the doctor-parity test (gate 1) not run this session.

## Open items / known follow-ups

- Code-side check and the Code-side Open Brain grant, both in the owner's next `claude-gw` session.
- Other boxes pick the server up on their next `bs onboard --only desktop-mcp` after dotclaude self-update delivers the bundle; JCB-AL-ACA34 is on the adopt route, so there the connector must be added in the app (the in-app instruction now lists three servers).
- KB article 9077 still documents the `mcp-remote` recipe for faculty; whether it should point at a direct-HTTP alternative is a jcb-kb-pipeline question, not filed.
- MeCP `project:boot-slapper/desktop-cornell-secure-tools` → COMPLETED; `pin-device-label-at-first-onboard` remains SCOPED.

## Files of interest

- `src/artifacts/desktop-mcp.ts` — `secretHeader`, plan-step title
- `tests/unit/artifacts/desktop-mcp.test.ts` — the new case
- `src/profiles/aca34.ts` — `tokens.ANTHROPIC_AUTH_TOKEN`
- `docs/spikes/2026-09-10-s2-desktop-http-mcp-headers.md` — 2026-09-24 addendum
- `~/.claude/mcp/gateway.json` (dotclaude) — the bundle entry
- `~/.config/boot-slapper/desktop-mcp-cornell_secure_tools-headers.sh` (this box)

## Next session — suggested starting point

Open a `claude-gw` session and run `/mcp`: expect `cornell_secure_tools` beside `mecp` and `openbrain`; authenticate `openbrain` while there. Then `bs doctor` should still read all-green with three warns.
