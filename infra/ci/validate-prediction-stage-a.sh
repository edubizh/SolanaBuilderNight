#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${ARTIFACT_DIR:-.artifacts/prediction-stage-a}"
mkdir -p "${ARTIFACT_DIR}"

LOG_FILE="${ARTIFACT_DIR}/prediction-stage-a-integrity.log"

echo "Running Stage A prediction integrity smoke validation..."
echo "Artifacts directory: ${ARTIFACT_DIR}"

node --test tests/smoke/prediction-stage-a-integrity.test.mjs 2>&1 | tee "${LOG_FILE}"

echo "Validation complete. Log: ${LOG_FILE}"
