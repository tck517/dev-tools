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
- **Check everything loads**: `tools/validate.sh [all|dotfiles|scripts]`
  (fish syntax, tmux and Neovim load in isolation, install.sh against a temp
  HOME, `bash -n` + `shellcheck` on scripts). Never push with it failing, and
  never `git push --no-verify`.
- **Enable the pre-push check** (once per clone):
  `git config core.hooksPath tools/hooks`
- **Live smoke test**: `tools/smoke.sh` (fish and headless Neovim inside a
  throwaway tmux server; needs the `$HOME` links pointing here)
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

## Beads (work tracking)

`bd` is the only issue tracker here; ids look like `df-<hash>`.

### Privacy
- This repo is public; the beads data is not. It lives in a local Dolt
  database synced to the private `tck517/dev-tools-beads` (`refs/dolt/data`).
- Never commit `.beads/*.jsonl` (ignored) and never copy bead content (notes,
  operator runbooks) into commits, docs or scripts.
- `bd dolt push` / `bd dolt pull` only when the operator asks.

### Hygiene
- Never `bd edit`, `bd create-form` or `bd delete`.
- Always `--json` when a command's output is parsed.
- Scope changes go in `bd note <id> "..."`, not by rewriting the description.
- Blocks: `bd dep add <blocked> --blocked-by <blocker>` (never bare `bd link`).
- Epic membership: `--parent <epic>`; create children with
  `--no-inherit-labels` so they don't copy the epic's labels.
- Workers never `bd close`. A bead closes only after its change is on `main`.

### Labels
- Exactly one `safety:*` per bead:
  - `safety:internal`: docs, comments, repo tooling
  - `safety:reversible`: a config or script change that can't stop a shell,
    tmux, Neovim or kitty from starting (themes, keybindings, new script flags)
  - `safety:hot`: can break startup of the login shell, tmux, Neovim or kitty,
    or changes what `install.sh` links
- One `effort:S|M|L|XL`.
- `human-ops`: a step only the operator can do (macOS settings, installs,
  granting permissions). Put the steps in `bd note <id> "Operator: ..."`; the
  last `Operator:` note wins.

### Delivery workflow
- `/explain-bead`, `/deliver`, `/validate-epic` and their agents follow
  `docs/EPIC-WORKFLOW.md` (lifecycle, workflow labels, branches, merge and
  closure). Epics land by the operator's `git merge --no-ff`, never a squash.
- `tools/epic-ready.sh <epic>` lists the deliverable children of an epic;
  inside an epic use it instead of `bd ready`.

### Scripts that read bd
- `set -euo pipefail`, bash 3.2-safe; `--json` on every bd call and
  `--limit 0` on every `bd list`.
- Replace control characters before `jq`
  (`perl -pe 's/[\x00-\x09\x0b\x0c\x0e-\x1f]/ /g'`): bead text can hold
  them and `jq` rejects them.
- Fail loudly: a bd or parse error exits non-zero with a message and never
  reports a "ready" or "clean" result.
- Interactive shells are fish, where unquoted `$ids` don't word-split: run
  bd loops under `bash -c` or from a script file.
