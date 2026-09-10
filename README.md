# boot-slapper

Cross-platform onboarding for Claude Code (and, from Phase 3, Claude Desktop) against a
third-party inference provider — first target: the Cornell AI gateway with no claude.ai
sign-in. Supersedes `dotclaude/bootstrap.sh` and the `claude-gw.zsh` wrapper.

Design: `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`.

## Commands

    bs env                                  # what this box looks like (os, label, detected provider)
    bs plan    [--profile aca34]            # what onboard WOULD do — read-only
    bs doctor  [--profile aca34] [--json]   # verify every artifact — read-only, exit 1 on any error
    bs onboard [--profile aca34] [--auto]   # plan → confirm → apply → verify; --auto skips prompts
    bs secrets set|check <service>          # cornell-ai-gateway | mecp-device-token | mecp-api-key | mct-sync-token

Secrets live in the login Keychain (macOS) or Windows Credential Manager; `mecp-api-key`
lives in `~/.config/mecp/api_key` because the SessionStart hook reads that file. Values are
entered at a hidden prompt and reach child processes on stdin only.

## Develop

    npm install && npm test          # unit tests against the recording io fake
    npm run test:parity              # gate 1: bs doctor vs ~/.claude/bootstrap.sh --doctor (skips without dotclaude)
    npm run build && node dist/cli.js plan

Phase map and task-level plan: `docs/superpowers/plans/2026-09-09-boot-slapper-phase1-engine.md`.
