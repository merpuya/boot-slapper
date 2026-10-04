# Cornell migration assistant (sub-project B) — design

**Date:** 2026-09-30 · **Status:** DRAFT for owner review — not approved, not implemented
**Path:** architectural (second profile on the existing engine) · **Sub-project:** B of two (A: `2026-09-09-boot-slapper-design.md`)
**Work item:** MeCP `project:boot-slapper/cornell-migration-assistant` (BRAINSTORMED → this draft)

## 0. Summary

B is a second profile, `cornell-faculty`, on the engine A built: a person who pays for Claude
personally runs one command on their own computer and ends up with Claude Desktop (Cowork 3P)
talking to the Cornell gateway with their gateway key, **plus** a machine-generated
"save this first" checklist for everything that cannot move (chats, Projects, uploaded files,
custom instructions, claude.ai-hosted connectors). It supersedes the prose in
`jcb-kb-pipeline/docs/faculty-claude-setup/95-appendix-migrating-from-personal.md`, which
becomes a short pointer to the tool once B ships.

The engine already supplies almost everything (§2). B's new work is (a) a *source-side* view of
the machine — what the personal subscription currently holds — (b) a faculty-shaped profile with
no owner-specific artifacts, (c) a `bs migrate` command that sequences save-first → onboard →
verify, (d) a distribution story for people who do not have Node, and (e) hard refusal on
managed machines.

## 1. Users and non-goals

**User.** Faculty/staff, comfortable with Claude Desktop, not with a terminal. Personal
subscription today; wants the Cornell gateway's models and data terms. Machine: their own, no
Cornell MDM. Surface: Desktop first; Claude Code only for people whose Code tab Cornell has enabled
per request (the appendix says it is off by default in the pilot).

**Non-goals**

- Managed Cornell boxes: IT policy owns Desktop's inference and MCP configuration there (spike S3, 16 HKLM keys), so `desktop-inference` / `desktop-mcp` are `policy-owned` outcomes; the tool only detects and refuses (§5). No attempt to override, work around, or edit machine policy — ever.
- Migrating claude.ai content server-side. There is no destination account on a gateway box; nothing is uploaded anywhere.
- Signing the user out of claude.ai, cancelling the subscription, or deleting anything in the first-party Claude store. The tool never takes an irreversible action on the personal account.
- Automating gateway-key issuance, or MeCP/Open Brain (owner-only) provisioning. Key issuance stays a human step (KB `10-getting-a-key`).
- Replacing the faculty KB. The KB stays the human-readable source for install/policy prose; B generates the *per-machine* checklist and links to it (§8).
- A GUI shell in v1 (Tauri later, §6).

## 2. What is reused from A unchanged

| Engine piece | Use in B |
|---|---|
| `Artifact` contract, DAG, `plan`/`apply`/`verify`, adopt-never-clobber | unchanged; B adds one artifact and one profile |
| `secrets` + `SecretStore` (Keychain / PasswordVault) | stores the gateway key; same "no secret on argv, read-back after write" rules (Windows vault lesson, S4) |
| `desktop-inference` | writes the `boot-slapper` config-library entry (flat v1, helper-script credential); same swap-guard |
| `desktop-mcp` | derives managed servers from a bundle — for faculty the bundle is *profile-supplied*, not the owner's `~/.claude/mcp/gateway.json` (§3) |
| `desktop-skills` | copies the user's own Cowork skills; source differs (§3) |
| `hosted-connectors` (non-transferable) | already renders "not available on a gateway box"; feeds `instructions.md` |
| `bs capture` bundle + secret scan + `instructions.md` | the save-first mechanism; extended with source-side artifacts (§4) |
| `policy-owned` state / `managedTakeover()` | the refusal signal for managed boxes (§5) |
| `env.provider` (`subscription` detected via `oauthAccount`) | source detection for Code; Desktop needs a new probe (§4, open question Q4) |

## 3. Profile — `profiles/cornell-faculty.ts`

Target: `gateway × {desktop} (+ code, opt-in) × {darwin, win32}`. A profile is data (A §2), so
this is not an engine change.

| # | Artifact | Portability | Faculty variant |
|---|---|---|---|
| 1 | `prereqs` | device-bound | **trimmed**: no git/jq/python; checks Desktop installed and version floor, and *managed-policy absence* (gate, §5). No `claude` binary check unless Code is opted in |
| 2 | `legacy-subscription` (**new**) | device-bound | read-only: detects a signed-in first-party Desktop/Code, records what is present for the checklist; `apply` is empty by invariant (§4) |
| 3 | `secrets` | device-bound | one secret: `cornell-ai-gateway`. Prompt with hidden input; never argv |
| 4 | `desktop-inference` | translatable | as A, `baseUrl` = Cornell gateway from the profile. Does **not** write `disableDeploymentModeChooser` (the user keeps the claude.ai option and can return to it — reversibility, Q6) |
| 5 | `desktop-mcp` | translatable | servers from `options.servers` in the profile, initially `cornell_secure_tools` only (headers helper, `x-litellm-api-key`, mapped to the same `cornell-ai-gateway` secret — no second secret). MeCP and Open Brain are **not** in the faculty profile |
| 6 | `desktop-skills` | portable | source = the user's own skills folder(s) found by the legacy probe, plus an optional profile-shipped starter set; copied into Cowork's skills plugin dir with a manifest row, as A. Never edits foreign skills |
| 7 | `hosted-connectors` | non-transferable | renders the "you will lose these" list for `instructions.md` |
| 8 | `claude-config`, `project-memory`, `mct`, `plugins`, `gateway-launch`, `open-brain-auth` | — | **omitted** (owner-specific). `selectArtifacts` must not pull `claude-config` in through `requires` for a desktop-only profile with no Code opt-in — A §2 did before the Q7 fix; see Q7 |

Code opt-in adds `gateway-launch` and a minimal Code settings template — deliberately a separate,
later slice (§7 phase B3) because it depends on Cornell enabling the Code tab per person.

## 4. Save-this-first: the source-side half

The appendix's real content is a table of things that do not transfer. B's value to a
non-technical user is turning it from prose they read once into a checklist tied to *their*
machine, produced **before** any change is made.

**`legacy-subscription` artifact (new, read-only).** `detect` reports, without writing:

- first-party Claude Desktop present and signed in? (probe TBD — Q4; the first-party store is
  `%APPDATA%\Claude` / `~/Library/Application Support/Claude`, distinct from `Claude-3p`, per S1/S4 and decision-log `2026-09-15-claude-desktop-write-all-three-config-stores`)
- personal skills folders present (the KB names `~/Documents/Claude/.claude/skills/` and
  `%USERPROFILE%\Claude\.claude\skills\`; S1 found Cowork's actual dir is under `local-agent-mode-sessions/skills-plugin/…` — these disagree; resolved in §9 Q5: the `skills-plugin` store is the real one, the KB path is a source to probe only)
- local MCP servers in `claude_desktop_config.json` (stdio-only per S2): listed by name so the
  user can re-add them; **not copied** (the appendix says they migrate by hand; secrets in `env`/argv make a copy unsafe)
- Claude Code with an `oauthAccount` (existing `env.provider = "subscription"` probe)

**`instructions.md`** is generated from those facts plus the non-transferable rows, in plain
language, one section per item, each with a "done" checkbox the tool does not track:

1. Conversation history — no automated path; ask the user to check claude.ai's own data
   export first (Q3, resolved: Settings → Privacy → Export data exists), otherwise copy out what matters.
2. Projects — copy custom-instructions text; note uploaded files.
3. Uploaded files — download what is still needed.
4. Custom instructions — copy from profile settings.
5. Detected local skills — will be copied automatically (item 6 above); list them so the user can confirm.
6. Detected local MCP servers — re-add by hand; names listed, values never printed.
7. claude.ai-hosted connectors — unavailable on the gateway (list from `hosted-connectors` options).

**`bs migrate`** (reserved in A §2, first implemented here). v1 semantics, deliberately small:

    bs migrate --profile cornell-faculty [--out <dir>]
      1. detect environment; run the managed-policy gate (§5); refuse and print the reason if managed
      2. capture: write instructions.md (+ portable bundle files) to <dir> (default ~/Documents/claude-migration/)
      3. STOP and print: "Work through instructions.md. Re-run with --continue when you have saved what you need."
      4. --continue: plan → confirm → apply (onboard) → verify

The mandatory pause between capture and apply is the safety property. Nothing is applied on the
first run. Because A's apply never touches the first-party store and never signs anyone out, the
pause guards the *user's decision to cancel*, not the tool's own actions; the tool must say so
plainly ("your claude.ai account is untouched; cancel it only after you have saved what you need").

`bs migrate` never restores from a bundle into a *different* machine in v1. The cross-device
restore that A's capture/`migrate` interface was designed for (source env → target env) is
Q8 and a separate slice.

## 5. Managed-machine refusal

Personal-only is a safety claim, so the gate is enforced, not documented.

- **Gate.** `prereqs` runs the existing `managedTakeover()` over the readable policy sources
  (macOS managed preferences / profiles, `HKLM\SOFTWARE\Policies\Claude`, `HKCU`). Any non-app-behavior key means
  managed → `bs migrate` and `bs onboard --profile cornell-faculty` stop with:
  "This computer's Claude settings are managed by your organisation. This tool does not change managed settings. Ask IT — itrequests@business.cornell.edu (address from the KB; Q9)." Exit non-zero, nothing written.
- **Unreadable is not clean.** A source that cannot be read (`readable: false`, per the `desktop.ts` contract) counts as *managed-unknown* → refuse with a "could not verify" message, never proceed on absence of evidence.
- **The instructions.md half still works on managed boxes** (it is read-only and useful): `bs migrate --checklist-only` is allowed there. That is the piece that survives a managed population (§9).
- No override flag. A `--force` on a managed box would violate A's non-goal of never fighting policy and the spike's "a future session should not retry this".

## 6. Distribution and skin

Faculty do not have Node ≥ 22.5. Options (decision, not made here — Q10):

| | What | Cost | Note |
|---|---|---|---|
| a | Node single-executable (SEA) per OS/arch, downloaded from GitHub releases | signing/notarization for macOS Gatekeeper; SmartScreen reputation on Windows | smallest change; reuses the Ink TUI; still a terminal |
| b | `install.sh` / `install.ps1` shims (exist) that fetch a pinned Node runtime | no signing, but "paste this into a terminal" is the exact ask B is meant to remove | fine for the pilot cohort only |
| c | Tauri shell around the engine (the item's original plan) | signing + notarization, updater, per-arch builds (arm64 Windows exists — `yogaNovo` is Snapdragon) | right end state; heavy; the original note's obstacle was MDM boxes, which are now out of scope, so it is *less* blocked than when written |
| d | No tool: a guide only | none | the fallback if the owner decides B ships as a guide plus the checklist generator only |

Recommendation: **b for the pilot, c only if the pilot shows people will not open a terminal.**
The engine/UI boundary (A §5) already permits c without engine change.

## 7. Phasing

| Phase | Deliverable | Gate |
|---|---|---|
| B0 | Answer Q2–Q4 (Q1, the population, is resolved — §9); scaffolding-free (this doc) | owner |
| B1 | `cornell-faculty` profile; trimmed `prereqs`; managed gate (§5); `legacy-subscription` read-only detect; `bs migrate --checklist-only`; instructions.md generator; `selectArtifacts` fix (Q7: engine support landed via `requiresFor`; faculty profile wiring open, since `desktop-mcp` still requires `claude-config`) | unit tests on fixtures (below); no live writes |
| B2 | `bs migrate` full flow (capture → pause → `--continue` → onboard → verify) on the owner's personal boxes as faculty stand-ins (`yogaNovo`, `mac-studio`, `alienTop` — none Cornell-managed) | doctor green, evidence file, effect-verified (§8) |
| B3 | Pilot with 2–3 faculty volunteers on personal machines; distribution option b | volunteer sign-off; KB `95-appendix` becomes a pointer |
| B4 | Optional: Code opt-in slice; Tauri shell; cross-device restore (Q8) | pilot result |

## 8. Testing and verification

- **Unit, against the recording Io fake** (A §7): fixtures for `personal-mac-signed-in`, `personal-win-signed-in`, `personal-mac-3p-already`, `managed-win-hklm` (the S3 key set), `managed-mac-profile`, `policy-unreadable`. Assertions: managed fixtures write nothing and exit non-zero; the first-party store is never written in any fixture (recording-fake allowlist, extending `contract.test.ts`); instructions.md contains no secret-shaped string (capture's scanner runs over it) and prints MCP server *names* only.
- **Idempotency:** re-running `bs migrate --continue` on a satisfied box gives an empty plan (A invariant 6); re-running the capture half overwrites `instructions.md` only inside the output dir it owns.
- **Verify the effect, not the artifact** (decision-log `2026-09-18-verify-the-effect-not-the-artifact`; three of six Windows bugs were false greens): B2 is not done until Desktop's `main.log` shows the helper running and models discovered on the personal boxes, exactly as A's gate 2 required — not until `verify` says green.
- **Content parity with the KB:** a test or checklist item comparing the instructions.md item list against the appendix table so the two cannot silently diverge while both exist.
- **Not testable here:** Cornell VPN, gateway key issuance, and any Cornell-managed box. The Mac Studio cannot reach the Cornell VPN/VM/AV fleet.

## 9. Open questions

Blocking first (they change the design, not just the details). Q1, Q3, Q5 and Q7 are resolved and moved below.

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| Q2 | Does Cornell IT permit / want a third-party tool that writes Desktop's 3P configuration on personal machines using a faculty gateway key? Who at Cornell reviews it? | Policy and terms, not engineering | Pilot with volunteers, tell IT |
| Q4 | How does the tool detect "first-party Desktop is signed in" without reading credentials? Is there a non-secret marker (config file key, log line) in the first-party store? | `legacy-subscription` depends on it; reading tokens is prohibited | Skip Desktop sign-in detection; detect store presence only |
| Q6 | Is switching a personal Desktop into 3P mode fully reversible for the user (sign back in to claude.ai), and does the separate `Claude-3p` store guarantee the first-party data is untouched? Evidence so far: owner did this on `JCB-AL-ACA34` on 2026-09-16; not verified for a non-technical user's rollback | Determines how strongly the tool can promise "nothing is lost until you cancel" | Promise only "the tool changes nothing in your claude.ai account" |
| Q8 | Cross-device restore (`bs migrate` from a bundle onto another machine): in scope for B, or A's device-move story? | Separate slice; do not entangle | Out of B v1 |
| Q9 | Support contact and wording. The appendix uses itrequests@business.cornell.edu; should the tool print it, and is it right for a *personal-machine* tool? | User-facing copy | Print the KB address |
| Q10 | Distribution: §6 option b for the pilot, c later? Who signs/notarizes (personal Apple Developer ID vs a Cornell one)? | Cost and ownership | b |
| Q11 | Should `cornell_secure_tools` be in the faculty profile, or is that connector managed centrally for everyone (the appendix says Cornell manages "one connector — web search")? | Faculty may already get it another way; double-adding is noise | Include, headers helper, same secret |
| Q12 | Does Cornell want faculty on the gateway key of the pilot, one key per person, or shared? Rotation story? | The secrets artifact stores whatever they paste; the *key* lifecycle is Cornell's | Per person, out of scope |

### Resolved

| # | Question | Resolution |
|---|---|---|
| Q1 | Is "unmanaged personal machines" the right population? | Confirmed by the owner on 2026-09-30: the population is `personal`. Managed boxes get the refusal gate and the checklist-only path (§5), nothing more. |
| Q3 | Does claude.ai offer a data export (Settings → Privacy) that the appendix's "no bulk export" line misses or predates? | Resolved 2026-10-04 from Anthropic's privacy-centre article "How can I export my Claude data?" (privacy.claude.com, fetched that day). **Yes.** Settings → Privacy → Export data, on the web app or Claude Desktop (not mobile). Free/Pro/Max users export their own data; on Team/Enterprise only the Primary Owner can. The export is "conversation data and the user data for your account", delivered as a download link by email that expires after 24 hours and needs the account signed in. Anthropic states the export cannot be imported into another personal account. So the checklist item is "request the export before changing anything, and download it within 24 h": the export is an archive for the user to keep, not a migration path. The page does not say whether Projects' uploaded files are included, so the checklist keeps the separate "download uploaded files you still need" row. **Consequence for the KB:** the appendix's "no bulk export" line is stale or incomplete (KB fix is a separate item for the KB owner). |
| Q5 | KB appendix path for personal skills vs the Cowork `skills-plugin` store. | Partly resolved 2026-10-04 by inspecting `mac-studio`'s `~/Library/Application Support`. **First-party store** (`Claude/local-agent-mode-sessions/skills-plugin/`) holds two real-UUID org dirs, each with the same account UUID dir beneath it, each carrying `manifest.json`, `.claude-plugin/plugin.json` and `skills/<name>/`. **3P store** (`Claude-3p/…/skills-plugin/`) has the single sentinel org `00000000-0000-4000-8000-000000000001` and one account dir with the same layout. So the sentinel org id separates 3P from first-party, and the layout `skills-plugin/<org>/<account>/{manifest.json,skills/}` is the real Cowork skills store in both modes. `~/Documents/Claude/.claude/skills` (the KB path) does **not** exist on this box, which has run Cowork for weeks, so it is not where Cowork keeps skills here. Help pages checked (support.claude.com "Use skills in Claude") do not document an on-disk path either way. **Still open (needs one never-3P probe):** whether a personal box that has *never* run 3P ever has the KB path populated (e.g. by a Cowork folder or a manual drop). Until probed, `legacy-subscription` treats the KB path as an optional extra *source* and `skills-plugin/<org>/<account>/skills` as the primary one. The KB wording fix is queued in jcb-kb-pipeline (both paths, docs path first). |
| Q7 | `selectArtifacts` pulled off-surface `requires` in, so a desktop-only profile still ran `claude-config` (clone of dotclaude, owner-specific). | Engine support landed 2026-10-01; profile wiring still open. `Artifact` gains optional `requiresFor(opts)`; `desktop-skills` sets `fromClaudeConfig: false` in its profile options to drop `claude-config`, and `selectArtifacts` / `resolveOrder` / `runPlan` all read the option-aware set. Default (option unset) is unchanged, so the owner profile is unaffected. **Open:** `desktop-mcp` (row 5, in the faculty profile) still statically requires `claude-config`, so a faculty profile that omits `claude-config` fails resolution until `desktop-mcp` also gets a `requiresFor` and reads its servers from `options.servers` instead of the tracked `gateway.json`. The `cornell-faculty` profile (B1) must not claim Q7 closed until that lands. |

## 10. Relationship to existing work

- **A's spec** — §1 table row B, §5 bundle text ("in B it is what `migrate` consumes"), §2 `bs migrate` reserved. This doc implements those and does not amend A; if approved, A §1 gains a pointer here.
- **jcb-kb-pipeline** — `95-appendix-migrating-from-personal.md` (and the sibling install pages `20-`/`21-`) are the current human-facing source. B must not contradict them; discrepancies found while drafting are Q5 and Q11. Overlap with the KB's own faculty-setup work items is unchecked from here (jcb-kb-pipeline is a different unit).
- **Spikes** — S1 (config location), S2 (MCP with headers), S3 (managed Windows policy — the reason managed boxes are out of scope; population question Q1 is resolved, see §9), S4 (flat v1, `.ps1` helpers). All B artifacts inherit their constraints.
- **Program** — `machine-portability`. Nothing in B changes gates 2–3 of the cutover.

## 11. Not decided here

Naming (`cornell-faculty` is a working name, and the public repo is `merpuya/boot-slapper` — whether a Cornell-specific profile ships in a public repo at all is Q2-adjacent); telemetry (none by default; the engine's run log stays local); pilot size and dates; the Tauri decision.
