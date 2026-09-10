# boot-slapper — design

**Date:** 2026-09-09 · **Status:** approved in brainstorm, awaiting spec review
**Path:** architectural (new project) · **Sub-project:** A of two (see §1)

## 0. Summary

boot-slapper is a cross-platform (macOS + Windows) onboarding tool that sets up a
device for Claude Code **and** Claude Desktop against a third-party inference
provider — first target: the Cornell AI gateway with no claude.ai sign-in — while
retaining the context that matters: MeCP + Open Brain reachability, per-project
Claude memory, and the tracked Claude configuration (settings, hooks, skills,
plugins).

It supersedes `dotclaude/bootstrap.sh` (bash, 8 steps) and the `claude-gw.zsh`
launch wrapper with one TypeScript engine driven by an Ink TUI or headlessly
(`--auto`). The engine's core abstraction — *artifacts* with a portability class,
restored into an *environment* according to a *profile* — is chosen so that the
same tool later becomes a migration assistant for Cornell faculty moving from a
personal subscription to the gateway, and for Claude Code users moving between
devices.

## 1. Scope and decomposition

Two sub-projects on one engine. This spec covers **A** only; B gets its own
spec once A's engine exists.

| | A — boot-slapper for the owner | B — Cornell migration assistant |
|---|---|---|
| Users | owner; mac + Windows; gateway-only sessions | faculty/staff; personal subscription → gateway; Desktop first |
| Surfaces | `code` + `desktop` | `desktop` (+ `code` for users with the Code tab enabled) |
| Skin | Ink TUI + headless | same engine; TUI first, Tauri shell later |
| Supersedes | `bootstrap.sh` (shim remains), `claude-gw.zsh` (generated now) | prose in `jcb-kb-pipeline/docs/faculty-claude-setup/95-appendix-migrating-from-personal.md` |

**Decisions taken in the brainstorm**

- First target environment: gateway-only, no claude.ai login on the box.
- Both macOS and Windows 11 (Cornell-managed) devices are imminent — cross-platform from the start.
- Desktop is in scope for A: the owner must run what faculty run (proof of concept), and wants Cowork. Desktop on the gateway is the documented "Cowork 3P" configuration.
- Critical context: MeCP + Open Brain reachability; per-project memory; settings/hooks/skills/plugins. Session transcripts and `history.jsonl` are **not** migrated (device-bound; mct already scans them for cost).
- "stdio versions of MeCP/Open Brain" resolved to the existing HTTP launch bundle `~/.claude/mcp/gateway.json`; no separate stdio servers exist or are planned. A stdio *bridge* (`mcp-remote`) is a fallback adapter for Desktop only if Desktop cannot attach a bearer header to an HTTP server.
- Engine model: artifact manifest (§2), chosen over a step pipeline (no home for source→target migration) and a declarative desired-state converger (over-built for two devices and one pilot cohort).

**Non-goals for A**

- `bs migrate` (source env → target env) — interface reserved, not implemented.
- Tauri/desktop-app shell.
- Automating MeCP device-token minting or Open Brain OAuth — both stay human steps by design.
- Replacing `dotclaude-self-update.sh` — boot-slapper owns *setup*, not *upkeep*.
- Bedrock/Vertex provider profiles — the `Provider` enum admits them; no artifact targets them.

## 2. Core model

### Environment

```ts
type Provider = "subscription" | "gateway" | "api-key" | "bedrock" | "vertex";
type Surface  = "code" | "desktop";
type Os       = "darwin" | "win32" | "linux";
type Env = { provider: Provider; surface: Surface; os: Os; home: string; label: string };
```

`label` is the device label (e.g. `JCB-AL-ACA34`), the same value memory-sync and
mct key on. The engine always knows `current` (detected: `process.platform`,
`which claude`, Desktop app presence, whether `~/.claude.json` carries an
`oauthAccount`) and `target` (from the profile). For onboarding they coincide.

### Artifact

```ts
interface Artifact {
  id: string;
  surfaces: Surface[];
  portability: "portable" | "translatable" | "device-bound" | "non-transferable";
  requires: string[];                          // DAG edges
  detect(env: Env): Promise<State>;            // absent | present | drifted — never writes
  plan(env: Env, state: State): Step[];        // what apply WOULD do
  apply(env: Env, steps: Step[], io: Io): Promise<void>;
  verify(env: Env): Promise<Check[]>;          // the doctor — read-only
  capture?(env: Env): Promise<Bundle>;         // portable / translatable only
}
```

Invariants, enforced by the interface and the unit-test contract:

1. `detect` and `verify` never write.
2. `apply` runs only steps that `plan` produced; the UI shows those steps first.
3. Adopt, never clobber: a differing file is reported `drifted` with a diff and left alone. Files an artifact generates under its own directory (e.g. `~/.config/boot-slapper/`) are owned by the artifact and regenerated when they differ; the adopt-never-clobber rule applies to user-owned files (rc files, `~/.claude`, `settings.json`).
4. No secret value appears in any `Step`'s rendered text; steps carry a `SecretRef` resolved inside `apply`.
5. `non-transferable` artifacts have no `apply`; their `plan` renders instructions.
6. Re-running `apply` on a satisfied artifact produces an empty plan (idempotency).

### Profile

An ordered artifact list + target env + per-artifact options, as a checked-in TS
file (`profiles/aca34.ts`). A profile is data; adding one is not an engine change.
Gateway base URL and auth scheme are profile options, never constants.

### Plan and commands

`Plan = { artifact, state, steps[] }[]`, resolved across the DAG. Every command
is a view of a plan:

| Command | Behaviour |
|---|---|
| `bs onboard` | show plan → confirm → `apply` in DAG order → `verify` |
| `bs doctor` | `detect` + `verify` only; exit 1 on any red |
| `bs plan` | print the plan and exit (dry run) |
| `bs capture --out <dir>` | `capture` capturable artifacts into a bundle (§5) |
| `bs secrets set\|check <service>` | SecretStore front door |
| `bs env` | print the detected `Env` |
| `bs migrate` | reserved for B |

Flags: `--profile <name>` (default `aca34`), `--auto` (headless; skips steps flagged
`interactive` with a warning — API-key prompts, Open Brain OAuth), `--only`, `--skip`,
`--json` (doctor).

## 3. Secrets and launch

### SecretStore

```ts
type SecretRef = { service: "cornell-ai-gateway" | "mecp-device-token" | "mecp-api-key" | "mct-sync-token"; account: string };
interface SecretStore {
  get(ref): Promise<string | null>;
  set(ref, value): Promise<void>;   // value from a hidden prompt, never argv
  describe(ref): string;            // location only — for doctor output
}
```

| OS | Backend |
|---|---|
| darwin | login Keychain via `security add/find-generic-password` — the exact items `claude-gw.zsh` reads today; nothing migrates on the current mac |
| win32 | Windows Credential Manager via PowerShell `[Windows.Security.Credentials.PasswordVault]` (user-scoped, DPAPI). `cmdkey` cannot read values back, so it is not used. Replaces the user-scope env-var home documented in dotfiles |
| linux | `secret-tool` if present, else `~/.config/boot-slapper/secrets` mode 600 — fallback only |
| any | `~/.config/mecp/api_key` (mode 600) for `mecp-api-key` only — the file is the contract `load-mecp-context.mjs` reads (bootstrap.sh step 5) |

Doctor reports presence per store, never values. Desktop and Code read the same
three secrets — one prompt, two surfaces.

### Launch wrapper (generated, not tracked)

The `gateway-launch` artifact renders a wrapper from a template:

- darwin: `~/.config/boot-slapper/claude-gw.zsh` + one guarded `source` line in `~/.zshrc` (the artifact owns exactly that line).
- win32: a `claude-gw` function in `$PROFILE` reading PasswordVault, plus `claude-gw.cmd` so it works from Git Bash and cmd.
- Both set `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `MECP_DEVICE_TOKEN`, `DISABLE_TELEMETRY=1`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`; no `ANTHROPIC_MODEL` pin; pass `--mcp-config ~/.claude/mcp/gateway.json`; never `--strict-mcp-config` (project `.mcp.json` servers must survive).
- The template switches on `provider`; `gateway.json` stays a tracked, secret-free dotclaude file.

### Deliberately manual

- MeCP device-token minting (`mecp/scripts/mint-device-token.ts --scope write`) happens on a box that already has admin access; the artifact's plan says "paste the token minted on <other device>". The tool never holds a credential that can mint credentials.
- Open Brain OAuth: `/mcp → openbrain → Authenticate` (Code) and the Desktop equivalent; `verify` checks the grant exists.

## 4. Owner profile — `profiles/aca34.ts`

Target: `gateway × {code, desktop} × {darwin, win32}`. DAG order; `→` = requires.

| # | Artifact | Surface | Portability | `apply` (idempotent, adopt-never-clobber) | Replaces |
|---|---|---|---|---|---|
| 1 | `prereqs` | both | device-bound | verify git, node ≥ 22.5, python, jq; warn-only on `claude` binary and Desktop app; SSH-vs-HTTPS clone probe | bootstrap step 1 |
| 2 | `claude-config` → 1 | code | portable | `~/.claude` as dotclaude checkout (clone / pull / adopt in place); settings template; canonical hooks rendered per platform (`platforms` key stripped, win32 exec form) | steps 2–4 |
| 3 | `secrets` → 1 | both | device-bound | prompt once per missing `SecretRef`; `--auto` skips with warning | step 5 + Keychain runbook |
| 4 | `gateway-launch` → 2, 3 | code | translatable | render wrapper per OS; wire shell profile; confirm `gateway.json` present | `claude-gw.zsh` |
| 5 | `project-memory` → 2 | code | portable | clone claude-memory-sync; build `devices/<label>.json` (port of `install.sh` discovery + logical-name guessing); initial `sync-memory pull` | step 6 |
| 6 | `mct` → 1, 3 | code | translatable | clone + build me-count-token at the first `HOOK_CHECKOUT_PROBES` path; `mct onboard --device --url --token` with the token from the store | step 7 |
| 7 | `plugins` → 2 | code | translatable | **new** — marketplaces + plugin ids in the profile; restore via `claude plugin marketplace add` / `claude plugin install`; `capture` reads `~/.claude/plugins/` | untracked today |
| 8 | `desktop-inference` → 3 | desktop | translatable | write 3P config: `inferenceProvider=gateway`, `inferenceGatewayBaseUrl`, bearer header from the store, model discovery on, no pinned `inferenceModels`, `disableNonessentialTelemetry`, `disableNonessentialServices`, `disableAutoUpdates`; verify by `GET <base>/v1/models` with the stored key | faculty guide §3–4 |
| 9 | `desktop-mcp` → 8 | desktop | translatable | write MeCP + Open Brain into `claude_desktop_config.json`; HTTP-with-header if supported, else `mcp-remote` stdio bridge — adapter chosen by a runtime capability probe and reported by `verify` | new |
| 10 | `desktop-skills` → 2 | desktop | portable | symlink `~/.claude/skills/*` → `~/Documents/Claude/.claude/skills` on darwin; copy (symlinks need Developer Mode) to `%USERPROFILE%\Claude\.claude\skills` on win32, re-copied on every run when the source is newer; mecp-conventions first | manual ZIP upload |
| 11 | `open-brain-auth` → 4, 9 | both | device-bound | no automation; plan renders the authenticate instruction; `verify` checks the grant | runbook |
| 12 | `hosted-connectors` | both | non-transferable | no apply; plan states what is absent on a gateway box (Todoist, HA, Gmail, Airtable, …) and that custom skills do not load in Cowork (as of 2026-07) | faculty appendix |

Port, don't shell out: `claude-memory-sync/install.sh` and `bootstrap.sh` step logic
are reimplemented in the artifacts. Shelling out would keep two owners of the device
config — the pattern behind the 2026-07-12 sync outage. The bash stays untouched
until the port is green on both OSes (§6 cutover).

### Spikes required before artifacts 8 and 9 are written

Each is a ~30-minute probe on the current mac; findings go to `docs/spikes/`.
Artifacts are written to whichever answer comes back, with the degraded path kept.

- **S1 — Desktop 3P config location.** Does Claude Desktop honor the inference keys
  written as user defaults (`defaults write com.anthropic.claudefordesktop …` /
  `HKCU\SOFTWARE\Policies\Claude`), or only Managed Preferences / HKLM? If managed-only,
  `desktop-inference` degrades to: open the *Configure third-party inference* pane,
  print the values (key from the store), wait for "done", then verify.
- **S2 — Desktop HTTP MCP with headers.** Does `claude_desktop_config.json` accept an
  HTTP server entry with an `Authorization` header? If not, `desktop-mcp` writes an
  `mcp-remote` stdio bridge entry. The probe becomes the runtime capability check.

## 5. UI, install story, bundle

### Engine/UI boundary

`src/engine/` is a UI-free async library emitting events (`artifact:detected`,
`step:start`, `step:done`, `check:result`, `prompt:needed`). The Ink TUI and the
headless logger subscribe. Nothing under `engine/` or `artifacts/` imports `ui/`.
This boundary is what a later Tauri/React shell attaches to.

### TUI (Ink) — three screens, no free navigation

1. **Plan** — the §4 table rendered live: state, portability, steps; drifted files
   expand to a diff; non-transferable rows show instructions. Confirm or quit.
2. **Apply** — DAG order, one row per step, spinner → ✓/✗. A `prompt:needed` step
   pauses with a hidden input (secret) or a "done, continue" gate (OAuth). A failure
   stops only the failed artifact's dependents; siblings finish.
3. **Doctor** — verify grid per surface, then the remaining manual steps (Chrome
   extension, Desktop first-launch check, mecp-conventions upload where still needed).

Ink over clack: the plan and doctor screens are tables updating in place, and Ink's
component tree is the view-model a React shell reuses. Cost: React as a CLI
dependency — accepted.

Headless parity is a test: every command runs under `--auto` with `CI=1`; the parity
suite drives the profile through both skins and diffs `doctor --json`.

### Fresh-box entry point

```
curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex
```

The shim: ensure node ≥ 22.5 (platform package manager if absent — the one thing the
engine cannot do for itself), clone to `~/projects/boot-slapper`, `npm ci && npm run
build`, exec `bs onboard`. The repo is public-safe by construction (no secrets, no
device facts beyond the profile), so `curl | bash` works and the private-repo
limitation of dotclaude goes away. `dotfiles/install.sh` / `.ps1` step 3 hands off here.

### Run log

Every run writes `~/.config/boot-slapper/runs/<timestamp>.jsonl` — events, never
secret values. This is the audit trail the machine-portability runbook captures by hand.

### Bundle (`bs capture --out <dir>`)

A directory, not an archive — usable as a git repo, an AirDrop, or a USB stick.

```
<bundle>/
  manifest.json      # { schema: 1, source: Env, captured_at, artifacts: [{ id, portability, files[], sha256 }] }
  claude-config/     # tracked dotclaude files only (the allowlist defines the set)
  plugins.json       # marketplaces + plugin ids + versions
  desktop-skills/    # SKILL.md dirs
  memory/            # claude-memory-sync logical-name tree, not encoded-cwd paths
  instructions.md    # rendered non-transferable + device-bound items
```

Rules: `capture` refuses to include files from `device-bound` artifacts and runs a
secret scan (`sk-`, `Bearer `, token-shaped strings) before writing `manifest.json`.
Portable artifacts restore from the bundle alone; translatable ones from the bundle
plus the target env (memory re-mapped to the new device's encoded paths).
`instructions.md` is the machine-generated form of the faculty appendix's
"save this first" table. In A the bundle is the offline path when a new box cannot
reach GitHub yet; in B it is what `migrate` consumes.

## 6. Cutover from `bootstrap.sh`

Three gates; the bash keeps working until the port is proven.

| Gate | Condition | Change |
|---|---|---|
| 1 | `bs doctor` and `bootstrap.sh --doctor` agree on the current mac (parity test in CI) | none — both live |
| 2 | `bs onboard` green on the new mac and the new Windows box; `doctor` green on both; memory-sync round-trip verified from each | `dotclaude/bootstrap.sh` → 15-line shim calling `bs onboard`; `dotfiles/install.sh`/`.ps1` step 3 → the shim; `claude-gw.zsh` removed from dotfiles |
| 3 | one week of SessionStart/End hooks with no sync drift on the fleet | `claude-memory-sync/install.sh` deprecated in place |

Each gate is one commit per affected repo with a handoff note; a regression reverts
one commit. `dotclaude-self-update.sh` is untouched.

## 7. Repo layout, errors, testing

### Layout — `~/projects/boot-slapper`, public repo `merpuya/boot-slapper`

TypeScript, ESM, node ≥ 22.5 (matches mct), vitest.

```
src/
  engine/           # UI-free
    env.ts          # detect(): Env
    artifact.ts     # Artifact/Step/Check/Bundle types, DAG resolver
    plan.ts         # resolve profile → Plan
    run.ts          # apply/verify drivers, event emitter
    secrets/        # SecretStore + darwin.ts, win32.ts, linux.ts
    io.ts           # fs/exec wrappers with a recording fake for tests
  artifacts/        # one file per §4 row
  profiles/         # aca34.ts (cornell-faculty.ts later)
  ui/
    tui/            # Ink screens: Plan, Apply, Doctor
    headless.ts     # line logger for --auto / CI
  cli.ts            # command parsing only
install.sh / install.ps1
tests/
  unit/             # per artifact, against the io fake
  parity/           # bs doctor --json vs bootstrap.sh --doctor; TUI vs headless
  fixtures/         # ~/.claude snapshots: fresh, adopted, drifted, windows-msys
docs/spikes/        # S1, S2 findings
```

### Error handling

| Class | Example | Behaviour |
|---|---|---|
| Precondition | node too old; no GitHub reachability; Desktop not installed | artifact `blocked` with reason; dependents `waiting-on`; siblings continue |
| Apply failure | clone fails; `plugin install` non-zero | step ✗ with stderr tail; artifact's remaining steps skipped; `verify` still runs; exit 1 |
| Drift | `settings.json` differs from template; `~/.zshrc` line present but different | never overwritten; diff shown in plan; `--auto` logs and continues |

No automatic retries; re-running `bs onboard` is the retry.

### Testing

- **Unit, per artifact:** `detect` on each fixture state; `plan` snapshot-tested (the snapshot doubles as the artifact's documentation); `apply` against the recording io fake asserting exact writes/commands and that no secret value appears in any recorded argv or file; apply-twice → empty plan.
- **Secrets backends:** darwin against a throwaway item under service `boot-slapper-test`; win32 against PasswordVault in the Windows CI job; both cleaned in `afterAll`.
- **Parity:** gate 1 — normalized diff of `bootstrap.sh --doctor` vs `bs doctor --json`, on macOS and Windows GitHub-hosted runners; the MSYS fixture covers the Git Bash quirks the canonical-hooks renderer guards.
- **Spikes:** throwaway code, kept findings; S2's probe is promoted into `desktop-mcp`.
- **End-to-end:** manual and gated (§6), with `doctor --json` committed as handoff evidence.

## 8. Existing pieces and their fate

| Today | After A |
|---|---|
| `dotclaude/bootstrap.sh` | shim → `bs onboard` (gate 2) |
| `dotclaude/scripts/apply-settings-template.sh`, `apply-canonical-hooks.sh` | logic ported into `claude-config`; scripts stay for `dotclaude-self-update.sh` |
| `dotclaude/mcp/gateway.json` | unchanged, still tracked |
| `dotclaude/docs/gateway-sessions.md` | rewritten to point at `bs` |
| `dotfiles/zsh/claude-gw.zsh` | deleted; generated by `gateway-launch` |
| `dotfiles/install.sh` / `install.ps1` | step 3 → boot-slapper shim |
| `claude-memory-sync/install.sh` | ported into `project-memory`; deprecated in place (gate 3) |
| `me-count-token` `mct onboard` | called by the `mct` artifact; unchanged |
| `jcb-kb-pipeline` faculty docs | source of truth for artifacts 8–9 and 12; unchanged in A |
