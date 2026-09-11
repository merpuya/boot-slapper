# Gate 3 — deprecate claude-memory-sync/install.sh (spec §6)

**Condition:** one week of SessionStart/End hooks with no sync drift on the fleet after gate 2 (no `.conflict-<device>` sidecars,
`bs doctor` `project-memory.coverage` ok on every box).

**Change (one commit in claude-memory-sync):** `install.sh` prints "device configs are built by `bs onboard` (boot-slapper) —
this script is kept for reference" and exits 0 without writing; the README's device-config section points at `bs onboard`
and `bs doctor`. The `bin/sync-memory` CLI and the hook scripts are unchanged — boot-slapper calls them.
