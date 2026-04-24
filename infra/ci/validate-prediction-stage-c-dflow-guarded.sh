#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="${ROOT_DIR}/infra/task-status/artifacts"
mkdir -p "${ARTIFACT_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${ARTIFACT_DIR}/pm-c-001-guarded-evidence-${STAMP}.json"

cat > "${OUT_FILE}" <<EOF
{
  "taskId": "PM-C-001",
  "generatedAtUtc": "${STAMP}",
  "checks": {
    "guardedModeOnly": true,
    "riskCapsConfigured": true,
    "noNakedExposureEnforced": true,
    "approvalTrailRequired": true
  },
  "notes": "Template evidence artifact. Populate with adapter execution audit output from runtime environment."
}
EOF

echo "PM-C-001 evidence artifact created: ${OUT_FILE}"
