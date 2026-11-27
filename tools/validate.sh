#!/usr/bin/env bash
# Check that everything in the repo still loads. Run before pushing (the
# pre-push hook does) and as the local gate for /deliver.
#
# Usage: tools/validate.sh [all|dotfiles|scripts|plugins]   (default: all)
#
# Nothing here touches your live setup: tmux loads the config into a
# throwaway server, Neovim runs headless, install.sh runs against a temp HOME.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
area="${1:-all}"
case "$area" in
  all|dotfiles|scripts|plugins) ;;
  -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown area: $area (all, dotfiles, scripts or plugins)" >&2; exit 2 ;;
esac

failed=0
tmp="$(mktemp -d)"
trap 'tmux -L dev-tools-validate kill-server 2>/dev/null || true; rm -rf "$tmp"' EXIT

check() { # name, command...
  local name="$1"; shift
  if "$@" >"$tmp/out" 2>&1; then
    echo "pass  $name"
  else
    echo "FAIL  $name"
    sed 's/^/      /' "$tmp/out"
    failed=1
  fi
}

skip() { echo "skip  $1 ($2)"; }

# Tracked files plus new ones not yet added (not ignored ones), so /deliver
# reviews check a new script before it is committed. Deleted ones drop out.
files() {
  local f
  git ls-files --cached --others --exclude-standard -- "$@" |
    while read -r f; do [ ! -e "$f" ] || echo "$f"; done
}

# Each check is a function so check() can capture all of its output.
fish_syntax() {
  local f rc=0
  for f in $(files 'dotfiles/fish/*.fish'); do
    fish -n "$f" || rc=1
  done
  return $rc
}

tmux_loads() {
  # A real load (not source-file -n) so unknown options are caught too.
  tmux -L dev-tools-validate -f /dev/null new-session -d -s validate \; \
    source-file dotfiles/tmux.conf
}

nvim_loads() {
  # Neovim exits 0 even when init.vim errors, so any output is a failure.
  local out
  out="$(nvim --headless -u dotfiles/init.vim +qa 2>&1)"
  [ -z "$out" ] || { echo "$out"; return 1; }
}

install_links() {
  # Every link source exists and install.sh runs clean against a temp HOME.
  mkdir -p "$tmp/home"
  HOME="$tmp/home" ./install.sh >/dev/null
}

shell_scripts() { # files that run under bash or sh
  local f
  for f in "$@"; do
    head -1 "$f" | grep -qE '^#!.*\b(ba)?sh\b' && echo "$f"
  done
  return 0
}

bash_syntax() {
  local f rc=0
  for f in "$@"; do bash -n "$f" || rc=1; done
  return $rc
}

if [ "$area" = all ] || [ "$area" = dotfiles ]; then
  echo "dotfiles/"
  check "fish syntax" fish_syntax
  check "tmux.conf loads" tmux_loads
  check "init.vim loads" nvim_loads
  check "install.sh links" install_links
  if command -v vint >/dev/null 2>&1; then
    check "vint init.vim" vint dotfiles/init.vim
  else
    skip "vint init.vim" "vint not installed"
  fi
  skip "kitty.conf" "kitty has no parse-only check"
fi

if [ "$area" = all ] || [ "$area" = scripts ]; then
  echo "scripts/ and tools"
  # shellcheck disable=SC2046 # one file per line, no spaces in names
  set -- $(shell_scripts $(files scripts tools .agents/plugins/dev-tools-flow/hooks) install.sh)
  check "bash syntax" bash_syntax "$@"
  check "shellcheck" shellcheck -S warning "$@"
fi

if [ "$area" = all ] || [ "$area" = plugins ]; then
  echo "plugins/"
  # shellcheck disable=SC2046 # one file per line, no spaces in names
  set -- $(shell_scripts $(files plugins))
  if [ $# -gt 0 ]; then
    check "plugin bash syntax" bash_syntax "$@"
    check "plugin shellcheck" shellcheck -S warning "$@"
  fi
  if command -v node >/dev/null 2>&1 && [ -d plugins/beads-board/test ]; then
    check "beads-board tests" node --test plugins/beads-board/test/*.test.ts
  else
    skip "beads-board tests" "node not installed"
  fi
fi

if [ "$failed" = 0 ]; then
  echo "all checks passed"
else
  echo "some checks failed"
  exit 1
fi
