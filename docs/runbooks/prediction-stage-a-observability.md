# Prediction Stage A Observability Runbook

## Purpose

Define Stage A monitoring and audit procedures for prediction-market ingestion and quote-integrity controls (`PM-A-006`).

## Scope

- Ingestion lag and freshness telemetry for prediction market feeds.
- Quote validation integrity checks and stale-quote rejection tracking.
- Audit evidence collection for CI and on-call review.

## Stage A Signals

- Dashboard source:
  - `infra/observability/dashboards/metrics-overview.dashboard.json`
- Alert policies:
  - `prediction_ingestion_lag_breach`
  - `prediction_quote_integrity_failure_spike`
  - `prediction_stale_quote_rejection_spike`
- Alert policy file:
  - `infra/observability/alerts/alert-policies.yaml`

## Ingestion Lag Triage

Use for `prediction_ingestion_lag_breach`.

1. Validate current p95 lag and affected feed labels from dashboard queries.
2. Confirm whether lag is source-side (provider response latency) or consumer-side (pipeline backlog).
3. Check for correlated provider error spikes in baseline dashboard panel `Provider Error Rate by Source`.
4. If lag persists for two consecutive 10-minute windows, escalate as SEV-2 and pause stage promotion decisions.

## Quote Integrity Failure Triage

Use for `prediction_quote_integrity_failure_spike`.

1. Identify top failing venues via `quote_integrity_failures_total` grouped by venue/source labels.
2. Compare failed checks versus `quote_integrity_checks_total` to confirm ratio breach.
3. Sample failing payload logs and validate whether failures are format, sequencing, or staleness related.
4. Keep affected venue routing guarded until failure ratio returns below threshold.

## Stale Quote Triage

Use for `prediction_stale_quote_rejection_spike`.

1. Identify venue with highest `stale_quote_rejections_total` rate.
2. Validate upstream timestamp skew and local ingestion lag in the same period.
3. If stale rejections continue beyond 20 minutes, raise provider escalation and record incident timeline.
4. Document any temporary routing reductions applied during mitigation.

## Audit Evidence Capture

For every Stage A integrity incident or pre-promotion check, attach:

- Alert name, threshold, and first-trigger timestamp.
- Dashboard screenshot or query output showing breach and recovery.
- Smoke validation output from `prediction-stage-a-integrity` workflow artifact.
- Decision note indicating whether Stage A gate remains open or is held.

## Validation Commands

- Local:
  - `bash infra/ci/validate-prediction-stage-a.sh`
- CI:
  - Trigger `.github/workflows/prediction-stage-a-integrity.yml`
