# step 3 — Claude setup is owned by boot-slapper (gate 2, 2026-09). Idempotent; safe to re-run.
say "step 3: boot-slapper onboard"
curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
