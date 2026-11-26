---
name: deliver
description: "Deliver one bead \u2014 bead-worker \u2192 bead-reviewer \u2192 review-adjudicator \u2192 one reviewed commit on its epic branch, or on main when it has no epic"
---

<!-- Ported from vibeacademy/website@e3bc0de (.claude/commands/deliver.md) -->

Deliver one bead: implement it, review the uncommitted diff, adjudicate the
review, ask the operator only what's theirs to decide, remediate, and make
one reviewed commit. Two modes, chosen from the bead's parent:

| Mode | When | Commit goes on | Ends with |
|---|---|---|---|
| Epic | Bead has a parent epic | `epic/<epic>-<slug>` | Commit, labels, branch pushed |
| Trunk | Bead has no parent | `main` | Commit, labels; the operator chooses whether to push and close |

The review loop is the same in both. Spec: `docs/EPIC-WORKFLOW.md`; read it
first if you haven't this session.

Arguments: the arguments passed to `/deliver`. Anything after the bead id and flags is operator
guidance: pass it to `bead-worker` verbatim and record it with `bd note`.

## How this command runs

**You (the main session) are the orchestrator.** Subagents can't launch
subagents, so you launch each agent in turn with invoke_subagent
(`TypeName`: `bead-worker`, `bead-reviewer`, `review-adjudicator`) and
pass results between them. Only you ask the operator questions
(ask_question), commit, push, and change bd state.

Report progress with one-line `→` (step done) and `✗` (stopped) lines. In
trunk mode pass `epic: none` to every agent.

## Critical rules

1. Epic mode never commits to `main`; trunk mode commits only to `main`. Never `--no-verify`. Never squash, amend or rewrite earlier commits.
2. Never `bd close`, except in trunk mode step 4, after the operator chooses it and the commit is on `origin/main`.
3. One bead per run, one commit per run. A reworked bead gets an additional commit.
4. Operator decisions are binding for the rest of the run, recorded with `bd note`, and passed to agents verbatim.
5. Every bd parse uses `--json`. Run bd loops under `bash -c` (the operator's shell is fish).
6. Create beads with `--no-inherit-labels`.
7. If the bead id looks incomplete (for example `df-a1`), ask for the full id before any claim. Never guess.
8. Run checks as plain commands; never pipe one into `tail` or `head`.
9. Never reload live config yourself (`tmux source-file`, `exec fish`, `./install.sh` without `--dry-run`): the working tree is live (`docs/EPIC-WORKFLOW.md`).
10. Never copy bead notes into a commit message (AGENTS.md "Privacy"). The commit body describes the change itself.

## 1. Pre-flight (fail closed)

1. **Bead and mode.** `bd show <id> --json`. Stop if it doesn't exist, is
   closed, or is itself an epic.
   - Has a parent: it must have `issue_type` `epic`, else stop. Epic mode;
     call it `<epic>`.
   - No parent: trunk mode, `<epic>` is `none`.
     `→ <id> has no parent epic: trunk mode (commit on main)`.
2. **Status.**
   - `open`: proceed.
   - `in_progress` with `committed`: stop, already delivered. Point to
     `/validate-epic <epic>` (epic mode) or to pushing `main` (trunk mode).
   - `in_progress` without `committed`: only with `--resume`. `--resume`
     skips the claim and the clean-tree check. Read the notes: if the latest
     `/deliver round <n> rulings` note has ACTION items, start at 2a in
     `remediate` mode with them, the operator decisions noted after it, and
     `round = <n> + 1`. With no rulings note, start round 1 in `implement`
     mode (the worker builds on the existing diff).
3. **Blockers.**
   - Epic mode: `tools/epic-ready.sh <epic> --check <id>`. Exit 1: show the
     blockers and stop. Exit 2: show the error and stop.
   - Trunk mode: `<id>` must be in `bd ready --json --limit 0` (skip with
     `--resume`); otherwise show `bd dep list <id> --json` and stop.
4. **Branch.**
   - Trunk mode: the current branch must be `main`. Anything else (an
     `epic/*` branch included): stop and say so. Then `git fetch origin`;
     if `main` is behind `origin/main`, stop and ask the operator to pull.
   - Epic mode: on `epic/<epic>-*`, stay. On another `epic/*` branch, stop.
     Otherwise, if a local or remote `epic/<epic>-*` branch exists, switch
     to it (remote only: `git switch --track origin/<branch>`). Otherwise
     `git fetch origin && git switch -c epic/<epic>-<slug> origin/main`,
     slug 2-5 kebab-case words from the epic title.
   - Before switching, tell the operator in one line that the working tree
     is live: new shells, tmux servers and Neovim load this branch's
     dotfiles until they switch back.
5. **Clean tree.** `git status --porcelain` must be empty. Otherwise show it
   and stop.
6. **Claim.** `bd update <id> --claim --json`. If it fails, someone else
   holds it: stop.
7. **Base.** `BASE=$(git rev-parse HEAD)`. If guidance was passed:
   `bd note <id> "Operator guidance (/deliver): <text>"`.

```text
→ Pre-flight: <id> "<title>" on <branch>, claimed
```

## 2. Review loop (at most 3 reviews = 2 remediation rounds)

For `round` = 1, 2, 3:

**a. Worker.** Launch `bead-worker` with mode (`implement` on round 1,
`remediate` after), bead, epic, operator guidance, and in remediate mode the
ACTION instructions plus every operator decision so far, verbatim. On
`Status: blocked`, show the reason and stop (the bead stays claimed and
uncommitted; `--resume` picks it up).

**b. Reviewer.** Launch `bead-reviewer` with bead, epic, round, the worker's
report, and on rounds > 1 the previous rulings and decisions. If its report
has no `Commands run`, or a `Local checks` value the listed commands don't
support, send it back once (send_message) for the missing evidence.

**c. Adjudicator.** If the reviewer reports `Findings: 0` and
`validate pass`, skip it: the verdict is COMMIT. Otherwise launch
`review-adjudicator` with bead, epic, round, the reviewer's report, the
worker's report, and earlier rulings and decisions.

**d. Act on the rulings.**

- **Rulings note** (every round, first, so `--resume` can pick up):
  `bd note <id> "/deliver round <n> rulings: verdict <V>. ACTION: <F#: instruction; ...>. DEFER: <F#>. REJECT: <F#: reason>. ESCALATE: <E#>."`
  With zero findings:
  `bd note <id> "/deliver round <n> rulings: verdict COMMIT (zero findings; adjudicator skipped)."`
- **DEFER**: create each bead now, in the backlog, not under the epic (trunk
  mode: `followup:<id>`):
  ```bash
  bd create "<title>" --type task -p <bead's priority> --no-inherit-labels \
    -l "effort:<X>,<the bead's safety:* label>,followup:<epic>" \
    --deps "discovered-from:<id>" -d "<description>

  Deferred from /deliver review of <id>, round <n>." --json
  ```
- **REJECT**: nothing now; recorded in the summary note (step 3).
- **ESCALATE**: ask the operator ("Escalations" below), then record each:
  `bd note <id> "Operator decision (round <n>, <E#>): <question> -> <option>. Reason given: <notes or none>"`.

**e. Decide.**

| Verdict | Next |
|---|---|
| COMMIT | Leave the loop |
| REMEDIATE, round < 3 | Next round. If there are no ACTION items and no decision needs a code change, leave the loop instead |
| ESCALATE-BEAD, or REMEDIATE on round 3 | Ask the bead-level question |

Bead-level question (ask_question, header `Bead stuck`):

- **Commit as-is, defer the rest**: remaining ACTION items become DEFER
  beads; commit. Recommend only if they're non-critical (never for a red
  `tools/validate.sh` or a startup risk).
- **One more round**: a fourth review, then this question again.
- **Stop, keep it uncommitted**: diff stays, bead stays claimed; `--resume`
  later.
- **Split the bead**: the operator describes the split; create the split-off
  beads (epic mode: `--parent <epic> --no-inherit-labels`; trunk mode:
  standalone with `discovered-from:<id>`), then commit what's done.

```text
→ Round <n>: <A> action / <D> defer / <R> reject / <E> escalate — <verdict>
```

## Escalations

Print each escalation's **Context** as text first, then ask (at most 4
questions per call):

- `question`: the adjudicator's Question
- `header`: up to 12 characters
- `options`: the adjudicator's options, recommended first with
  " (Recommended)" appended; each `description` reads
  `<what happens>. Puts: <...>. Takes: <...>. Risk: <Low|Medium|High> — <why>.`
- `multiSelect`: false

If the operator picks "Other", their text is the decision; pass it to the
worker verbatim.

## 3. Commit

1. **Final check** (you run it, not the worker): `tools/validate.sh`. Red:
   back to the loop as an ACTION item if a round remains, otherwise the
   bead-level question.
2. **Stage precisely**: only the files in the worker's last "Files changed".
   Then `git status --porcelain`: anything else modified or untracked, show
   it and ask whether to include it, leave it, or stop. Never `git add -A`
   or `git add .`.
3. **Summary note.**
   `bd note <id> "/deliver: <rounds> round(s). Actioned: <n>. Deferred: <new ids>. Rejected: <F#: reason; ...>. Escalated: <n> (decisions in notes)."`
4. **Commit**, starting from the worker's proposed subject (repo style,
   `<scope>: <subject>`):
   ```text
   <scope>: <subject>

   <2-4 lines: what changed and why>

   Review: <rounds> round(s); <A> actioned, <D> deferred, <R> rejected, <E> escalated
   Bead: <id>
   <the session's attribution trailer, if any>
   ```
5. **Label.**
   ```bash
   SHA=$(git rev-parse --short HEAD)
   bd update <id> --add-label committed --add-label "commit:$SHA" --json
   bd update <id> --remove-label rework --json   # only if it carries rework
   ```
   Re-read `bd show <id> --json` to confirm.

## 4. Push

- **Epic mode.** `git push -u origin <branch>`. The pre-push hook runs
  `tools/validate.sh`; never bypass it. A red hook is fixed with a new
  commit or an ACTION round, never skipped.
- **Trunk mode.** Ask (ask_question, header `Push main`): "<id> is
  committed on main as <sha>. Push it?"
  - **Push and close (Recommended)**: `git push origin main`, confirm with
    `git merge-base --is-ancestor <sha> origin/main` after
    `git fetch origin`, then
    `bd close <id> --reason "commit <sha> on main (trunk mode)" --json`.
    Puts: done in one step. Takes: nothing. Risk: Low — the gate passed.
  - **Push only**: push and confirm; the bead stays claimed with
    `committed`. Close it later.
  - **Not yet**: nothing leaves this machine. Print the fish command for
    later: `git push origin main`.

```text
→ Committed <sha> on <branch>, <pushed | pushed and closed | not pushed>
```

## 5. What next

- Epic mode: `tools/epic-ready.sh <epic>`. Name the top candidate and
  mention `/explain-bead <next-id>`. Empty, with every child `committed` or
  closed: recommend `/validate-epic <epic>`.
- Trunk mode: `bd ready --json`, top candidate.

End with:

```text
---

**Result:** <id> delivered as <sha> on <branch> (<pushed | pushed and closed | not pushed>)
Mode: epic | trunk
Rounds: <n>
Actioned / Deferred / Rejected / Escalated: <a> / <d> / <r> / <e>
New beads: <ids or none>
Operator decisions: <count>
Next: <command>
```
