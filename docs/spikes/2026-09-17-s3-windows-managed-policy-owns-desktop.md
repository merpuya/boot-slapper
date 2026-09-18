# S3 — On a Cornell-managed Windows box, HKLM policy owns Claude Desktop's 3P configuration

**Spec question (carried from S1/S2, gate-2 runbook step 3):** on the Cornell Windows box, does
`bs` own Claude Desktop's third-party inference configuration through the per-user config library —
the way it does on JCB-AL-ACA34 — or does Cornell IT's HKLM policy take it? S1 established that
Desktop honors managed sources over the local library; it could not say what Cornell actually sets,
because no Windows box existed to look at.

**Date / box:** 2026-09-17, **JCB-L-T000692** (Windows 11 Enterprise 26200, Cornell-managed, *not*
a `JCB-*-ACA34` asset), Claude Desktop **2.110.0.0**, MSIX package `Claude_pzs8sxrjxfjjc` under
`C:\Program Files\WindowsApps\`. Same Desktop version as the 2026-09-16 macOS rehearsal.

**Method (read-only):** `bs doctor` on the box (`detect`/`verify` never write), plus `Get-AppxPackage`
and `tasklist` to establish the install identity. No configuration was modified; `bs onboard` was not run.

## Answer: IT owns it. `bs` cannot configure Desktop inference or MCP here.

`HKLM\SOFTWARE\Policies\Claude` sets **16 keys**:

    inferenceProvider              inferenceGatewayBaseUrl
    inferenceCredentialHelper      inferenceCredentialHelperTtlSec
    disableDeploymentModeChooser   isDesktopExtensionEnabled
    secureVmFeaturesEnabled        isClaudeCodeForDesktopEnabled
    coworkEgressAllowedHosts       disableEssentialTelemetry
    disableNonessentialTelemetry   disableNonessentialServices
    disabledBuiltinTools           allowedWorkspaceFolders
    chatTabEnabled                 managedMcpServers

Only two of these (`isDesktopExtensionEnabled`, `chatTabEnabled`) are anywhere near app-behavior;
none are in `APP_BEHAVIOR_KEYS`. So `managedTakeover` reports a takeover, and per the v1.19367.0+
precedence rule already encoded at `src/engine/desktop.ts` — any HKLM value makes the app ignore
HKCU entirely — the local config library is not consulted at all.

Consequences:

- `desktop-inference` reports **blocked**. Correct by design (gate-2 runbook step 3 anticipated
  exactly this), not a defect to fix.
- `desktop-mcp` reports **blocked**. IT already supplies `managedMcpServers` *and*
  `inferenceCredentialHelper` through policy, so the pilot group's gateway and MCP servers come
  from policy, not from boot-slapper.
- `desktop-skills` is **unaffected**: Cowork's skills plugin directory was found under the org
  sentinel and is writable. The skills path is independent of the inference takeover.

## Two open questions this box cannot answer

Both were listed as "still unverified" in the 2026-09-16 handoff and expected to close on the first
Windows box. Neither can:

1. **Does a `bs`-written v2 config-library entry survive an in-app apply?** There is no library
   entry in play under HKLM policy — nothing to apply, nothing to re-serialize. This still needs a
   box where `bs` owns the entry (the second Mac, fresh-entry route).
2. **Does Desktop run a `.ps1` helper through `powershell.exe -File`?** IT sets
   `inferenceCredentialHelper` itself, so Desktop here runs *their* helper, not the one
   `desktop-inference` writes. The `.ps1` interpreter claim at
   `src/artifacts/templates/desktop-helpers.ts` remains inferred from the bundle's interpreter
   table, never observed. An unmanaged Windows box is required.

A future session should not retry either question on this box.

## What this does to gate 2

The gate-2 exit condition currently reads "`bs onboard` green on the new Mac **and the new Windows
box**". On a Cornell-managed Windows box that is unreachable by construction: three desktop
artifacts are blocked by policy that boot-slapper must not edit. Either

- the Windows half of gate 2 targets a **non**-managed Windows box, or
- boot-slapper's Windows scope narrows to `desktop-skills` plus the Code-surface artifacts, and the
  gate's wording changes to match.

That is a scope decision, not an implementation task. Tracked in MeCP as
`project:boot-slapper/windows-desktop-config-owned-by-cornell-it` (BLOCKED, rolls up under
`program:machine-portability`) — see "MeCP staging" below; the entry was not written from the
discovering session, which had no MeCP connection.

## Incidental: the MSIX detection bug, independently rediscovered

`bs doctor` initially reported "Claude Desktop not found" on this box, while Desktop 2.110.0 was
running and *hosting the session that ran doctor*. `probeDesktopInstall` gated on a hardcoded package
family, `AnthropicPBC.Claude_fnn82j28hfe8t`, guessed in the phase-3 plan from S1/S2 with no Windows
box to check. The shipping identity is bare `Claude` with publisher id `pzs8sxrjxfjjc`; both the name
and the hash differ, so the directory probe and the `-Name AnthropicPBC.Claude` query both missed and
the code fell through to the legacy-`.exe` branch. The existing unit test passed throughout — its
fixture asserted the same guessed constant the source used.

**This was already fixed on `main` before this session started**, in `f708816` (2026-09-16 21:55,
verified on YOGANOVO), which discovers the family from `Get-AppxPackage` and accepts either name.
This session rediscovered the same bug and wrote a duplicate fix; that commit was dropped rather than
merged, because `f708816` plus `4efe63a` go further — `4efe63a` also replaces the constant
`desktopDataDir` with `resolveDesktopStore`, a second win32 assumption this session never questioned.
The lesson is procedural: fetch before starting work on a shared branch. The divergence
(6 commits) existed the whole time and would have been visible in one command.

**Why it mattered beyond cosmetics:** all three desktop artifacts short-circuit on
`installed: false`, so the false negative was hiding their real state — including this whole
finding. Doctor went 11 → 17 failures once detection was honest.

## MeCP staging

The discovering session (JCB-L-T000692) had no MeCP tools available and no `mecp-device-token` in
the box's store, so nothing was written to the portfolio. Per the mecp-conventions skill the write
also needs a belief-revision lookup against the nearest existing beliefs, which could not be run
from there. To be written from a MeCP-connected session:

- **Work item** `project:boot-slapper/windows-desktop-config-owned-by-cornell-it`, status
  **BLOCKED**, `metadata.program_ref: program:machine-portability`. Body: the takeover finding
  above. Blocked on: the gate-2 scope decision named in "What this does to gate 2".
- **Update** `project:boot-slapper/phase-3-desktop-cutover` with the box fact and the two
  questions this box cannot answer.
- Claim hygiene: the MSIX fix to cite is `f708816` (already on `origin/main`), **not** this session's
  duplicate, which was dropped unpushed. What is *not* verified from this box: `npm run test:parity`
  (gate 1 needs the `cornell-ai-gateway` key, absent from this box's store) and anything on macOS.
