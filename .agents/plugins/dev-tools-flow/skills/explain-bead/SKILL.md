---
name: explain-bead
description: "Read-only plain-language briefing on a bead \u2014 what it is, what it delivers, why now, and where it lands"
---

<!-- Ported from vibeacademy/website@e3bc0de (.claude/commands/explain-bead.md) -->

Explain one bead in plain language, in the terminal, so the operator can
decide whether to run `/deliver` on it. Optional and read-only. Part of the
epic workflow (`docs/EPIC-WORKFLOW.md`).

Arguments: the arguments passed to `/explain-bead` (the bead id is optional; see "No id")

## Rules

1. **Read-only.** No file changes, no git changes. The only permitted write
   is `bd note <id> "..."` when `--note` is passed. Allowed commands:
   `git branch --show-current`, `git log`, `bd show`, `bd list`,
   `bd dep list`, `tools/epic-ready.sh`, `grep`, `rg`, `ls`, `readlink`.
2. **Audience.** Plain language. Define a technical term inline the first
   time it appears: `term (a short plain definition)`, under 15 words.
3. **No new information.** Every claim traces to the bead, its epic, its
   dependencies, or files you read. References you found with `grep` are
   facts; who would notice a change is an inference, and says so. A
   dependency's status comes from `bd show` and `git log`, never from what a
   description says about it: descriptions go stale.
4. **Never read secrets files** (`dotfiles/fish/secrets.fish`,
   `~/.zsh_secrets`, `*secret*`).
5. **Soft ceiling: 400 words**, excluding the schematic.

## No id

When the arguments passed to `/explain-bead` has no bead id, explain the bead the workflow would pick
next. This is the one statement of that rule.

1. `git branch --show-current`. If it starts with `epic/`, run
   `bd list --type epic --status all --limit 0 --json` and take the epic id
   the branch starts with as `epic/<id>-` (longest match wins). Confirm with
   `bd show <epic-id> --json`. Nothing matches: stop and ask for a bead id.
2. Run `tools/epic-ready.sh <epic-id>` and take the **first line**. Explain
   that bead. Don't re-rank.
3. Exit 2: report its error and stop. Never fall back to a guess.
4. Empty list: say so. If every child is `committed` or closed, point to
   `/validate-epic <epic-id>`; otherwise name the in-flight bead from
   `bd list --parent <epic-id> --status in_progress --limit 0 --json`.
5. Not on an `epic/*` branch: run `bd ready --json` and list the top five
   (id, priority, title), then ask which to explain. Don't pick one.

The first output line names the chosen bead and why, for example:
`Explaining df-a1b2 because it is first in tools/epic-ready.sh df-9z8y.`
With an explicit id it is just the bead's id and title.

## Gather

```bash
bd show <id> --json                       # the bead
bd show <parent-id> --json                # its epic, if any
bd dep list <id> --json                   # what blocks it
bd dep list <id> --direction up --json    # what it unblocks
bd list --parent <parent-id> --status all --limit 0 --json   # siblings
```

Run `bd show <other-id> --json` for every other bead id the bead's text or
notes name, and use its real status.

Then trace the files the bead will touch, one hop each way. Take the files
named in the bead; if none, search for its key terms
(`grep -rn "<term>" dotfiles scripts tools install.sh`). For each file:

```bash
git log --oneline -5 -- <path>           # recent changes
```

Then the neighbours, by kind of file:

| File | Callers (left) | Callees (right) |
|---|---|---|
| `dotfiles/fish/...` | how it loads: `install.sh` link, `conf.d` order, `config.fish` sourcing it | commands and files it runs or sources |
| `dotfiles/tmux.conf` | `install.sh` link; scripts that call `tmux` options it sets | scripts and commands it runs (`run-shell`, `#( )`, bindings) |
| `dotfiles/init.vim` | `install.sh` link | plugins (`Plug '...'`) and external tools it calls |
| `dotfiles/kitty.conf` | `install.sh` link | fonts, themes, commands it names |
| `scripts/<name>` | `grep -rn '<name>' dotfiles scripts` (bindings, aliases, other scripts) | external tools it requires |
| `tools/...`, `install.sh` | `tools/hooks/`, `.agents/plugins/dev-tools-flow/` and `.claude/`, docs that run it | what it runs |

`checked by:` lists the `tools/validate.sh` checks that cover the file
(fish syntax, tmux.conf loads, init.vim loads, install.sh links, bash
syntax, shellcheck, vint), or says nothing checks it (kitty).

If the bead doesn't exist, or is closed, say so and stop.

## Output

Print exactly these sections.

### What it is

Two or three sentences: the problem, in everyday terms.

### What it delivers

A short bullet list of observable outcomes: what the operator could see,
press or run afterwards that they can't today. Translate the acceptance
criteria; don't copy them.

### Why now

- What it unblocks, and what it depends on (committed, closed, or open).
- Where it sits in the epic: N of M children committed.
- If nothing makes it urgent, say so. "It's next in line" is honest.

### Where it lands

A plain-ASCII schematic: only `- | > < + [ ]` and letters. Callers on the
left (`name --loads-->` or `name --calls-->`), a `[ CHANGED ]` box in the
middle, callees on the right (`--runs--> name`), then `paths:` and
`checked by:` lines. Every line under 70 columns.

```text
  install.sh  --links--> +-------------+ --runs--> bdboard
  prefix B    --binds--> | [ CHANGED ] | --runs--> fzf
                         |  tmux.conf  |
                         +-------------+

  paths:       dotfiles/tmux.conf, install.sh, scripts/bdboard
  checked by:  tools/validate.sh "tmux.conf loads"
```

Then 2 to 4 lines labeled "Inference:" on who or what would notice the
change (a new shell, a keybinding, a script on `PATH`). If the bead touches
no code (docs only), say so in one line and skip the schematic.

### Before you /deliver

One to five bullets, or "Nothing blocking, ready to deliver." Fold in:

- **Reversibility**: its `safety:*` label. `hot` means a mistake can stop a
  shell, tmux, Neovim or kitty from starting, or changes `install.sh` links.
- **Operator steps**: a `human-ops` label, and the latest `Operator:` note
  in one line (paraphrase; don't paste the note).
- **Unknowns**: vague acceptance criteria, a description that no longer
  matches the files.

## --note

With `--note`, also save a short version on the bead (under 80 words):

```bash
bd note <id> "Explained (/explain-bead, <YYYY-MM-DD>): <What it is> <Why now> Lands in: <file> (nearest neighbour: <one>)"
```

---

End with:

```text
---

**Result:** Explained <id> — <title>
Chosen by: explicit id | top of tools/epic-ready.sh <epic-id>
Epic: <parent-id or none>
Ready to deliver: yes | no — <reason>
Note saved: yes | no
```
