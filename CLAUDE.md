# dev-tools

Two kinds of thing live here. Keep them apart:

| Directory | What belongs there | How it's used |
|---|---|---|
| `dotfiles/` | Config files, nothing that runs on its own | Linked into `$HOME` by `install.sh` |
| `scripts/` | Commands you run by name | On `PATH` via `dotfiles/fish/conf.d/01-paths.fish` |

- A file that only serves this repo (checks, helpers) goes in neither: put it
  in `tools/`, so it never lands on `PATH`.
- A script in `scripts/` must work when copied out of the repo on its own
  (the scripts README tells people to do that): no imports from elsewhere in
  the repo.
- Adding a dotfile means adding its link to `install.sh`.

## Commands
- **Install / re-point links**: `./install.sh` (`--dry-run` to preview)
- **Update**: `git add . && git commit -m "update dotfiles"`

## dotfiles/

### Commands
- **VIM Plugin Install**: `nvim +PlugInstall +qall`
- **Lint Neovim Config**: `vint dotfiles/init.vim` (not installed yet)
- **Test Single Test**: `nvim -c "TestNearest"`

### Style Guidelines
- **Indentation**: 2 spaces (no tabs)
- **Line Length**: Avoid exceeding 80 characters when possible
- **VIM Mappings**: Use `<leader>` prefix for custom mappings (leader is `_`)
- **Snippets Format**: Follow existing snippet structure with alias, abbr, and options
- **Plugin Declarations**: Group plugins by functionality with descriptive comments
- **Function Names**: Use snake_case for VIM functions
- **Error Handling**: Use conditional statements for graceful failure
- **Comments**: Add comments for non-obvious configuration sections
- **Code Organization**: Group related settings together
- **Lua Configuration**: Use lua blocks for plugins that support it

### Shortcuts
- **Tests**: `t<C-n>` (TestNearest), `t<C-f>` (TestFile), `t<C-s>` (TestSuite)
- **FZF**: `<C-p>` (Files), `<C-b>` (Buffers), `<leader>g` (Grep word under cursor)
- **Explorer**: `<C-t>` (Toggle NvimTree)

### Notes
- `dotfiles/apps/` holds exported app settings (Alfred, iTerm). They are
  stored copies, not linked or loaded from here.
- `dotfiles/zshrc` is a stored copy; the shell is fish, and `~/.zshrc` is not
  linked.

## scripts/

### Style Guidelines
- bash, runnable on macOS's bash 3.2; `set -euo pipefail`
- `-h` / `--help` prints usage
- Check for required tools up front and say which one is missing
- `shellcheck` clean
- Each script gets a section in `scripts/README.md`
