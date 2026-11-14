# Plan: the beads + epic workflow in dev-tools

Bring the beads + epic-branch workflow used in `~/Projects/vibeacademy/website`
to this repo, scaled down to fit it: one person, no CI, no PRs, no previews.

The source of truth for that workflow is
`~/Projects/vibeacademy/website/docs/EPIC-BRANCH-WORKFLOW.md`. Port from that
repo, not from older copies elsewhere; its versions are the newest.

## Decisions (made 2026-11-14)

1. **Beads data stays private.** Dolt remote is the private
   `tck517/dev-tools-beads`; `.beads/*.jsonl` is ignored; auto-export and bd
   backup are off. This repo is public.
2. **Epics land by a local merge, not a PR.** The operator runs
   `git merge --no-ff epic/<id>-<slug>` on `main` and pushes. Never squash:
   one commit per bead is the review map.
3. **Workflow files are copies in this repo for now.** Each ported file
   starts with a `Ported from vibeacademy/website@<short-sha>` comment. After
   the pilot, decide whether the generic parts move to a shared `claude/`
   directory linked into `~/.claude`.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Merge `tck517/scripts` in, restructure into `dotfiles/` + `scripts/`, rename repo | done |
| 1 | `bd init` (prefix `df`), private Dolt remote, CLAUDE.md beads rules | done |
| 2 | `tools/validate.sh` + `tools/hooks/pre-push` | done |
| 3 | `.claude/settings.json` permissions, `.beads/PRIME.md` | done |
| 4 | Port agents, commands, `epic-ready.sh`, workflow doc | ported; checks below pending |
| 5 | Pilot epic | |
| 6 | Retro; decide on a shared `claude/` directory | |

## Phase 4: port the workflow

First check that `.claude/settings.json` permissions apply in a session
started in this repo (e.g. `bd delete` is refused, `bd close` asks).

### Files to port

| Source in website | Destination here | Adaptation |
|---|---|---|
| `.claude/agents/bead-worker.md` | same path | Local gate is `tools/validate.sh`. Follow the `dotfiles/` vs `scripts/` rules in CLAUDE.md. Must not reload live config (no `tmux source-file ~/.tmux.conf`, no `exec fish`): the files under `dotfiles/` are live through symlinks. |
| `.claude/agents/bead-reviewer.md` | same path | `Commands run` evidence = `tools/validate.sh` output. Drop project review checks (Stripe, entitlements, a11y). |
| `.claude/agents/review-adjudicator.md` | same path | Add: anything that can break startup of fish, tmux, Neovim or kitty, or changes `install.sh` links, is always ACTION. A script that stops working when copied out of the repo is ACTION. |
| `.claude/agents/epic-reviewer.md` | same path | No PR to approve: verdict goes on the epic bead (`verdict:go` / `verdict:no-go`) and in a `bd note`. |
| `.claude/commands/explain-bead.md` | same path | Mostly as is. |
| `.claude/commands/deliver.md` | same path | Keep pre-flight, claim, worker → reviewer → adjudicator rounds (cap 3), ACTION/DEFER/REJECT/ESCALATE, escalation format, `Bead:` + `Review:` trailers, precise staging. Gate = `tools/validate.sh`. Trunk mode (no parent): commit on `main`, no PR, no CI watch. Drop gh account switching. |
| `.claude/commands/validate-epic.md` | same path | Replace PR/preview/BDD with: rebase epic on `origin/main`; `tools/validate.sh`; a live smoke test in a throwaway tmux server (`tmux -L <name> -f dotfiles/tmux.conf`, start fish inside it, open nvim headless); `epic-reviewer`; then stop and tell the operator to merge with `--no-ff`. Closure mode: verify the merge commit is on `origin/main` (instead of `gh pr view`), then close children in dependency order, then the epic. |
| `scripts/epic-ready.sh` | `tools/epic-ready.sh` | Repo tooling, so `tools/`, not `scripts/`. Must pass shellcheck. |
| `docs/EPIC-BRANCH-WORKFLOW.md` | `docs/EPIC-WORKFLOW.md` | One page: lifecycle table, labels, branch naming, merge and closure. |
| `docs/plans/beads/BEADS-CONVENTIONS.md` | fold into CLAUDE.md | CLAUDE.md already has the hygiene and label rules; add only what's missing (script rules for reading bd output). |

Drop entirely: preview deploys, Playwright/BDD, CI gates, GitHub bot
accounts, board rendering, newsletter/course commands, Supabase, Stripe.

### Labels used by the ported flow
`committed`, `commit:<short-sha>`, `rework`, `followup:<epic>`,
`verdict:go|no-go|fixed`, `checkpoint:preview` (probably unused here). DEFER
follow-ups: `--no-inherit-labels` plus a `discovered-from:<id>` dependency;
they go in the backlog, not under the epic.

### Done when
- [x] `tools/validate.sh` passes (it shellchecks `tools/epic-ready.sh`).
- [ ] `/explain-bead` runs on a real bead.
- [ ] A dry run of `/deliver` on a trivial bead gets through pre-flight and
  one round.

The last two need a new session (agents and commands load at session start)
and a bead to run on; the phase 5 pilot beads can serve.

### What the port added or found (2026-11-14)
- `tools/smoke.sh`: the `/validate-epic` smoke test as a script, so it is
  shellchecked and can be run by hand.
- `tools/validate.sh` now also checks new, not-yet-added files, so a review
  of an uncommitted diff covers a new script.
- Trunk mode commits on `main`; `/deliver` then asks whether to push, and
  closes the bead only after the commit is on `origin/main`.
- Permissions: `bd delete` is refused as intended. `bd close` ran without a
  prompt in a session in bypass-permissions mode, so `ask` rules only guard
  sessions in a prompting mode.

## Phase 5: pilot epic

Create one epic with these as children (all small; most `safety:internal`
or `reversible`):

- `rgn` has no `-h`/`--help` (CLAUDE.md requires it for `scripts/`)
- Install `vint` so `tools/validate.sh` stops skipping it (`human-ops`)
- Delete the stale remote branches on `tck517/dev-tools`: two dependabot
  branches for an Alfred workflow, plus `claude/optimistic-sanderson-45009d`
  locally (`human-ops`: deleting remote branches)
- Remove the empty git repo at `~` (`~/.git`, no commits) (`human-ops`)
- `brew uninstall terminal-notifier` (unused) (`human-ops`)
- Set Claude Code's `preferredNotifChannel=terminal_bell` so finished
  sessions ring tmux's bell (`human-ops`)
- Remove the old `~/Projects/tck517/scripts` clone (repo is archived) and
  the migration backup folder once the setup has been stable for a while
  (`human-ops`)
- `scripts/README.md`: describe bdboard's framed layout and detail-pane label

Run each through `/deliver`, then `/validate-epic`, merge, and closure.

## Phase 6: retro

Write down what didn't fit (like website's "Lessons from live use" table),
then decide on moving the generic workflow files into a shared `claude/`
directory here, linked into `~/.claude`, so this repo and the others stop
drifting.
