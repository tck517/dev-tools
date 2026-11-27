#!/usr/bin/env bash
#
# Antigravity SessionStart Hook: injects `bd prime` tracker context via injectSteps.
# Bash 3.2-safe, shellcheck clean.

set -uo pipefail

# Drain stdin cleanly
cat >/dev/null || true

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HOOK_DIR}/../../../.." && pwd)"

if [ -d "${REPO_ROOT}/.beads" ] && command -v bd >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  prime_text=$(cd "$REPO_ROOT" && bd prime 2>/dev/null || true)
  if [ -n "$prime_text" ]; then
    jq -n --arg msg "$prime_text" '{
      injectSteps: [
        {
          systemMessage: {
            systemMessage: $msg
          }
        }
      ]
    }'
    exit 0
  fi
fi

printf '{}\n'
