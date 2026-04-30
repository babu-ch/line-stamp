#!/usr/bin/env bash
# 環境セットアップ（冪等）。
# SKIP_BREW=1 で brew 経由のインストールをスキップ。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

info()  { printf "\033[1;34m[setup]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[warn]\033[0m %s\n" "$*" >&2; }
error() { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; }
ok()    { printf "\033[1;32m[ok]\033[0m %s\n" "$*"; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

brew_install_if_missing() {
  local pkg="$1"
  local bin="${2:-$1}"
  if need_cmd "$bin"; then
    ok "$bin already installed ($(command -v "$bin"))"
    return
  fi
  if [[ "${SKIP_BREW:-0}" == "1" ]]; then
    error "$bin not found and SKIP_BREW=1. Install $pkg manually and re-run."
    exit 1
  fi
  if ! need_cmd brew; then
    error "brew not found. Install Homebrew (https://brew.sh) or install $pkg manually with SKIP_BREW=1."
    exit 1
  fi
  info "Installing $pkg via brew..."
  brew install "$pkg"
}

info "Checking required tools..."
if ! need_cmd bun; then
  error "bun not found. Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
ok "bun: $(bun --version)"

brew_install_if_missing ffmpeg
brew_install_if_missing imagemagick magick

info "Installing project dependencies..."
bun install

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  chmod 600 "$REPO_ROOT/.env"
  warn "Created .env from .env.example — fill in GEMINI_API_KEY before running."
else
  ok ".env already exists"
fi

if bun run nano-banana --help >/dev/null 2>&1; then
  ok "nano-banana is runnable via: bun run nano-banana \"...\""
else
  warn "nano-banana entry point not runnable. Check node_modules/nano-banana-2/."
fi

ok "Setup complete."
info "Next: edit .env to set GEMINI_API_KEY, then run:"
info "  bun run nano-banana \"a test prompt\""
