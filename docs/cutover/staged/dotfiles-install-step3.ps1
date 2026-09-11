# step 3 — Claude setup is owned by boot-slapper (gate 2, 2026-09). Idempotent; safe to re-run.
Write-Host "==> step 3: boot-slapper onboard"
irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex
