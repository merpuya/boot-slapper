#!/usr/bin/env bash
# install.sh — boot-slapper fresh-box shim (macOS; Linux prints what to install)
#   curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --auto        # args go to `bs onboard`
# Ensures node >= 22.5, clones or fast-forwards $BOOT_SLAPPER_DIR (default ~/projects/boot-slapper),
# builds, then execs `bs onboard`. Idempotent. Windows: install.ps1.
set -euo pipefail

REPO_URL="https://github.com/merpuya/boot-slapper.git"
DIR="${BOOT_SLAPPER_DIR:-$HOME/projects/boot-slapper}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [M,m]=process.versions.node.split(".").map(Number); process.exit(M>22||(M===22&&m>=5)?0:1)'
}

if ! node_ok; then
  case "$(uname -s)" in
    Darwin)
      command -v brew >/dev/null 2>&1 || die "node >= 22.5 is required and Homebrew is missing — install Homebrew (https://brew.sh), then re-run"
      say "installing node via Homebrew"
      brew install node
      node_ok || die "node is still < 22.5 on PATH — open a new terminal and re-run" ;;
    Linux) die "node >= 22.5 is required — install it with your package manager (e.g. NodeSource), then re-run" ;;
    *) die "unsupported platform $(uname -s) — on Windows run install.ps1" ;;
  esac
fi
command -v git >/dev/null 2>&1 || die "git is required — install it, then re-run"

if [ -d "$DIR/.git" ]; then
  say "updating $DIR"
  git -C "$DIR" pull --ff-only --quiet || printf '    ! pull failed — using the existing checkout\n' >&2
else
  say "cloning boot-slapper to $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$REPO_URL" "$DIR"
fi

say "building"
npm --prefix "$DIR" ci --no-audit --no-fund --silent
npm --prefix "$DIR" run --silent build

say "bs onboard"
# Under `curl … | bash` stdin is the script pipe; hand onboard the terminal so prompts and the TUI work.
if [ -r /dev/tty ] && [ -t 1 ]; then
  exec node "$DIR/dist/cli.js" onboard "$@" </dev/tty
else
  exec node "$DIR/dist/cli.js" onboard "$@"
fi
