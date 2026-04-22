# Release Rollback Drill Runbook

## Purpose

Define the standard rollback drill used to validate release readiness for constrained live deployment in staging.

## Scope

- Applies to release candidates touching execution, risk, settlement, or control-plane orchestration.
- Covers automated dry-run drill (`infra/release/rollback-drill.sh`) and mandatory post-drill smoke validation.

## Preconditions

- Latest integration and smoke pipelines are green.
- Staging environment is healthy and `STAGING_SMOKE_URL` is configured.
- On-call responder and release owner are both assigned for the drill window.

## Rollback Trigger Matrix

Rollback is mandatory when any of the following conditions are sustained:

- Failure-rate breach over configured threshold window.
- Decision latency p95 exceeds `700ms` for two consecutive windows.
- Hard risk breach signal or global kill-switch activation.
- Reconciliation drift unresolved beyond configured threshold.

## Drill Procedure

1. Trigger workflow `.github/workflows/release-rollback-drill.yml` with default `dry-run` mode.
2. Confirm `Rollback Drill Validation` job generated artifacts in `rollback-drill-artifacts-<run_id>`.
3. Open `rollback-drill.log` and verify command plan generation completed.
4. Review generated report `rollback-drill-report.md` and check trigger criteria and checklist entries.
5. Confirm post-drill smoke gate succeeded (`post-drill-smoke.log`).
6. If the post-drill smoke gate fails, stop release progression and open/associate incident ticket.

## Recovery Exit Criteria

Release pipeline may continue only when all conditions are met:

- Rollback drill script exits successfully.
- Post-drill smoke gate exits successfully.
- No unresolved `sev1` or `sev2` incidents linked to rollout state.
- Release owner and on-call responder both acknowledge recovery status.

## Evidence and Audit Trail

Store the following in release evidence:

- Workflow run URL and run ID.
- Uploaded artifact bundle `rollback-drill-artifacts-<run_id>`.
- Generated report from `.artifacts/rollback-drill/rollback-drill-report.md`.
- Any incident link and mitigation notes (if rollback criteria triggered).

## Escalation

- First failed drill: classify as `SEV-2`, assign release owner + platform on-call.
- Repeated failed drill within 24h: escalate to incident commander and pause release train.
- Any hard risk breach simulation anomaly: page risk owner immediately.
