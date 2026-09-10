# boot-slapper

Cross-platform onboarding for Claude Code (and, from Phase 3, Claude Desktop) against a
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

Artifacts on the `code` surface (profile `aca34`): `prereqs`, `claude-config`, `secrets`, `gateway-launch`,
`project-memory`, `mct`, `plugins`. The desktop surface is Phase 3.

Secrets live in the login Keychain (macOS) or Windows Credential Manager; `mecp-api-key` lives in
`~/.config/mecp/api_key` because the SessionStart hook reads that file; `mct-sync-token` is copied into
`~/.mct/config.json` (mct's own store) at activation. Values are entered at a hidden prompt and never
appear on a command line.

`bs capture` reads bundle files as UTF-8 text; dotclaude tracks no binaries today.

## Develop

    npm install && npm test          # unit tests against the recording io fake
    npm run test:parity              # gate 1: bs doctor vs ~/.claude/bootstrap.sh --doctor (skips without dotclaude)
    npm run build && node dist/cli.js plan

Phase map and task-level plan: Phase 1 `docs/superpowers/plans/2026-09-09-boot-slapper-phase1-engine.md`, Phase 2 `docs/superpowers/plans/2026-09-10-boot-slapper-phase2-artifacts-tui.md`.
