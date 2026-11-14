---
description: Validate an epic — rebase, tools/validate.sh, smoke test, epic-reviewer; after the operator merges, close its beads
argument-hint: <epic-id>
---

<!-- Ported from vibeacademy/website@e3bc0de (.claude/commands/validate-epic.md) -->

Validate one epic whose children were delivered with `/deliver`: rebase its
branch onto `origin/main`, run the gate and a live smoke test, and launch
`epic-reviewer`. Then stop: the operator merges. Run again after the merge
and it closes every child bead and the epic.

| Mode | When | Does |
|---|---|---|
| Validate | The epic branch is not merged | Pre-flight, rebase, checks, `epic-reviewer`, then hands off the merge |
| Closure (automatic) | The epic branch is merged into `origin/main` | Closes children in dependency passes, then the epic |

Spec: `docs/EPIC-WORKFLOW.md`; read it first if you haven't this session.

Arguments: `$ARGUMENTS` (an epic id). Anything else is operator guidance:
record it with `bd note <epic>`.

## How this command runs

**You (the main session) are the orchestrator.** You run git, bd and the
checks yourself, launch `epic-reviewer` with the Agent tool, and are the only
one who asks the operator questions. Report progress with `→` / `✗` lines.

## Critical rules

1. Never merge into `main`, never commit to `main`, never push `main`. The operator merges.
2. `git push --force-with-lease` only on `epic/*` branches, only after a rebase this command performed. Never plain `--force`. Never `--no-verify`.
3. Never resolve rebase conflicts silently: `git rebase --abort`, show the conflicting files, stop.
4. Never `bd close` until step 6 confirms the merge is on `origin/main`. Never `bd close --force`.
5. Every bd parse uses `--json`. Run bd loops under `bash -c`; commands printed for the operator are fish syntax.
6. Create beads with `--no-inherit-labels`.
7. If the epic id looks incomplete, ask for the full id. Never guess.
8. Run checks as plain commands; never pipe one into `tail` or `head`.
9. Operator decisions are recorded with `bd note <epic>` and are binding for the rest of the run.

## 1. Find the epic and its branch

1. `bd show <epic> --json`. Stop if it doesn't exist, isn't `issue_type`
   `epic`, or is closed.
2. `git fetch origin`, then find the branch:
   `git branch --list 'epic/<epic>-*'` and
   `git ls-remote --heads origin 'epic/<epic>-*'`. None: stop, no `/deliver`
   run has made one. More than one: list them and ask.
3. **Merged?** Take the branch tip (`git rev-parse <branch>`, or
   `origin/<branch>` if there's no local branch). It's merged when a merge
   commit on `origin/main` has the tip as its second parent:
   ```bash
   git rev-list --merges --parents origin/main | awk -v t="<full tip sha>" '$3 == t {print $1}'
   ```
   A sha printed: go to section 6 (closure). Nothing printed but
   `git merge-base --is-ancestor <tip> origin/main` succeeds: the branch has
   no commits of its own, or was fast-forwarded; stop and ask.

```text
→ <epic> "<title>": branch <branch>, <unmerged | merged: closure>
```

## 2. Pre-flight (fail closed)

1. **Branch.** Switch to `<branch>` (remote only:
   `git switch --track origin/<branch>`). Say in one line that the working
   tree is live while it's checked out.
2. **Clean tree.** `git status --porcelain` must be empty. Otherwise show it
   and stop.
3. **Every child delivered.**
   `bd list --parent <epic> --status all --limit 0 --json`. Each child must
   be `closed`, or `in_progress` with `committed`. Anything else (open,
   claimed but uncommitted, `rework`): list them and stop.
4. **Rebase onto `origin/main`.**
   ```bash
   git rebase origin/main
   ```
   On conflict: abort, show the files, stop. If `HEAD` moved, refresh each
   bead's `commit:*` labels from the `Bead:` trailers:
   ```bash
   git log --format='%h%x09%(trailers:key=Bead,valueonly,separator=%x2C)' origin/main..HEAD
   ```
   For each bead, remove only the stale `commit:*` label it replaces, then
   add `commit:<new short sha>` (two calls), and re-read
   `bd show <id> --json`. A reworked bead keeps one label per commit.

```text
→ Pre-flight: <n> children delivered, rebased <yes | not needed>
```

## 3. Checks

Run each as a plain command, from the repo root, on the rebased branch:

1. `tools/validate.sh`. Note its `skip` lines.
2. `tools/smoke.sh`: a throwaway tmux server (`tmux -L dev-tools-smoke -f
   dotfiles/tmux.conf`) starts fish, and fish starts headless Neovim. It
   needs the `$HOME` links pointing into this checkout and says so if not
   (the operator runs `./install.sh`; you don't).
3. **kitty.** If `git diff --stat origin/main...HEAD` touches
   `dotfiles/kitty.conf`, nothing can check it headless. Ask the operator
   (AskUserQuestion, header `kitty`) to open a new kitty window and confirm
   it starts without an error banner: **Opens cleanly** / **Shows an
   error** (then treat it as a failure, step 5).

Any red: go to section 5. Then push the branch:
`git push --force-with-lease -u origin <branch>` if the rebase moved
commits, otherwise `git push -u origin <branch>`. The pre-push hook runs.
Record `HEAD_SHA=$(git rev-parse HEAD)`, and
`bd note <epic> "/validate-epic checks PASS at <short sha>: validate.sh (<skips>), smoke test<, kitty confirmed>"`.

```text
→ Checks green at <short sha>: validate.sh, smoke test<, kitty>; pushed
```

## 4. Epic review

Launch `epic-reviewer` with the epic id, the branch, `HEAD_SHA`, and the
check summary. It records `verdict:go|no-go` and a note on the epic bead.
Then confirm exactly one `verdict:*` label with `bd show <epic> --json`.

- **GO.** Stop here and hand the merge to the operator, in fish syntax:
  ```fish
  git switch main; and git pull --ff-only
  git merge --no-ff <branch>
  git push
  ```
  Never squash. Then `/validate-epic <epic>` again closes the beads. Show
  the reviewer's Suggestions; if the operator wants any filed, create them
  as backlog beads with `followup:<epic>` (never under the epic).
- **NO-GO.** Go to section 5 with the Required changes, offering
  **Disagree (override)** as well.

```text
→ epic-reviewer: <GO | NO-GO> at <short sha>
```

## 5. On failure

For a red check or a NO-GO.

1. **Triage** each failure to the bead whose commit last touched that file
   (`git log --format='%h %s%n%b' origin/main..HEAD -- <path>` and the
   `Bead:` trailers). A failure that maps to no bead is its own group.
2. **Ask per group** (AskUserQuestion, at most 4 per call, header
   `Triage`). Print the failure details as text first. Options, each with
   `Puts / Takes / Risk`:
   - **Rework <bead>** (recommended when the mapping is clear).
   - **New fix bead**: a child
     (`bd create ... --parent <epic> --no-inherit-labels`, with `safety:*`
     and `effort:*`), then `/deliver` it.
   - **Flaky check**: re-run the check once; a second failure is real.
   - NO-GO only, **Disagree (override)**:
     `bd note <epic> "Operator override (NO-GO): <reason>"`.
3. **Rework** for the chosen bead:
   ```bash
   bd update <id> --status open --remove-label committed --json
   bd update <id> --add-label rework --json
   bd note <id> "/validate-epic rework: <failing check or finding, what to fix>"
   ```
   The fix is a new `/deliver <id>` commit with the same `Bead:` trailer;
   history is never rewritten.
4. Tell the operator the next step: `/deliver <id>` per reworked bead, then
   `/validate-epic <epic>` again. Stop.

## 6. Closure (the epic branch is merged)

No pre-flight, rebase or push.

1. **Confirm the merge.** The merge commit is the one step 1.3 found. Then
   every child's `commit:*` sha must pass
   `git merge-base --is-ancestor <sha> origin/main`; any that doesn't: stop
   and list it.
2. **Provenance** from the epic's labels:
   - `verdict:go`: "after GO review".
   - `verdict:no-go` with an `Operator override (NO-GO)` note: "over NO-GO
     by operator override". Without the note: ask the operator.
   - Neither: ask the operator what to record. Don't invent one.
   Reason: `merged to main as <merge short sha> (epic <epic>) <suffix>`.
3. **Ask before closing** (AskUserQuestion, header `Close`): list the
   children and the reason; **Close all (Recommended)** / **Not now**.
4. **Children first, in passes** (`bd close` refuses a bead with open
   blockers). Close only children that are `committed` (or already closed);
   anything else: list it and ask whether to defer it
   (`bd update <id> --status deferred --json`) or stop.
   ```bash
   bash -c '
   reason="merged to main as <merge short sha> (epic <epic>) <suffix>"
   ids=$(bd list --parent <epic> --status in_progress --limit 0 --json \
     | jq -r ".[] | select(.labels // [] | index(\"committed\")) | .id")
   while [ -n "$ids" ]; do
     progress=0; remaining=""
     for id in $ids; do
       if bd close "$id" --reason "$reason" --json >/dev/null 2>&1; then
         progress=1
       else
         remaining="$remaining $id"
       fi
     done
     ids=$(echo $remaining)
     [ "$progress" = 1 ] || break
   done
   echo "unclosed: $ids"
   '
   ```
   A non-empty `unclosed`: show each one's blockers
   (`bd dep list <id> --json`) and stop; don't close the epic.
5. **Then the epic**, once every child is closed or deferred:
   `bd close <epic> --reason "<reason>" --json`. Re-read
   `bd show <epic> --json` and the children list to confirm nothing is open.
6. **Clean up.** Tell the operator, in fish syntax, how to delete the
   branch (`git branch -d <branch>; and git push origin --delete <branch>`);
   don't do it yourself. Remind them to regroom `followup:<epic>` beads.

```text
→ Closure: merged as <sha>; closed <k> children in <p> pass(es), then <epic>
```

## 7. Result Block

```text
---

**Result:** <epic> validation <GO | NO-GO | FAILED | BLOCKED> at <short sha>
Epic: <epic> — <title>
Branch: <branch> (<pushed | not pushed>)
Checks: validate.sh <pass|fail> (<skips>) / smoke <pass|fail|not run> / kitty <confirmed|n/a|not run>
Epic review: GO | NO-GO | not reached
Reworked beads: <ids or none>
Operator decisions: <count>
Next: <"operator merges with --no-ff, then /validate-epic <epic>" | command>
```

```text
---

**Result:** <epic> closed after merge <short sha>
Children closed: <ids> in <p> pass(es)
Deferred / left open: <ids or none>
Provenance: <suffix>
Next: delete the branch; regroom followup:<epic> beads
```
