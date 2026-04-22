# Observability Bootstrap Runbook

## Purpose

Bootstrap and operate baseline metrics, logs, and traces dashboards with alert policies for `A8-S4-05`.

## Scope and Assets

- Dashboards:
  - `infra/observability/dashboards/metrics-overview.dashboard.json`
  - `infra/observability/dashboards/logs-health.dashboard.json`
  - `infra/observability/dashboards/traces-funnel.dashboard.json`
- Alert policy source:
  - `infra/observability/alerts/alert-policies.yaml`
- Validation gate:
  - `.github/workflows/observability-assets.yml`
  - `tests/smoke/observability-bootstrap.test.mjs`

## Bootstrap Procedure

1. Import all dashboard JSON files into the target dashboard platform as-is.
2. Configure data sources so the following metric families resolve:
   - `opportunity_computed_total`, `decision_latency_ms_bucket`, `dispatch_latency_ms_bucket`
   - `provider_requests_total`, `provider_request_errors_total`
   - `log_entries_total`, `log_parse_failures_total`
   - `trace_spans_total`, `trace_duration_ms_bucket`, `missing_trace_linkage_total`
   - `kill_switch_activated_total`, `hard_risk_breach_total`, `settlement_backlog_items`
3. Convert each alert policy in `infra/observability/alerts/alert-policies.yaml` into your alert manager format.
4. Ensure each alert keeps `runbook` labels so on-call can jump directly to triage sections.

## Incident Alert Response

Use this section for:
- `kill_switch_activated`
- `hard_risk_breach`

Procedure:
1. Acknowledge page immediately and freeze non-essential release activity.
2. Validate whether circuit-breaker behavior triggered within expected bounds.
3. Verify risk engine and execution orchestrator health before any resume decision.
4. Open or update incident ticket and attach trace/log evidence.

## Data Staleness Triage

Use this section for `data_staleness_breach`.

Procedure:
1. Check upstream availability (Pyth Hermes and venue quote endpoints).
2. Confirm ingestion lag and stale timestamp spread.
3. If stale window exceeds 10 minutes, engage provider-owner and platform on-call.
4. Keep aggressive strategies paused until freshness SLO recovers.

## Provider Outage Triage

Use this section for `provider_error_spike`.

Procedure:
1. Identify provider with highest error ratio from metrics dashboard.
2. Validate transport errors vs application errors in structured logs.
3. Shift routing or reduce traffic where feature flags allow.
4. Escalate when ratio remains >5% for two 10-minute windows.

## Settlement Backlog Triage

Use this section for `settlement_backlog_breach`.

Procedure:
1. Verify settlement worker throughput and queue lag.
2. Inspect recent execution terminal states for stuck transitions.
3. Apply backlog drain playbook in controlled batches.
4. Escalate if backlog remains above threshold for >30 minutes.

## SLO Collapse and Rollback Evaluation

Use this section for:
- `decision_latency_slo_breach`
- `dispatch_latency_slo_breach`

Procedure:
1. Confirm p95 breach duration from dashboard and alert history.
2. Correlate with error rates, provider health, and deploy events.
3. If sustained with degraded execution quality, start rollback decision process.
4. Follow rollback criteria from PRD section on automatic rollback conditions.

## Validation Commands

- Local smoke validation:
  - `node --test tests/smoke/observability-bootstrap.test.mjs`
- CI validation:
  - Trigger `Observability Assets Validation` workflow.
