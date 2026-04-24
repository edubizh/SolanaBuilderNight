# Unified Daily Readiness Report (PM-O-005)

## Purpose

Generate a deterministic daily readiness report that merges current promotion gate status, risk telemetry, opportunity telemetry, and guarded-live reliability evidence.

Outputs include:

- machine-readable JSON (`readiness-report-YYYYMMDDTHHMMSSZ.json`)
- operator markdown summary (`readiness-report-YYYYMMDDTHHMMSSZ.md`)
- deterministic gate status and blocker list
- deterministic trend summary compared to the latest prior readiness snapshot

The report is fail-closed. Missing required inputs or malformed contracts produce a non-zero exit and no output artifacts.

## Required Inputs

The builder consumes five JSON inputs:

1. promotion snapshot (PM-O-001 artifact shape)
2. risk telemetry (`task_id=PM-O-002`)
3. opportunity telemetry (`task_id=PM-O-003`)
4. guarded reliability evidence (`taskId=PM-C-001`)
5. guarded reliability evidence (`taskId=PM-C-002`)

### Required Fields

Promotion snapshot:

- `as_of_utc`
- `evaluator.paper_days_completed`
- `evaluator.guarded_live_days_completed`
- `evaluator.realized_pnl_usd`
- `evaluator.critical_risk_breaches`
- `evaluator.overall_pass`
- `evaluator.failed_criteria[]`

Risk telemetry:

- `task_id` (`PM-O-002`)
- `as_of_utc`
- `critical_breach_total`
- `top_causes[]` with `category`, `count`

Opportunity telemetry:

- `task_id` (`PM-O-003`)
- `as_of_utc`
- `accepted_count`
- `skipped_count`
- `expected_net_usd_p50`
- `expected_net_usd_p90`
- `skip_reasons[]` with `reason`, `count`

Guarded evidence:

- `taskId` (`PM-C-001` and `PM-C-002`)
- `generatedAtUtc` (`YYYYMMDDTHHMMSSZ`)
- `checks.guardedModeOnly=true`
- `checks.riskCapsConfigured=true`
- `checks.noNakedExposureEnforced=true`
- `checks.approvalTrailRequired=true`

## Run Command

From repository root:

```bash
node infra/ci/build-unified-readiness-report.mjs \
  <promotion-snapshot.json> \
  <risk-telemetry.json> \
  <opportunity-telemetry.json> \
  <dflow-evidence.json> \
  <gemini-evidence.json>
```

Optional output location:

- `READINESS_REPORT_OUTPUT_DIR` (default: `infra/task-status/artifacts/readiness`)

## Failure Diagnostics

Missing required fields fail deterministically with:

- `DIAGNOSTIC_CODE=missing_required_input`
- `BLOCKER_REASON=missing_required_input:<field>`

Malformed JSON or invalid field types fail with stable diagnostic codes such as:

- `json_parse_error`
- `invalid_contract_type`
- `invalid_contract_value`
- `evidence_check_failed`

No readiness artifacts are created when a required input contract fails.

## Gate Semantics

The report computes:

- promotion gate: pass when `evaluator.overall_pass=true`
- risk breach gate: pass when `critical_breach_total=0`
- opportunity signal gate: pass when `accepted_count>0`
- reliability gate: pass when required guarded checks are all true for both adapters

`overall_ready=true` only when all gates pass.

## Trend Summary

Trend summary compares current metrics to the latest older readiness report in the output directory:

- `realized_pnl_usd`
- `critical_breach_total`
- `accepted_count`
- `skipped_count`
- `expected_net_usd_p50`

If no prior report exists, trend is emitted as a deterministic baseline message.

## Smoke Validation

Run:

```bash
node --test tests/smoke/unified-readiness-report.test.mjs
```

Coverage includes:

- artifact generation for machine + markdown outputs
- deterministic trend deltas against prior snapshot
- fail-closed missing required telemetry fields
- blocker list generation when gates fail
