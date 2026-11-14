# Beads in dev-tools

Overrides bd's default `bd prime` text. The rules live in CLAUDE.md
("Beads (work tracking)"); this is the short reminder after a new session or
compaction.

## Rules
- Beads data is private (Dolt remote `tck517/dev-tools-beads`); this repo is
  public. Never commit `.beads/*.jsonl` or copy bead notes into commits/docs.
- `bd dolt push` / `pull` only when the operator asks.
- Never `bd edit`, `bd create-form`, `bd delete`. Use `--json` when parsing.
- Scope changes: `bd note <id> "..."`.
- Workers never `bd close`. Beads close only after their change is on `main`,
  done by the orchestrator, which asks first.
- Each bead: one `safety:internal|reversible|hot`, one `effort:S|M|L|XL`;
  `human-ops` + `bd note <id> "Operator: ..."` for operator-only steps.

## Finding work
- `bd ready --json`: open and unblocked
- `bd list --status in_progress --json`: claimed work
- `bd show <id> --json`: details, dependencies, notes

## Creating and updating
- `bd create --title "..." --description "..." --type task|bug|feature|epic
  --priority 0-4 -l "safety:...,effort:..." --json`
- Under an epic: add `--parent <epic> --no-inherit-labels`
- `bd update <id> --claim --json`: claim (atomic)
- `bd label add <id> <label>` / `bd label remove <id> <label>`
- `bd dep add <blocked> --blocked-by <blocker>`

## Before you say you're done
1. Run `tools/validate.sh` if anything outside `.beads/` changed.
2. Record progress on the bead with `bd note`; don't close it.
3. Report what changed, the check results, and the bead's state; commit or
   push only when asked.
