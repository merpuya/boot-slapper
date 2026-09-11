#!/usr/bin/env bash
# bootstrap.sh — shim since gate 2 (2026-09): the onboarding logic lives in merpuya/boot-slapper.
#   bootstrap.sh            → bs onboard (Ink screens in a terminal; --auto for headless)
#   bootstrap.sh --doctor   → bs doctor --headless
set -euo pipefail
DIR="${BOOT_SLAPPER_DIR:-$HOME/projects/boot-slapper}"
if [[ -f "$DIR/dist/cli.js" ]]; then
  if [[ "${1:-}" == "--doctor" ]]; then exec node "$DIR/dist/cli.js" doctor --headless; fi
  exec node "$DIR/dist/cli.js" onboard "$@"
fi
if [[ "${1:-}" == "--doctor" ]]; then echo "boot-slapper is not installed at $DIR — run: curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash" >&2; exit 1; fi
curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash -s -- "$@"
