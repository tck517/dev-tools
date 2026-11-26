#!/usr/bin/env bash
#
# Antigravity PreToolUse Hook: dev-tools Safety & Privacy Guard
#
# Mirrors .claude/settings.json plus public-repo / live-config guardrails:
#   DENY:
#     - Reading/writing secrets (~/.config/fish/secrets.fish, ~/.zsh_secrets,
#       *secret*, *.key, *credentials*, .env* except .env.example)
#     - Reading/writing .beads/*.jsonl (public repo; beads data is private)
#     - bd edit / bd create-form / bd delete
#     - git push --no-verify
#     - Reloading live config directly (./install.sh without --dry-run,
#       tmux source-file against default server, exec fish)
#   ASK:
#     - bd init / bd dolt push / bd dolt pull / bd close
#     - git push --force / git push -f (note: --force-with-lease allowed on epic/*)
#
# Bash 3.2-safe, shellcheck clean.

set -euo pipefail

input=$(cat)

emit_decision() {
  local decision="$1"
  local reason="${2:-}"
  if [ -n "$reason" ]; then
    jq -n --arg d "$decision" --arg r "$reason" '{decision: $d, reason: $r}'
  else
    printf '{"decision":"%s"}\n' "$decision"
  fi
}

tool_name=$(printf '%s' "$input" | jq -r '.toolCall.name // empty' 2>/dev/null || true)

is_beads_jsonl_path() {
  local p="$1"
  case "$p" in
    .beads/*.jsonl|./.beads/*.jsonl|*/.beads/*.jsonl) return 0 ;;
  esac
  return 1
}

is_secret_path() {
  local p="$1"
  local base
  base="$(basename "$p")"
  case "$p" in
    */.config/fish/secrets.fish|*/.zsh_secrets|*/dotfiles/fish/secrets.fish) return 0 ;;
  esac
  case "$base" in
    .env.example|.env.sample|.env.template) return 1 ;;
    .env|.env.*|*.key|*.pem|credentials.json|secrets.json|secrets.fish|.zsh_secrets) return 0 ;;
  esac
  case "$base" in
    *.md|*.txt|*.sh) return 1 ;;
    *secret*|*credentials*) return 0 ;;
  esac
  return 1
}

case "$tool_name" in
  read_file|edit_file|write_file)
    target_path=$(printf '%s' "$input" | jq -r '.toolCall.args.Path // .toolCall.args.path // empty' 2>/dev/null || true)
    if [ -n "$target_path" ] && is_beads_jsonl_path "$target_path"; then
      emit_decision "deny" "Blocked by dev-tools privacy rule: direct access to '$target_path' is denied; use bd with --json."
      exit 0
    fi
    if [ -n "$target_path" ] && is_secret_path "$target_path"; then
      emit_decision "deny" "Blocked by dev-tools safety guard: access to secret file '$target_path' is denied."
      exit 0
    fi
    emit_decision "allow"
    exit 0
    ;;

  run_command)
    cmd=$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)

    # 1. Hard denies
    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]].*)?--no-verify([[:space:]]|$)'; then
      emit_decision "deny" "Blocked by dev-tools safety guard: git push --no-verify is forbidden."
      exit 0
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])bd[[:space:]]+(edit|create-form)([[:space:]]|$)'; then
      emit_decision "deny" "Blocked by dev-tools beads hygiene: bd edit and bd create-form are interactive; use bd update flags instead."
      exit 0
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])bd[[:space:]]+delete([[:space:]]|$)'; then
      emit_decision "deny" "Blocked by dev-tools safety guard: bd delete is destructive; close or defer beads instead."
      exit 0
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(cat|head|tail|less|more|bat|sed|awk|grep|cp|mv)([[:space:]]|[[:space:]][^;&|]*[[:space:]/])\.beads/[^[:space:]/]+\.jsonl([[:space:];&|]|$)'; then
      emit_decision "deny" "Blocked by dev-tools privacy rule: direct shell access to .beads/*.jsonl is denied; use bd with --json."
      exit 0
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(cat|head|tail|less|more|bat|sed|awk|grep|cp|mv)([[:space:]]|[[:space:]][^;&|]*[[:space:]/])(\.zsh_secrets|secrets\.fish|\.env(\.[A-Za-z0-9_-]+)?|[^[:space:]/]+\.(key|pem))([[:space:];&|]|$)'; then
      if ! printf '%s' "$cmd" | grep -qE '\.env\.(example|sample|template)'; then
        emit_decision "deny" "Blocked by dev-tools safety guard: reading or copying secret files via shell is denied."
        exit 0
      fi
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(\./)?install\.sh([[:space:]]|$)'; then
      if ! printf '%s' "$cmd" | grep -qE -- '--dry-run'; then
        emit_decision "deny" "Blocked by dev-tools live-config rule: agents must not run install.sh without --dry-run (use tools/validate.sh to test links in a temp HOME)."
        exit 0
      fi
    fi

    # 2. Explicit operator confirmation gates
    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])bd[[:space:]]+dolt[[:space:]]+(push|pull)([[:space:]]|$)'; then
      emit_decision "ask" "Beads remote sync (bd dolt push/pull) requires explicit operator authorization."
      exit 0
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])bd[[:space:]]+(init|close)([[:space:]]|$)'; then
      emit_decision "ask" "bd init / bd close requires explicit operator authorization."
      exit 0
    fi

    if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]].*)?([[:space:]]--force([[:space:]]|$)|[[:space:]]-f([[:space:]]|$))'; then
      emit_decision "ask" "Plain git push --force / -f requires explicit operator authorization (use --force-with-lease on epic/* branches only)."
      exit 0
    fi

    emit_decision "allow"
    exit 0
    ;;

  *)
    emit_decision "allow"
    exit 0
    ;;
esac
