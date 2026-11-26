#!/usr/bin/env bash
# Link dotfiles/ and plugins/ into $HOME. Safe to re-run: existing links are
# re-pointed, and a real file in the way is moved aside to
# <name>.backup-<timestamp>.
#
# Usage: ./install.sh [--dry-run]
#
# scripts/ needs no install step: dotfiles/fish/conf.d/01-paths.fish puts it
# on PATH.
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

# source (relative to the repo) -> target
links=(
  "dotfiles/tmux.conf:$HOME/.tmux.conf"
  "dotfiles/init.vim:$HOME/.config/nvim/init.vim"
  "dotfiles/kitty.conf:$HOME/.config/kitty/kitty.conf"
  "dotfiles/fish/config.fish:$HOME/.config/fish/config.fish"
  "dotfiles/fish/conf.d:$HOME/.config/fish/conf.d"
  "plugins/beads-board:$HOME/.gemini/config/plugins/beads-board"
)

run() {
  echo "  $*"
  [ "$dry" = 1 ] || "$@"
}

for pair in "${links[@]}"; do
  src="$repo/${pair%%:*}"
  dest="${pair#*:}"
  [ -e "$src" ] || { echo "missing in repo: $src" >&2; exit 1; }

  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    echo "ok       $dest"
    continue
  fi
  echo "link     $dest -> $src"
  run mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    run mv "$dest" "$dest.backup-$(date +%Y%m%d%H%M%S)"
  fi
  # -n: replace a link to a directory instead of creating a link inside it
  run ln -sfn "$src" "$dest"
done

[ "$dry" = 1 ] && echo "(dry run: nothing changed)"
exit 0
