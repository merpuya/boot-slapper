# Gate 2 — cutover from bootstrap.sh (spec §6)

**Condition:** `bs onboard` green on the new Mac and the new Windows box; `bs doctor` green on both; memory-sync round-trip
verified from each. Until then nothing below is applied.

> **The Windows half of that condition is open.** S3 (`docs/spikes/2026-09-17-s3-windows-managed-policy-owns-desktop.md`,
> JCB-L-T000692) found `HKLM\SOFTWARE\Policies\Claude` setting 16 keys on the Cornell-managed Windows box, including
> `inferenceProvider`, `inferenceCredentialHelper` and `managedMcpServers`. `desktop-inference` and `desktop-mcp` are
> therefore `blocked` by policy that `bs` must not edit — "green on the new Windows box" is unreachable there by
> construction. `desktop-skills` is unaffected. Resolve the scope question (unmanaged Windows box, or narrow the Windows
> surface to `desktop-skills` + the Code artifacts and reword this condition) before applying anything below.

## On each new box

1. Fresh-box shim: macOS `curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash`, Windows
   `irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex`. Read the plan screen before confirming.
2. Secrets when prompted: `cornell-ai-gateway`, `mecp-device-token` (minted on an admin box), `mecp-api-key`, `mct-sync-token`
   (`mct devices add <slug>` on an admin box). Never paste them anywhere else.
3. Claude Desktop: install the `.dmg` / `.msix` first (the `.exe` has no Cowork) but **do not launch it** until `bs onboard` has run —
   the apply steps refuse to touch the config library or Cowork's plugin directory while Desktop is running. After onboard: relaunch
   Desktop, choose the third-party option, open Cowork once (creates `ant-did` and the skills plugin), **quit Claude Desktop**, then run
   `bs onboard` again. `bs onboard` is idempotent — run it again after the first Desktop relaunch; the MCP servers and skills land on the
   second pass. Help → Troubleshooting → Copy Managed Configuration Report must show the keys read from the *user store* and the credential validated.
   On the Cornell Windows box check `HKLM\SOFTWARE\Policies\Claude` holds only app-behavior keys (`disableAutoUpdates` …) — anything
   else means IT owns the configuration and `desktop-inference` reports `blocked` by design.
4. Evidence: `bs doctor --json > docs/evidence/<label>-<date>.json` in this repo (redact nothing — doctor prints no values — but do read it).
5. Memory round-trip: create a memory file in a mapped project on box A, `sync-memory --device <A> push`, on box B
   `sync-memory --device <B> pull`, confirm the file; then the reverse direction. No `.conflict-<device>` sidecars may appear.

## Adopt route — the box already has an applied gateway entry

Rehearsed on JCB-AL-ACA34, 2026-09-16 (Desktop 2.110.0; applied entry `Cornell`, v1 flat, authored in the app months earlier).
Step 3 above assumes an empty library. When Desktop was configured by hand before `bs` ran, `desktop-inference` **adopts** the
applied entry (it already points at the gateway with a credential), reports `present`, and never writes a `boot-slapper` entry —
so `desktop-mcp` has nowhere to put the managed servers and is `blocked` with an in-app instruction. Foreign entries are never
edited by `bs`; the owner adds the servers, then `bs` does the rest.

1. `bs plan` — confirm `desktop-inference: present (adopted …)` and `desktop-mcp: blocked — the applied configuration '<name>' is not
   boot-slapper's …`. If you would rather have `bs` own the entry, rename it `boot-slapper` in `_meta.json` and skip to step 3 above.
2. **Quit Claude Desktop.** Back up the applied entry (`~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json`; Windows
   `%LOCALAPPDATA%\Claude-3p\configLibrary\`) somewhere mode-600 — it holds the static gateway key if the entry was made in the app.
3. Add the managed servers to that entry. The array is the one the app's Connectors pane edits: top-level `managedMcpServers` in a
   v1 flat document (no `$schemaVersion`), `mcp.managedServers` in v2. Take the items verbatim from `bs plan`'s blocked reason or from
   `wantedServers()` — `openbrain` with `oauth: true`, `mecp` with `headersHelper` pointing at `~/.config/boot-slapper/desktop-mcp-mecp-headers.sh`
   (the helper does not exist yet; step 4 writes it). Alternatively add them in the app: Developer → Configure Third-Party Inference… →
   Connectors → Apply Changes (that path also relaunches Desktop and re-serializes the entry, see below).
4. `bs onboard --only desktop-mcp,desktop-skills` (still with Desktop quit). desktop-mcp detects the servers in the applied entry and
   writes only the headers helper; desktop-skills copies the skills into Cowork's plugin and adds the manifest rows.
5. Relaunch Desktop. If it is signed in to claude.ai, sign out and choose the third-party option on the sign-in screen — the library
   applies only in third-party mode, and `bs doctor` **cannot tell which mode the app is in**; a green `desktop-mcp` means the library is
   right, not that Desktop is using it. Connectors → openbrain → Connect (browser OAuth; `open-brain-auth` turns green on the next doctor).
6. Evidence: `~/Library/Logs/Claude-3p/main.log` (Windows `%LOCALAPPDATA%\Claude-3p\Logs\main.log`) must show
   `[custom3p-mcp-headers] helper ok`, `connected { name: 'mecp', … auth: 'headers-helper' }` and `connected { name: 'openbrain', … auth: 'oauth-cached' }`
   with no validation errors; then `bs doctor` and the step-4 evidence file as usual.

**Re-serialization.** Applying a configuration from inside Desktop (Apply Changes, or choosing a configuration) rewrites the applied entry
from the window's full form model — it adds default keys (`autoModeEnabled`, `chatTabEnabled`, `claudeAiImport`, `inferenceCredentialKind`,
`isDesktopExtensionEnabled`) and normalizes `oauth: true` to `{ "mode": "dcr" }` — and relaunches. A plain quit-and-relaunch and the OAuth
token save leave the file byte-identical (hash-checked 2026-09-16). `desktop-mcp` compares servers by presence of `oauth`, so this is not
drift; the *Export → JSON config* comparison in the Managed Configuration Report must expect the normalized form, not byte equality.
Whether a `bs`-written v2 entry survives an in-app apply intact is unverified until the first fresh-entry box has one applied.

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
