# Rollback Drill Report

- Run ID: `local`
- Timestamp (UTC): `2026-04-22T02:59:08Z`
- Mode: `dry-run`
- Service: `execution-orchestrator`
- Canary traffic at trigger: `10%`
- Error budget rollback threshold: `2%`
- Decision latency rollback threshold: `700ms`

## Trigger Criteria

- Sustained failure-rate breach above configured threshold.
- Decision latency p95 above SLO threshold for two windows.
- Hard risk breach signal from risk engine.
- Reconciliation drift unresolved beyond threshold window.

## Verification Checklist

- [ ] Rollout frozen and owner acknowledged.
- [ ] Previous release restored in staging.
- [ ] Smoke checks passed after rollback.
- [ ] Risk and reconciliation services report healthy status.
- [ ] Incident ticket and timeline updated.

## Command Plan

`bash .artifacts/rollback-drill/rollback-commands.sh`
