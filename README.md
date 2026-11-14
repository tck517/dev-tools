# dev-tools

My development setup, in two parts:

- **[`dotfiles/`](dotfiles/)**: config for fish, tmux, Neovim and kitty, plus
  exported Alfred and iTerm settings.
- **[`scripts/`](scripts/)**: small command-line tools, mostly shell. See
  [`scripts/README.md`](scripts/README.md). Each script stands on its own, so
  you can copy just the one you want.

This repo used to be two: `tck517/dotfiles` (renamed to this one) and
`tck517/scripts` (merged into `scripts/` with its history).

## Install

```sh
git clone git@github.com:tck517/dev-tools.git ~/Projects/dev-tools
cd ~/Projects/dev-tools
./install.sh --dry-run   # see what it would link
./install.sh
```

`install.sh` links the files in `dotfiles/` into `$HOME`. It re-points
existing links and moves any real file in the way aside to
`<name>.backup-<timestamp>`. The fish config puts `scripts/` on `PATH`.

## License

[MIT](LICENSE)
