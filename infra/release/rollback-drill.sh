#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${ROLLBACK_ARTIFACT_DIR:-.artifacts/rollback-drill}"
TIMESTAMP_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_ID="${GITHUB_RUN_ID:-local}"
MODE="${ROLLBACK_DRILL_MODE:-dry-run}"
SERVICE_NAME="${ROLLBACK_SERVICE_NAME:-execution-orchestrator}"
CANARY_PERCENT="${ROLLBACK_CANARY_PERCENT:-10}"
ERROR_BUDGET_THRESHOLD="${ROLLBACK_ERROR_BUDGET_THRESHOLD:-2}"
LATENCY_P95_THRESHOLD_MS="${ROLLBACK_LATENCY_P95_THRESHOLD_MS:-700}"
COMMANDS_FILE="${ARTIFACT_DIR}/rollback-commands.sh"
REPORT_FILE="${ARTIFACT_DIR}/rollback-drill-report.md"

mkdir -p "${ARTIFACT_DIR}"

cat > "${COMMANDS_FILE}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# Generated rollback command plan for run ${RUN_ID}
# Service: ${SERVICE_NAME}
# Mode: ${MODE}

echo "Step 1/4: freeze rollout at current canary (${CANARY_PERCENT}%)."
echo "Step 2/4: disable release feature flags for ${SERVICE_NAME}."
echo "Step 3/4: redeploy previous stable release for ${SERVICE_NAME}."
echo "Step 4/4: confirm smoke, risk, and reconciliation status is green."
EOF

chmod +x "${COMMANDS_FILE}"

{
  echo "# Rollback Drill Report"
  echo
  echo "- Run ID: \`${RUN_ID}\`"
  echo "- Timestamp (UTC): \`${TIMESTAMP_UTC}\`"
  echo "- Mode: \`${MODE}\`"
  echo "- Service: \`${SERVICE_NAME}\`"
  echo "- Canary traffic at trigger: \`${CANARY_PERCENT}%\`"
  echo "- Error budget rollback threshold: \`${ERROR_BUDGET_THRESHOLD}%\`"
  echo "- Decision latency rollback threshold: \`${LATENCY_P95_THRESHOLD_MS}ms\`"
  echo
  echo "## Trigger Criteria"
  echo
  echo "- Sustained failure-rate breach above configured threshold."
  echo "- Decision latency p95 above SLO threshold for two windows."
  echo "- Hard risk breach signal from risk engine."
  echo "- Reconciliation drift unresolved beyond threshold window."
  echo
  echo "## Verification Checklist"
  echo
  echo "- [ ] Rollout frozen and owner acknowledged."
  echo "- [ ] Previous release restored in staging."
  echo "- [ ] Smoke checks passed after rollback."
  echo "- [ ] Risk and reconciliation services report healthy status."
  echo "- [ ] Incident ticket and timeline updated."
  echo
  echo "## Command Plan"
  echo
  echo "\`bash ${COMMANDS_FILE}\`"
} > "${REPORT_FILE}"

echo "Rollback drill artifacts generated:"
echo "- ${COMMANDS_FILE}"
echo "- ${REPORT_FILE}"
