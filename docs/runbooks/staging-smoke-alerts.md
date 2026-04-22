# Staging Smoke Alerts Runbook

## Purpose

Define triage steps for failures from the `Staging Smoke Pipeline` GitHub workflow.

## Trigger

An alert issue with labels `alert` and `staging-smoke` is created automatically when `.github/workflows/staging-smoke.yml` fails.

## Required Configuration

- GitHub Environment `staging` exists.
- `staging` environment secret `STAGING_SMOKE_URL` is set to a stable health endpoint.
- Optional repository variable `STAGING_SMOKE_TIMEOUT_MS` may be set (default: `10000`).

## Triage Procedure

1. Open the failing workflow run linked in the alert issue.
2. Download artifact `smoke-artifacts-<run_id>`.
3. Inspect `.artifacts/smoke/smoke-gate.log` to classify failure:
   - **Config failure**: `STAGING_SMOKE_URL must be set` or missing environment value.
   - **Network/timeout failure**: request aborted or DNS/connectivity errors.
   - **Service health failure**: endpoint returns non-2xx/3xx.
4. Confirm whether failure is transient by rerunning the workflow once.
5. If rerun fails, escalate to on-call and open/associate an incident ticket.

## Escalation Guidance

- Treat two consecutive failures as `SEV-2` until root cause is identified.
- Engage platform owner when timeout/network failures exceed 30 minutes.
- Engage service owner when response status failures persist across two runs.

## Recovery Validation

Recovery is complete when:
- One manual rerun succeeds, and
- The next scheduled run succeeds without intervention.
