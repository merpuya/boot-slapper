# Gate 2 evidence (DRAFT) — macOS memory round-trip, pull half, from organic auto-sync history

**Status: draft, gathered read-only on 2026-09-30 (overnight prep). Not yet accepted as the runbook's step 5.** Whether organic
history may stand in for the formal probe is an owner decision (work item `phase-3-desktop-cutover`, recommendation: formal probe
for the mac-studio half, organic evidence for the other direction). This file only records what the history shows so that
decision can be made on facts.

Box: `mac-studio.kearnsapuya.net` (DEVICE_LABEL pinned in `~/.claude/settings.local.json`; `uname -n` agrees), the spec §6 second Mac.
Other box: `JCB-AL-AV01` (macOS, Cornell laptop, auto-sync hooks active). Both map `mecp`, `dotclaude` and `maude-stacks` in
claude-memory-sync (`devices/mac-studio.kearnsapuya.net.json`, `devices/JCB-AL-AV01.json`; `maude-stacks` mapped on mac-studio
since `6ff2d62`, 2026-09-24 15:46). claude-memory-sync HEAD when checked: `bc41603`.

## AV01 → mac-studio (the runbook's "pull half"): evidenced

| Fact | Value |
|---|---|
| File created on AV01 | `projects/maude-stacks/reference_swift_test_output_parsing.md`, added by `73fd83f` `auto-sync: conflict re-merge (JCB-AL-AV01)`, 2026-09-25 13:22:10 -0400 — after mac-studio's first sync (2026-09-23) and after `maude-stacks` was mapped on mac-studio |
| First mac-studio sync after that | `6a29e4c` `auto-sync: catch-up on session start (mac-studio.kearnsapuya.net)`, 2026-09-25 17:42:14 -0400 |
| On mac-studio's disk | `~/.claude/projects/-Users-alex-projects-maude-stacks/memory/reference_swift_test_output_parsing.md`, mtime **2026-09-25 17:42:13**, one second before that catch-up commit, byte-identical to the repo copy |

That is a pull performed by mac-studio's SessionStart hook of a file authored on AV01, with the file landing at the mapped
local path. Wider check: all **54** files AV01 has ever added (`A`) under the projects mac-studio maps (`mecp`, `dotclaude`,
`maude-stacks`; 2026-07-12 → 2026-09-25) exist in mac-studio's mapped dirs and are byte-identical to the repo copies. No
`.conflict-<device>` sidecar exists in any of the three mapped local dirs, and none is tracked in the repo (the one path matching
`conflict-` is a handoff note's filename). Runbook step 5's "no sidecars" condition holds for this direction.

Not applicable: `projects/mecp-handoffs/*` (added by AV01, `6ea9982`, 2026-09-29) — `mecp-handoffs` is not mapped on mac-studio.

## mac-studio → AV01: NOT observable from the repo

mac-studio has pushed files into shared projects (for example `projects/maude-stacks/reference_cf_tunnel_api_route_no_cname.md`,
`ace1a94`, 2026-09-25; `projects/mecp/feedback_bulk_mecp_corrections.md`, `05f0256`, 2026-09-29; the earlier push half of the
`boot-slapper` project, `1649001`, 2026-09-24). AV01's later commits (`feddc16`, `6ea9982`, 2026-09-29) contain those files in
their *trees*, but a commit tree only shows the repo, not AV01's working directory, so it does not prove AV01 pulled them.
Closing this direction needs one check on AV01, about a minute: `ls -l` on one of the files above in
`~/.claude/projects/-Users-aca34-projects-maude-stacks/memory/` (or `mecp/memory/`) and confirm its mtime is later than the
mac-studio commit that added it. A formal probe (push a marker file from mac-studio, look for it on AV01) would also work but is a
live write to claude-memory-sync and was deliberately not done overnight.

## What this does not cover

- The Windows leg (yogaNovo) is separate and untouched: it maps no project that mac-studio also maps until `mecp` is mapped there.
- `sync-memory --device mac-studio... pull` was not run; only history and on-disk state were read.
- Files AV01 only *modified* (every `MEMORY.md` index) are not counted above; they are merged, not copied.
