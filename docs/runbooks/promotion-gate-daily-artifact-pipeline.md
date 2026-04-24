# Promotion Gate Daily Artifact Pipeline (PM-G-002)

## Purpose

Build daily promotion-gate evidence artifacts wired to the `PM-G-001` evaluator contract.

The pipeline produces:

- machine-readable snapshot JSON
- human-readable markdown summary
- deterministic `Remaining To Unlock` guidance for operators

## Contract and Policy Requirements

Required evaluator keys from `PM-G-001`:

- `as_of_utc`
- `paper_days_completed`
- `guarded_live_days_completed`
- `realized_pnl_usd`
- `critical_risk_breaches`
- `overall_pass`
- `failed_criteria[]`

STRICT WALL-CLOCK policy:

- UTC day boundary math only (no rolling 24h windows).
- `paper_days_completed` and `guarded_live_days_completed` must match:
  - `floor((UTC day start(as_of_utc) - UTC day start(started_at)) / 86400000)`
- milliseconds within a UTC day never grant fractional day credit.

## Components

- Workflow: `.github/workflows/promotion-gate-artifact-scaffold.yml`
- Builder script: `infra/ci/build-promotion-gate-daily-artifacts.mjs`
- Smoke validation: `tests/smoke/promotion-gate-daily-artifact-pipeline.test.mjs`

## How To Run

From repository root:

```bash
node infra/ci/build-promotion-gate-daily-artifacts.mjs <evaluator.json> <context.json>
node --test tests/smoke/promotion-gate-daily-artifact-pipeline.test.mjs
node tests/smoke/promotion-gate-pm-g-004-evidence.mjs
```

Evaluator payload example (`evaluator.json`):

```json
{
  "as_of_utc": "2026-04-24T00:00:00.000Z",
  "paper_days_completed": 7,
  "guarded_live_days_completed": 3,
  "realized_pnl_usd": 10.5,
  "critical_risk_breaches": 0,
  "overall_pass": true,
  "failed_criteria": []
}
```

Context payload example (`context.json`):

```json
{
  "paper_started_at_utc_ms": 1776383999999,
  "guarded_live_started_at_utc_ms": 1776643200000
}
```

## Workflow Inputs

`workflow_dispatch` accepts two JSON string inputs:

- `evaluator_payload_json`
- `context_payload_json`

Scheduled daily runs read repository variables:

- `PROMOTION_GATE_EVALUATOR_PAYLOAD_JSON`
- `PROMOTION_GATE_CONTEXT_PAYLOAD_JSON`

If either payload is missing or invalid JSON, the workflow fails immediately.

Missing required input data is a hard deterministic failure:

- process exits with non-zero code
- logs include explicit blocker reason as `BLOCKER_REASON=missing_required_input:<field>`
- no promotion-gate output artifacts are written for failed runs

## Expected Output

Artifacts are written under `infra/task-status/artifacts/promotion-gate/`:

- `promotion-gate-daily-snapshot-YYYYMMDDTHHMMSSZ.json`
- `promotion-gate-daily-summary-YYYYMMDDTHHMMSSZ.md`

The markdown summary includes:

- strict wall-clock policy section
- failed criteria section
- `Remaining To Unlock` section (always present)

## PM-G-004 Evidence Paths

Run `node tests/smoke/promotion-gate-pm-g-004-evidence.mjs` to capture pass/fail evidence under:

- `tests/smoke/artifacts/promotion-gate/pm-g-004/evidence-summary.md`
- `tests/smoke/artifacts/promotion-gate/pm-g-004/pass-run.log`
- `tests/smoke/artifacts/promotion-gate/pm-g-004/missing-data-failure.log`
- `tests/smoke/artifacts/promotion-gate/pm-g-004/pass-artifacts/`
