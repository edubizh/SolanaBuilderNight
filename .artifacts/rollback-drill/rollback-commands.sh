#!/usr/bin/env bash
set -euo pipefail

# Generated rollback command plan for run local
# Service: execution-orchestrator
# Mode: dry-run

echo "Step 1/4: freeze rollout at current canary (10%)."
echo "Step 2/4: disable release feature flags for execution-orchestrator."
echo "Step 3/4: redeploy previous stable release for execution-orchestrator."
echo "Step 4/4: confirm smoke, risk, and reconciliation status is green."
