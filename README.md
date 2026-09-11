# boot-slapper

Cross-platform onboarding for Claude Code (and Claude Desktop) against a
third-party inference provider — first target: the Cornell AI gateway with no claude.ai
sign-in. Supersedes `dotclaude/bootstrap.sh` and the `claude-gw.zsh` wrapper.

Design: `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`.

## Commands

    bs env                                              # what this box looks like (os, label, detected provider)
    bs plan    [--profile aca34] [--only a,b]           # what onboard WOULD do — read-only
    bs doctor  [--profile aca34] [--json] [--headless]  # verify every artifact — read-only, exit 1 on any error
    bs onboard [--profile aca34] [--auto] [--headless]  # plan → confirm → apply → verify
    bs capture --out <dir>                              # portable/translatable state as a bundle dir (spec §5); refuses secret-shaped strings
    bs secrets set|check <service>                      # cornell-ai-gateway | mecp-device-token | mecp-api-key | mct-sync-token

In a terminal `onboard` and `doctor` draw Ink screens (plan → apply → doctor); `--headless` gives the
line output, and `--auto` (no prompts, interactive steps skipped with a warning) implies it. Piped stdin
or `CI` also mean headless. Every onboard writes `~/.config/boot-slapper/runs/<timestamp>.jsonl`.

Fresh box:

    curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
    irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex

Gate-2 cutover material: `docs/cutover/`.

Artifacts (profile `aca34`, surfaces `code` + `desktop`): `prereqs`, `claude-config`, `secrets`, `gateway-launch`,
`project-memory`, `mct`, `plugins`, `desktop-inference`, `desktop-mcp`, `desktop-skills`, `open-brain-auth`, `hosted-connectors`.

Claude Desktop (third-party mode): `bs onboard` writes one configuration named `boot-slapper` into Desktop's per-user config
library (`~/Library/Application Support/Claude-3p/configLibrary/`, `%LOCALAPPDATA%\Claude-3p\configLibrary\`) — gateway provider,
a credential helper that prints the key from the secret store, MeCP (headers helper) and Open Brain (OAuth) as managed connectors —
and copies the listed dotclaude skills into Cowork's skills plugin. Quit Desktop before applying; relaunch and choose the third-party
option afterwards. On a fresh box it takes two passes: the first `bs onboard` writes the inference entry (Cowork's plugin directory and
`ant-did` do not exist yet), and a second `bs onboard` — after relaunching Desktop in third-party mode, opening Cowork once and quitting
again — completes the MCP servers and the skills. A device whose MDM profile sets more than the update/proxy keys is reported `blocked`:
IT owns that configuration.

`desktop-inference`'s verify — so `bs doctor`, and therefore `npm run test:parity`, which spawns a live `bs doctor` — makes a real
`GET <baseUrl>/v1/models` with the stored gateway key as an in-process header, so both need network.

Secrets live in the login Keychain (macOS) or Windows Credential Manager; `mecp-api-key` lives in
`~/.config/mecp/api_key` because the SessionStart hook reads that file; `mct-sync-token` is copied into
`~/.mct/config.json` (mct's own store) at activation. Values are entered at a hidden prompt and never
appear on a command line.

`bs capture` reads bundle files as UTF-8 text; dotclaude tracks no binaries today.

## Develop

    npm install && npm test          # unit tests against the recording io fake
    npm run test:parity              # gate 1: bs doctor vs ~/.claude/bootstrap.sh --doctor (skips without dotclaude; needs network — see below)
    npm run build && node dist/cli.js plan

Phase map and task-level plan: Phase 1 `docs/superpowers/plans/2026-09-09-boot-slapper-phase1-engine.md`, Phase 2 `docs/superpowers/plans/2026-09-10-boot-slapper-phase2-artifacts-tui.md`, Phase 3 `docs/superpowers/plans/2026-09-10-boot-slapper-phase3-desktop-cutover.md`.
