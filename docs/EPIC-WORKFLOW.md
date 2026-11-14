<!-- Ported from vibeacademy/website@e3bc0de (docs/EPIC-BRANCH-WORKFLOW.md) -->
# Epic workflow

How beads get delivered here: **one epic = one branch, one reviewed commit
per bead, one review of the whole epic, then a local `--no-ff` merge by the
operator.** A bead with no parent epic goes through the same review loop and
lands straight on `main` (trunk mode). One person, no CI, no PRs, no
previews: `tools/validate.sh` and a live smoke test stand in for all of them.

The bead rules (privacy, hygiene, labels) are in CLAUDE.md, "Beads (work
tracking)". This page is the flow; the commands and agents point here.

## Shape

```text
/explain-bead [id]        optional, read-only briefing
        |
/deliver <id>             per bead
   bead-worker -> bead-reviewer -> review-adjudicator -> [operator questions]
     -> remediation (max 2 rounds) -> tools/validate.sh -> one commit
   epic mode: commit on epic/<epic>-<slug>, push the branch
   trunk mode: commit on main, operator chooses push (and close)
        |
/validate-epic <epic>     when every child is committed
   rebase on origin/main -> tools/validate.sh -> smoke test -> epic-reviewer
        |
operator: git merge --no-ff epic/<epic>-<slug> on main, git push
        |
/validate-epic <epic>     again -> closure: children, then the epic
```

## Lifecycle

| State | bd representation | Set by |
|---|---|---|
| Ready | open, unblocked; under an epic: `--parent <epic>` | grooming |
| In progress | `bd update <id> --claim` | `/deliver` pre-flight |
| Committed | still claimed, plus `committed` and `commit:<short-sha>` | `/deliver` after its commit |
| Needs rework | `open` again, `committed` removed, `rework` added, a `bd note` with the cause | `/validate-epic` on a red check or NO-GO |
| Done | `bd close <id> --reason "..."` | the orchestrator, after asking, once the commit is on `origin/main` |

A committed bead stays claimed, so it never reappears in `bd ready`. The
flip side: `bd ready` also treats it as an unfinished blocker, so inside an
epic it hides beads that are deliverable. Use `tools/epic-ready.sh <epic>`
instead; `/deliver` and `/explain-bead` do.

## Branches, commits, merge

| Concept | Rule |
|---|---|
| Epic branch | `epic/<epic-id>-<slug>`, slug 2-5 kebab-case words from the epic title, cut from `origin/main` |
| Trunk mode | No branch: the commit goes on `main` |
| Commits | One per `/deliver` run, subject in the repo's style (`<scope>: <subject>`, for example `tmux: ...`, `rgn: ...`, `docs: ...`), body ending in `Review:` and `Bead: <id>` trailers. Rework adds a commit with the same `Bead:`; earlier commits are never rewritten |
| Syncing | `/validate-epic` rebases the epic branch onto `origin/main`; `git push --force-with-lease` is allowed on `epic/*` only, after that rebase |
| Merge | The operator runs `git merge --no-ff epic/<epic>-<slug>` on `main` and pushes. **Never squash**: the per-bead commits are the review map |
| Pushing | The pre-push hook runs `tools/validate.sh`; never `--no-verify` |

**The working tree is live.** `install.sh` links `dotfiles/` into `$HOME`,
so whatever branch is checked out *is* the running config for every new
shell, tmux server and Neovim. Switching to an epic branch puts its changes
live; a broken `safety:hot` change on that branch breaks new shells. Agents
never reload live config (`tmux source-file ~/.tmux.conf`, `exec fish`):
checks run against throwaway servers and headless Neovim.

## Labels

| Label | Meaning |
|---|---|
| `committed`, `commit:<short-sha>` | The bead's reviewed commit exists. Refreshed after a rebase; a reworked bead carries several `commit:*` |
| `rework` | `/validate-epic` implicated this bead; `/deliver` it again |
| `verdict:go` / `verdict:no-go` | On the epic bead: `epic-reviewer`'s verdict. Exactly one at a time |
| `followup:<epic>` (trunk mode: `followup:<bead>`) | A DEFER bead. It goes in the backlog, not under the epic, with a `discovered-from:<bead>` dependency, so it can't hold the epic open |

Every bead still has one `safety:*` and one `effort:*` (CLAUDE.md). Create
beads with `--no-inherit-labels`.

## Agents

| Agent | Model | Grain | Does | Cannot |
|---|---|---|---|---|
| `bead-worker` | sonnet | one bead | implements, runs `tools/validate.sh`, reports | commit, push, change bd status |
| `bead-reviewer` | sonnet | one bead's uncommitted diff | reviews it against the acceptance criteria | edit anything |
| `review-adjudicator` | opus | each finding | rules ACTION / DEFER / REJECT / ESCALATE | edit anything, overrule the operator |
| `epic-reviewer` | opus | the whole epic branch | GO / NO-GO across beads, recorded on the epic bead | merge, edit files |

Subagents can't launch subagents, so `/deliver` and `/validate-epic` run in
the main session and call each agent in turn; only the main session asks
the operator questions.

### Rulings

| Ruling | When | Consequence |
|---|---|---|
| ACTION | Real, and breaks an acceptance criterion, a check, correctness or startup, or is a cheap fix inside the bead | Worker fixes it next round |
| DEFER | Real but outside the bead, and the bead and epic are safe without it | New backlog bead, `followup:<epic>` |
| REJECT | Wrong, already handled, contradicts an operator decision, or taste | Dropped; the reason goes in the bead note |
| ESCALATE | Reasonable people differ and it changes behaviour, data, security or scope | Asked with options, puts, takes, risk and a recommendation |

Always ACTION: a red `tools/validate.sh`; anything that can break startup
of fish, tmux, Neovim or kitty; a change to what `install.sh` links that
the bead didn't ask for; a script in `scripts/` that stops working when
copied out of the repo. Remediation is capped at 2 rounds; after the third
review the whole bead goes to the operator.

## Checks

- `tools/validate.sh`: the gate for `/deliver`, `bead-reviewer` and
  `/validate-epic`, and the pre-push hook.
- Smoke test (`/validate-epic` only): a throwaway tmux server
  (`tmux -L dev-tools-smoke -f dotfiles/tmux.conf`) running an interactive
  fish, which then runs headless Neovim. It catches what loading alone
  doesn't: errors printed while fish starts, and a config that loads but
  can't start a shell. kitty has no headless check; a `kitty.conf` change
  needs the operator to open a new kitty window, as a `human-ops` step.

## Closure

After the operator merges and pushes, `/validate-epic <epic>` again:

1. `git fetch origin`; `origin/main` must contain a merge commit whose
   second parent is the epic branch tip, and every `commit:*` sha.
2. Close children in passes (`bd close` refuses a bead with open blockers)
   until a pass makes no progress, then the epic. Reason: `merged to main as
   <merge sha> (epic <epic>) after GO review`, or "over NO-GO by operator
   override" when the epic carries that note.
3. Remind the operator to delete the branch and regroom `followup:<epic>`
   beads (DEFER copies the parent's priority).

## Lessons carried over

| Lesson | Rule |
|---|---|
| `bd update --remove-label X --add-label X` in one call is a no-op (bd 1.1.0) | Remove only the opposite label, then add; re-read to confirm |
| A pair of beads holds one dependency edge; `bd dep add` fails over a `discovered-from` edge | Keep the `blocks` edge; record provenance in the description |
| Reviewers claimed "pass" for checks they never ran | `Commands run` with exit codes is required; the review goes back once if it's missing |
| `cmd \| tail` masks the exit code | Run checks one at a time |
| The operator's shell is fish: unquoted `$ids` don't word-split | Run bd loops under `bash -c`; commands printed for the operator are fish syntax |
| A worker invented scope beyond an operator decision | Decisions are passed verbatim; reviewers check the diff against the notes |
| Truncated ids were guessed | Ask for the full id before any claim |
| A round with zero findings needs no adjudicator | Note `verdict COMMIT (zero findings; adjudicator skipped)` and commit |
| Some beads need an operator-only step | Split it into its own `human-ops` bead, blocked by the code bead |
