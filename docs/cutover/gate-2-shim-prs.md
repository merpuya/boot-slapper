# Gate 2 — cutover PR drafts (DRAFT text only)

**Do not apply before gate 2 is met** (condition block in `gate-2-runbook.md`: `bs onboard` and `bs doctor` green on the Mac *and* on
`yogaNovo`, memory round-trip from each). These are the PR descriptions and diffs to open once it is. The replacement contents live in
`docs/cutover/staged/`; nothing here has been applied, pushed or opened, and each repo below needs its own worktree/branch when the
time comes. One PR per repo, one commit per row of the runbook's "Repo changes" table, so a regression reverts one commit.

Current-state facts checked read-only on 2026-09-30, worth re-checking on the day:

- `~/.claude/bootstrap.sh` (dotclaude) is 548 lines and its last commit is `69c8e57` (the device-label doctor line). The shim in
  `staged/bootstrap.sh` is 12 lines. `bs doctor` now prints an equivalent `device label:` line (the `device-label` artifact), so the
  shim's `--doctor` path keeps the parity map's `device-label.label` entry satisfied.
- `~/.claude/docs/gateway-sessions.md` differs substantially from `staged/gateway-sessions.md`: the current file explains *why* a gateway
  session lacks the claude.ai connectors and how MeCP/Open Brain get in; the staged one is a command table. Read both before replacing —
  the explanation may deserve a short "Why" paragraph kept at the bottom.
- `dotfiles/zsh/.zshrc` lines 144-159 hold the `# boot-slapper:claude-gw` marker source line **and** a fallback loop that sources
  `zsh/claude-gw.zsh` from the checkout when the generated wrapper is absent. The runbook's fifth row deletes the file and the fallback
  loop but keeps the marker line verbatim.
- `dotfiles/install.sh` step 3 currently hands off to `~/.claude/bootstrap.sh` (or a fresh clone's copy), lines ~160-190.

---

## PR 1 — dotclaude: bootstrap.sh becomes a boot-slapper shim

**Title:** `refactor(bootstrap): shim to boot-slapper (gate 2)`

**Files:** `bootstrap.sh` ← `boot-slapper/docs/cutover/staged/bootstrap.sh`; `docs/gateway-sessions.md` ← `staged/gateway-sessions.md`.
Two commits.

**Body:**

> Claude setup and its doctor now live in `merpuya/boot-slapper` (`bs onboard`, `bs doctor`). `bootstrap.sh` shrinks from 548 lines to a
> 12-line shim: `bootstrap.sh` → `bs onboard "$@"`, `bootstrap.sh --doctor` → `bs doctor --headless`, and when boot-slapper is not
> checked out it pipes the public `install.sh`. `dotclaude-self-update.sh`, `apply-settings-template.sh` and
> `apply-canonical-hooks.sh` are untouched (spec §8). `docs/gateway-sessions.md` becomes the command table that points at `bs`.
>
> Gate 2 evidence: `boot-slapper/docs/evidence/mac-studio-2026-09-24.json`, `docs/evidence/yogaNovo-<date>.json`, and the memory
> round-trip note (`docs/cutover/gate-2-evidence-macos-roundtrip.md`, accepted version).
>
> Verification: `bash -n bootstrap.sh`; `bootstrap.sh --doctor` prints the same `✓/!/✗` lines the parity test maps
> (`tests/parity/doctor-parity.test.ts` in boot-slapper stays green); `git revert` restores the old script in one step.
>
> Review points: (1) `--doctor` output now comes from `bs`, so any external caller that scrapes bootstrap's old wording must be
> checked; (2) the old `gateway-sessions.md` rationale is dropped unless kept as a short "Why" section.

## PR 2 — dotfiles: step 3 hands off to the boot-slapper shims

**Title:** `refactor(install): step 3 is boot-slapper's install shim (gate 2)`

**Files:** `install.sh` step 3 ← `staged/dotfiles-install-step3.sh`; `install.ps1` step 3 ← `staged/dotfiles-install-step3.ps1`.
Two commits (one per shell).

**Body:**

> Step 3 no longer runs dotclaude's `bootstrap.sh`; it runs boot-slapper's public shim (`install.sh | bash` on macOS,
> `install.ps1 | iex` on Windows), which installs node and git if missing, clones and builds boot-slapper, and execs
> `bs onboard`. The header comment (lines 12 and 21-23) that names bootstrap.sh as the authority needs the matching edit, and
> `install.sh`'s closing hint (`~/.claude/bootstrap.sh --doctor`, ~line 251) becomes `bs doctor`.
>
> Verification: `bash -n install.sh`; on a scratch macOS user or after `--skip-brew`, step 3 reaches the boot-slapper plan screen;
> the Windows change is checked on `yogaNovo` (`[scriptblock]::Create` parse plus a real run).
>
> Review points: `install.ps1` step 4 currently runs bootstrap under Git Bash — the staged replacement is PowerShell-native, so the
> Git Bash prerequisite may become unnecessary for step 3 (do not remove it in this PR).

## PR 3 — dotfiles: remove the legacy claude-gw wrapper

**Title:** `chore(zsh): drop claude-gw.zsh — boot-slapper generates the wrapper (gate 2)`

**Files:** delete `zsh/claude-gw.zsh`; in `zsh/.zshrc` delete the fallback loop and the stale comment, keep the marker line
`[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  # boot-slapper:claude-gw`
verbatim so `bs onboard` still sees it present. One commit.

**Body:**

> The wrapper is generated per box into `~/.config/boot-slapper/claude-gw.zsh` by boot-slapper's `gateway-launch` artifact. The repo
> copy and its fallback loop only served boxes that had not been onboarded. After this change `bs doctor`'s `legacy-wrapper` warning
> disappears once `.zshrc` no longer sources the old file.
>
> Order: merge only after PR 2 (so a fresh box still ends up with a wrapper), and after `bs onboard` has run on every box that
> matters. A box that never onboarded loses `claude-gw` until it does.

---

## After all three merge

Per the runbook: `bs doctor` on every box, flip the MeCP gate-2 work item to COMPLETED with the evidence-file SHAs, write the handoff
note, then start gate 3's one-week clock (`gate-3-note.md`).
