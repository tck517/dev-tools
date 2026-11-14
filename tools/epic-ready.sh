#!/usr/bin/env bash
# Ported from vibeacademy/website@e3bc0de (scripts/epic-ready.sh)
#
# List the beads in an epic that /deliver can take next.
#
# Usage:
#   tools/epic-ready.sh <epic-id>                  # id, priority, title (tabs)
#   tools/epic-ready.sh <epic-id> --check <bead>   # exit 0 if deliverable,
#                                                  # 1 with unmet blockers
# Exit 2 on any bd or parse failure: never reports "ready" on an error.
#
# `bd ready` under-reports inside an epic: a committed bead stays open
# (claimed) until the epic merges (docs/EPIC-WORKFLOW.md), so everything it
# blocks looks blocked. Here a blocker counts as satisfied when it is closed,
# or when it is a child of THIS epic labeled `committed` (its code is on this
# epic's branch). A blocker committed under another epic is on another,
# unmerged branch, so it only counts once closed.
#
# Reads bd per CLAUDE.md "Scripts that read bd".
set -euo pipefail

usage() { sed -n '4,10p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") usage >&2; exit 2 ;;
esac

for tool in bd jq perl; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "epic-ready: $tool is not installed" >&2; exit 2; }
done

epic="$1"
check=""
if [ "${2:-}" = "--check" ]; then
  check="${3:-}"
  [ -n "$check" ] || { usage >&2; exit 2; }
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

die() {
  echo "epic-ready: $*" >&2
  exit 2
}

# bd JSON -> sanitized JSON in file $1; non-zero if bd fails or prints nothing.
bd_json() {
  local dest="$1"
  shift
  bd "$@" --json >"$tmp/raw.json" 2>"$tmp/err" || {
    cat "$tmp/err" >&2; return 1; }
  perl -pe 's/[\x00-\x09\x0b\x0c\x0e-\x1f]/ /g' "$tmp/raw.json" >"$dest"
  [ -s "$dest" ]
}

bd_json "$tmp/epic.json" show "$epic" || die "cannot read epic $epic"
jq -e '.[0].issue_type == "epic"' "$tmp/epic.json" >/dev/null 2>&1 \
  || die "$epic is not an epic"

bd_json "$tmp/children.json" list --parent "$epic" --status all --limit 0 \
  || die "cannot list children of $epic"
jq -r '.[].id' "$tmp/children.json" >"$tmp/child-ids" 2>/dev/null \
  || die "failed to parse children of $epic"

# Writes a bead's unmet blockers ("id status") to $tmp/unmet; empty means
# deliverable.
unmet_blockers() {
  bd_json "$tmp/deps.json" dep list "$1" \
    || die "cannot read dependencies of $1"
  jq -r --rawfile kids "$tmp/child-ids" '
    ($kids | split("\n") | map(select(length > 0))) as $children
    | .[]
    | select(.dependency_type == "blocks")
    | select(
        .status != "closed"
        and ((((.labels // []) | index("committed")) != null
              and (.id as $i | $children | index($i)) != null) | not)
      )
    | "\(.id) \(.status)"' "$tmp/deps.json" >"$tmp/unmet" 2>/dev/null \
    || die "failed to parse dependencies of $1"
}

if [ -n "$check" ]; then
  grep -qxF "$check" "$tmp/child-ids" || die "$check is not a child of $epic"
  unmet_blockers "$check"
  if [ -s "$tmp/unmet" ]; then
    echo "$check is blocked by:"
    cat "$tmp/unmet"
    exit 1
  fi
  exit 0
fi

jq -r '.[] | select(.status == "open") | "\(.id)\t\(.priority)\t\(.title)"' \
  "$tmp/children.json" >"$tmp/open.tsv" 2>/dev/null \
  || die "failed to parse children of $epic"

tab="$(printf '\t')"
: >"$tmp/ready.tsv"
while IFS="$tab" read -r id priority title; do
  [ -n "$id" ] || continue
  unmet_blockers "$id"
  if [ ! -s "$tmp/unmet" ]; then
    printf '%s\t%s\t%s\n' "$id" "$priority" "$title" >>"$tmp/ready.tsv"
  fi
done <"$tmp/open.tsv"

sort -t "$tab" -k2,2n -k1,1 "$tmp/ready.tsv"
