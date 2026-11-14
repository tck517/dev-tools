#!/usr/bin/env bash
# Start the checked-out dotfiles for real, without touching your sessions:
# a throwaway tmux server loads dotfiles/tmux.conf and runs its default
# shell (fish, as a login shell), which then starts Neovim headless.
# Fails if any of them can't start or prints an error. Used by
# /validate-epic; tools/validate.sh covers the parse-only checks.
#
# Usage: tools/smoke.sh
#
# fish and Neovim load your installed config, so the links must point into
# this checkout (./install.sh --dry-run reports all ok).
set -euo pipefail

case "${1:-}" in
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

for tool in tmux fish nvim; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "smoke: $tool is not installed" >&2; exit 2; }
done

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
sock=dev-tools-smoke
tmp="$(mktemp -d)"
trap 'tmux -L "$sock" kill-server 2>/dev/null || true; rm -rf "$tmp"' EXIT

fail() { echo "FAIL  $*"; exit 1; }

# Links must point here, or the shell would load some other checkout.
if ./install.sh --dry-run | grep -q '^link '; then
  ./install.sh --dry-run
  fail "links in \$HOME don't all point into $repo (run ./install.sh)"
fi
echo "pass  links point into this checkout"

tmux -L "$sock" kill-server 2>/dev/null || true
# No command given, so tmux runs its default-shell from tmux.conf. A wide
# pane keeps output from wrapping.
tmux -L "$sock" -f dotfiles/tmux.conf new-session -d -s smoke -x 200 -y 50 \
  || fail "tmux server did not start with dotfiles/tmux.conf"
echo "pass  tmux starts with dotfiles/tmux.conf"

# Wait for $1 to appear in the pane, up to 20 seconds.
wait_for() {
  local _
  for _ in $(seq 1 40); do
    tmux -L "$sock" capture-pane -p -t smoke -S -500 >"$tmp/pane" \
      || fail "tmux pane went away (the shell exited?)"
    grep -q "$1" "$tmp/pane" && return 0
    sleep 0.5
  done
  return 1
}

# Single quotes: fish expands $status, not this script.
# shellcheck disable=SC2016
tmux -L "$sock" send-keys -t smoke \
  'echo SMOKE-SHELL-$FISH_VERSION-$status' Enter
wait_for 'SMOKE-SHELL-[0-9.]*-[0-9]' || {
  cat "$tmp/pane"; fail "no shell prompt within 20s"; }
grep -qE 'SMOKE-SHELL-[0-9][0-9.]*-0' "$tmp/pane" || {
  cat "$tmp/pane"; fail "the pane's shell is not a working fish"; }
echo "pass  fish starts inside tmux"

# shellcheck disable=SC2016
tmux -L "$sock" send-keys -t smoke \
  'nvim --headless +qa; echo SMOKE-NVIM-$status' Enter
wait_for 'SMOKE-NVIM-[0-9]' || { cat "$tmp/pane"; fail "nvim did not exit"; }
grep -q 'SMOKE-NVIM-0' "$tmp/pane" || {
  cat "$tmp/pane"; fail "nvim exited non-zero"; }
echo "pass  nvim starts from fish"

# Errors printed while fish or Neovim started. The typed commands contain
# none of these words, so any match is real output.
if grep -nE 'rror|Unknown command|command not found|No such file' \
  "$tmp/pane"; then
  fail "error output in the pane (above)"
fi
echo "pass  no error output"
echo "smoke test passed"
