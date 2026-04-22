#!/usr/bin/env bash
set -euo pipefail

GATE="${1:-}"
if [[ -z "$GATE" ]]; then
  echo "usage: $0 <lint|typecheck|unit|integration|smoke>"
  exit 2
fi

detect_runner() {
  if [[ -f "pnpm-lock.yaml" ]]; then
    echo "pnpm"
    return
  fi
  if [[ -f "yarn.lock" ]]; then
    echo "yarn"
    return
  fi
  if [[ -f "package-lock.json" ]]; then
    echo "npm"
    return
  fi
  echo ""
}

run_with_pm() {
  local pm="$1"
  local script_name="$2"
  case "$pm" in
    pnpm) pnpm run "$script_name" ;;
    yarn) yarn "$script_name" ;;
    npm) npm run "$script_name" ;;
    *)
      echo "unknown package manager: $pm"
      exit 1
      ;;
  esac
}

if [[ "$GATE" == "smoke" ]]; then
  if [[ ! -d "tests/smoke" ]]; then
    echo "tests/smoke not found; skipping smoke gate for bootstrap phase."
    exit 0
  fi

  shopt -s nullglob
  smoke_files=(tests/smoke/*.test.mjs)
  shopt -u nullglob

  if [[ ${#smoke_files[@]} -eq 0 ]]; then
    echo "No smoke test files found; skipping smoke gate for bootstrap phase."
    exit 0
  fi

  echo "Running smoke suite..."
  node --test "${smoke_files[@]}"
  exit 0
fi

if [[ ! -f "package.json" ]]; then
  echo "package.json not found; skipping ${GATE} gate for repo bootstrap phase."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is not available in CI runner."
  exit 1
fi

PM="$(detect_runner)"
if [[ -z "$PM" ]]; then
  PM="npm"
fi

if node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));process.exit((p.scripts&&p.scripts['${GATE}'])?0:1)"; then
  echo "Running ${GATE} via ${PM}..."
  run_with_pm "$PM" "$GATE"
  exit 0
fi

echo "No '${GATE}' script in package.json; skipping gate for bootstrap phase."
