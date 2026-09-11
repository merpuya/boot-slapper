# Gate 2 — cutover from bootstrap.sh (spec §6)

**Condition:** `bs onboard` green on the new Mac and the new Windows box; `bs doctor` green on both; memory-sync round-trip
verified from each. Until then nothing below is applied.

## On each new box

1. Fresh-box shim: macOS `curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash`, Windows
   `irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex`. Read the plan screen before confirming.
2. Secrets when prompted: `cornell-ai-gateway`, `mecp-device-token` (minted on an admin box), `mecp-api-key`, `mct-sync-token`
   (`mct devices add <slug>` on an admin box). Never paste them anywhere else.
3. Claude Desktop: install the `.dmg` / `.msix` first (the `.exe` has no Cowork). After onboard: quit and relaunch Desktop, choose the
   third-party option, open Cowork once (creates `ant-did` and the skills plugin), then `bs onboard --only desktop-skills,open-brain-auth`.
   Help → Troubleshooting → Copy Managed Configuration Report must show the keys read from the *user store* and the credential validated.
   On the Cornell Windows box check `HKLM\SOFTWARE\Policies\Claude` holds only app-behavior keys (`disableAutoUpdates` …) — anything
   else means IT owns the configuration and `desktop-inference` reports `blocked` by design.
4. Evidence: `bs doctor --json > docs/evidence/<label>-<date>.json` in this repo (redact nothing — doctor prints no values — but do read it).
5. Memory round-trip: create a memory file in a mapped project on box A, `sync-memory --device <A> push`, on box B
   `sync-memory --device <B> pull`, confirm the file; then the reverse direction. No `.conflict-<device>` sidecars may appear.

## Repo changes (one commit each, with a handoff note)

| Repo | Change | Source |
|---|---|---|
| dotclaude | replace `dotclaude/bootstrap.sh` with the shim | `docs/cutover/staged/bootstrap.sh` |
| dotclaude | replace `docs/gateway-sessions.md` | `docs/cutover/staged/gateway-sessions.md` |
| dotfiles | `dotfiles/install.sh` step 3 → shim | `docs/cutover/staged/dotfiles-install-step3.sh` |
| dotfiles | `dotfiles/install.ps1` step 3 → shim | `docs/cutover/staged/dotfiles-install-step3.ps1` |
| dotfiles | delete `dotfiles/zsh/claude-gw.zsh` and its `source` line in `.zshrc` (the generated wrapper's marker line stays) | — |

`dotclaude-self-update.sh`, `apply-settings-template.sh`, `apply-canonical-hooks.sh` are untouched (spec §8). A regression
reverts one commit.

## After the commits

- `bs doctor` on every box: the `legacy-wrapper` warning from `gateway-launch` disappears once `.zshrc` no longer sources the old wrapper.
- `tests/parity/doctor-parity.test.ts` keeps working: the shim's `--doctor` prints the same lines through `bs doctor --headless`.
- MeCP: flip the gate-2 work item to COMPLETED with the evidence file SHAs; write the handoff note.
