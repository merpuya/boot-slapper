# yogaNovo gate-2 evidence - TEMPLATE

Work item: boot-slapper `phase-3-desktop-cutover`, remaining step 2 ("yogaNovo: a whole-box doctor result, an evidence file, and its round-trip"). Source of the checklist: `docs/cutover/gate-2-runbook.md` (condition block, "On each new box" steps 3-5, status table columns `bs onboard` / `bs doctor (whole box)` / evidence file / memory round-trip) and `docs/cutover/gate-2-evidence-macos-roundtrip.md` (the shape the macOS draft already uses).

How to use: copy this file to the boot-slapper checkout as `docs/cutover/gate-2-evidence-yogaNovo.md`, fill every `____` during the sitting, and commit it together with `docs/evidence/yogaNovo-<date>.json` (the raw doctor output, runbook step 4). Pair this sitting with the Windows hook-probe checklist tracked on the dotclaude work item `node-cli-windows-field-observations` (`docs/machine-portability/windows-hook-probes.md` in the dotclaude repo, once merged): the probes need one Claude Code session on this box anyway, and steps 3-4 below need Claude Desktop closed, so do the hook probes first.

Command shell: everything below is for Git Bash on the box (the fleet's Windows hooks resolve Git Bash first; `memory-auto-sync.mjs` insists on it). Lines marked `(PowerShell)` are called through `powershell -NoProfile -Command`. Commands marked UNVERIFIED were not runnable on the Mac that prepared this; everything else was run against the mac-studio evidence or logs and the output is quoted.

---

## 0. Box and build

| Field | Value (last known -> re-read today) |
|---|---|
| Date / operator | ____ / ____ |
| Box | yogaNovo, Lenovo Yoga Slim 7x Gen 9, Snapdragon X Elite (arm64), personal, unmanaged. Last known OS string in `devices/yogaNovo.json`: `mingw64_nt-10.0-26220-arm64` |
| Device label (`env.label` in the doctor JSON) | ____ (device config file is `devices/yogaNovo.json`, label `yogaNovo`) |
| boot-slapper checkout | `git -C <checkout> rev-parse --short HEAD` = ____ (main was `de8efa7` on 2026-10-17); tree clean? ____ |
| Claude Desktop | version ____ (last known 2.2553.0.0 on 2026-09-18); MSIX package name `Claude`, family `Claude_pzs8sxrjxfjjc` last known |
| Claude Code | `claude --version` = ____ |
| Node | `node --version` = ____ |

## 1. Preconditions (runbook condition block + step 3)

- [ ] `HKLM\SOFTWARE\Policies\Claude` is ABSENT (a precondition on this box, not a diagnostic: if present the box is not the unmanaged gate box; stop and re-pick). `powershell -NoProfile -Command "Test-Path 'HKLM:\SOFTWARE\Policies\Claude'"` -> `False`. Result: ____ (UNVERIFIED locally)
- [ ] Claude Desktop installed from the `.msix` (not the `.exe`), signed in to third-party mode, Cowork opened once, then Desktop QUIT before onboard. Result: ____
- [ ] The four secrets present (`bs secrets check`): `cornell-ai-gateway`, `mecp-device-token`, `mecp-api-key`, `mct-sync-token`. `~/.config/mecp/api_key` is JWT-shaped (a device token, not the master key). Result: ____

## 2. `bs onboard` (idempotent: run twice, Desktop quit, relaunch between)

- [ ] `bs plan` before: ____
- [ ] `bs onboard` second pass output tail: ____
- [ ] artifacts `desktop-inference`, `desktop-mcp`, `desktop-skills` each `present`: ____ / ____ / ____

## 3. Whole-box doctor (runbook step 4)

```
bs doctor --json > docs/evidence/yogaNovo-<YYYY-MM-DD>.json
```
Use the label from `env.label`, not a guess. Then summarise it (this one-liner was run against `docs/evidence/mac-studio-2026-09-24.json` and printed `mac-studio.kearnsapuya.net status=warn {"ok":67,"warn":3}` plus the three warn lines):

```
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const c={};const bad=[];for(const [sec,arr] of Object.entries(d.checks))for(const k of arr){c[k.status]=(c[k.status]||0)+1;if(k.status!=='ok')bad.push(sec+'/'+k.id+' ['+k.status+'] '+k.message)};console.log(d.env.label,'status='+d.status,JSON.stringify(c));bad.forEach(x=>console.log('  '+x))" docs/evidence/yogaNovo-<date>.json
```
Read the file before committing (runbook: "doctor prints no values - but do read it"). Secret-shape check, expected `0` (run against the mac-studio file: `0`):
```
grep -Eic 'eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]' docs/evidence/yogaNovo-<date>.json
```

| Result | Value |
|---|---|
| Overall `status` | ____ |
| Counts (ok / warn / error) | ____ / ____ / ____ |
| Sections present (macOS evidence had 12: prereqs, hosted-connectors, claude-config, secrets, project-memory, plugins, gateway-launch, mct, desktop-inference, desktop-mcp, desktop-skills, open-brain-auth) | ____ |
| Every non-ok line, with a one-line explanation | ____ |
| `hooks-match` (claude-config) | ____ |
| `desktop-store` (prereqs): live? which of the 3 candidate stores | ____ (expected `%LOCALAPPDATA%\Claude-3p`, live on evidence) |

Acceptance used for the macOS leg: zero errors; every warn explained (mac-studio carried 3 warns: an unsynced `/private/var` temp memory dir, `mct doctor` problems, no Code-side Open Brain grant). The Open Brain Code-grant warn is expected to remain until the separate step 3 of the work item is done.

## 4. The two arm64 unknowns the runbook asks the evidence to record

- [ ] Does Claude Desktop ship an arm64 MSIX here, or run x64 under emulation? `powershell -NoProfile -Command "Get-AppxPackage -Name Claude | Select-Object Name,Version,Architecture,PackageFamilyName | Format-List"` -> Architecture ____ (UNVERIFIED locally)
- [ ] Do the `.ps1` helpers run the same way? Count in `$LOCALAPPDATA/Claude-3p/Logs/main.log` (this exact loop was run against mac-studio's `~/Library/Logs/Claude-3p/main.log` and printed 4, 8, 12, 9, 0, 0 in the order below; the `.ps1` helper path is the Windows spelling):
```
L="$LOCALAPPDATA/Claude-3p/Logs/main.log"; for p in '\[custom-3p\] running helper' '\[custom3p-mcp-headers\] helper ok' "connected \{ name: 'mecp'" "connected \{ name: 'openbrain'" 'Ignoring local configuration value' 'credential helper failed'; do printf '%-48s %s\n' "$p" "$(grep -c -E "$p" "$L")"; done
```
Want: helper ok >= 1, `connected { name: 'mecp' ... auth: 'headers-helper' }` >= 1, `connected { name: 'openbrain' ... auth: 'oauth-cached' }` >= 1 (after Connect), and BOTH `Ignoring local configuration value` and `credential helper failed` = 0 after the last onboard (mac-studio: 0 and 0). Result: ____
- [ ] Help -> Troubleshooting -> Copy Managed Configuration Report shows the keys read from the user store and the credential validated. Pasted: ____
- If arm64 and x64 behaviour diverge: `alienTop` (x64, personal) is the tiebreak box. Divergence: ____

## 5. Memory round-trip (runbook step 5), both directions

The yogaNovo device config maps only `dotfiles` (`devices/yogaNovo.json`); `dotfiles` is auto-mapped on mac-studio (`sync-memory list` there shows it with 18 md files), so it is the one project that already exists on both ends with no config edit. (The runbook suggests `mecp`; that needs `sync-memory map ... --apply` plus a `~/projects/mecp` checkout on yogaNovo - use it only if you prefer, and record which.) Project used: ____

Probe mechanism (the same one used for the `JCB-AL-AV01` direction): create the file in the mapped memory dir, `sync-memory --device <label> push`, `node ~/.claude/scripts/memory-auto-sync.mjs end`, then `node ~/.claude/scripts/memory-auto-sync.mjs start` on the other box. That chain was rehearsed end to end on throwaway clones for a maude-stacks probe; the dotfiles variant is the same code path with different names and was not separately rehearsed. Probe files: `sync-probe-yoganovo-to-mac-studio.md` (token `PROBE-YOGANOVO-TO-MSTUDIO-<date>`) and `sync-probe-mac-studio-to-yoganovo.md` (token `PROBE-MSTUDIO-TO-YOGANOVO-<date>`).

| Direction | Created on (box, path, time) | Published (origin commit sha) | Seen on the other box (path, mtime, sha256 equal?) | Sidecars (`find <dir> -name '*.conflict-*' \| wc -l`) |
|---|---|---|---|---|
| yogaNovo -> mac-studio | ____ | ____ | ____ | ____ (want 0) |
| mac-studio -> yogaNovo | ____ | ____ | ____ | ____ (want 0) |

yogaNovo memory dir: `C:/Users/merpu/.claude/projects/C--Users-merpu-projects-dotfiles/memory` (from `devices/yogaNovo.json`). mac-studio dotfiles dir: `/Users/alex/.claude/projects/-Users-alex-projects-dotfiles/memory`.

Cleanup: remove both probe files from the repo and both local dirs with `git rm` in the memory repo, a local `rm`, then `memory-auto-sync.mjs end`, then confirm the other box's next start drops them. Cleaned: ____

## 6. Hook probes (paired item)

Result of the Windows hook-probe checklist recorded on `node-cli-windows-field-observations`: ____ / ____ pass; failures filed as their own items: ____

## 7. Verdict

| Gate-2 condition (runbook) | Met? | Evidence |
|---|---|---|
| `bs onboard` green on yogaNovo | ____ | section 2 |
| `bs doctor` green on yogaNovo (zero errors, warns explained) | ____ | `docs/evidence/yogaNovo-<date>.json`, sha ____ |
| Memory round-trip verified from yogaNovo (both directions, no sidecars) | ____ | section 5 |

- Windows leg of gate 2 closed: ____. Still open on the work item after this sitting: the `JCB-AL-AV01` reverse check (mac-studio -> AV01, if not done), the Code-side Open Brain grant on mac-studio. Gate 3 (`gate-3-deprecate-install-sh`) stays blocked until the whole gate-2 item flips.
- Follow-ups found during the sitting (each its own work item): ____
- Commit(s): evidence JSON ____, this file ____ (one commit each, per the runbook's repo-changes convention; push a branch and open a PR, merges are the owner's).
