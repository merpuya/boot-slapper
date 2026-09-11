# Gateway sessions

Claude Code and Claude Desktop on this device run against the Cornell AI gateway with no claude.ai sign-in.
Everything below is set up and checked by **boot-slapper** (`~/projects/boot-slapper`, public repo `merpuya/boot-slapper`).

| Want to… | Run |
|---|---|
| Set up or repair a box | `bs onboard` (or `curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh \| bash` on a fresh Mac; `irm …/install.ps1 \| iex` on Windows) |
| Check everything | `bs doctor` (`--json` for a report you can commit as evidence) |
| See what onboard would do | `bs plan` |
| Store a secret | `bs secrets set cornell-ai-gateway \| mecp-device-token \| mecp-api-key \| mct-sync-token` (hidden prompt; Keychain / Credential Manager) |
| Start a Code session on the gateway | `claude-gw …` — the wrapper boot-slapper generates in `~/.config/boot-slapper/` |
| Move to a new box without GitHub | `bs capture --out <dir>` on the old one, then `bs onboard` on the new one with the bundle at hand |

Claude Desktop: `bs onboard` writes a `boot-slapper` configuration into Desktop's per-user 3P config library and registers MeCP and
Open Brain as connectors; relaunch Desktop and pick the third-party option on the sign-in screen. Open Brain needs a one-time
*Connect* in Desktop and `/mcp → openbrain → Authenticate` in Code (`bs doctor` shows both grants).

`bootstrap.sh` is a shim that calls `bs`; `claude-gw.zsh` in dotfiles is gone — the wrapper is generated. Design and plans:
`boot-slapper/docs/superpowers/`.
