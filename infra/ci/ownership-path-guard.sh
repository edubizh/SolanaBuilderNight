#!/usr/bin/env bash
set -euo pipefail

AGENT_ID="${AGENT_ID:-8}"
BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-HEAD}"
CHANGED_FILES_OVERRIDE="${CHANGED_FILES_OVERRIDE:-}"

if [[ "$AGENT_ID" != "8" ]]; then
  echo "ownership-path-guard is configured for Agent 8 tasks only."
  exit 1
fi

ALLOWED_REGEX='^(infra/|\.github/workflows/|tests/smoke/|docs/runbooks/|TASKS\.md$)'
VIOLATIONS=0

if [[ -n "$CHANGED_FILES_OVERRIDE" ]]; then
  echo "Using CHANGED_FILES_OVERRIDE for guard evaluation."
  CHANGED_FILES="$CHANGED_FILES_OVERRIDE"
elif ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Repository has no commits yet; scanning staged/unstaged paths."
  CHANGED_FILES="$(git ls-files -m -o --exclude-standard)"
else
  if [[ -z "$BASE_SHA" ]]; then
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      BASE_SHA="HEAD~1"
    else
      BASE_SHA="$(git rev-list --max-parents=0 HEAD)"
    fi
  fi

  echo "Checking changed files from ${BASE_SHA} to ${HEAD_SHA} for Agent ${AGENT_ID} scope..."
  if ! CHANGED_FILES="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"; then
    echo "Unable to compute git diff between '${BASE_SHA}' and '${HEAD_SHA}'."
    exit 1
  fi
fi

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  if [[ ! "$path" =~ $ALLOWED_REGEX ]]; then
    echo "disallowed path for Agent ${AGENT_ID}: ${path}"
    VIOLATIONS=1
  fi
done <<< "$CHANGED_FILES"

if [[ "$VIOLATIONS" -ne 0 ]]; then
  echo "Ownership-path guard failed."
  exit 1
fi

echo "Ownership-path guard passed."
