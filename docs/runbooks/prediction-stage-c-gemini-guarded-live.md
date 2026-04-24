# Prediction Stage C Gemini Guarded Live Runbook

## Purpose

Define Stage C guarded-live operating procedures for `PM-C-002`, including conservative risk caps, approval control, dry-run evidence, and strict no-naked-exposure enforcement.

## Scope

- Gemini adapter guarded mode only (`dry_run` and `guarded_live`).
- Operator approval issuance and consumption trail.
- Risk-cap rejection and exposure-policy violation response.

## Guardrail Policy (Stage C)

- Mode defaults to `dry_run`; live submission is allowed only when mode is `guarded_live`.
- Per-trade notional cap:
  - `maxNotionalUsd` (default `250` USD).
- Daily cumulative notional cap:
  - `maxDailyNotionalUsd` (default `2500` USD).
- Slippage cap:
  - `maxSlippageBps` (default `75` bps).
- No-naked-exposure rule:
  - trade must be `reduceOnly`, or
  - reduce absolute net exposure, or
  - be fully hedged (`hedgedExposureUsd >= |projectedNetExposureUsd|`).
- Operator approval:
  - required for every live attempt,
  - bound to `intentId`,
  - bounded by approved notional and TTL.

## Required Execution Artifacts

Every guarded execution attempt must produce an artifact record with:

- `artifactId`
- `mode`, `liveRequested`, `liveExecuted`
- `assessment.allowed` and `assessment.violations`
- approval details for live attempts (`approvalId`, approver, TTL, used timestamp)
- quote integrity result before live submission
- submission metadata (`idempotencyKey`, deduplication flag)

Persist artifact snapshots into the Stage C evidence bundle.

## Dry-Run Procedure

1. Ensure adapter guardrails are enabled and mode is `dry_run`.
2. Run guarded execution with realistic `riskContext` and `swapPayload`.
3. Verify result has:
   - `liveExecuted: false`
   - deterministic risk assessment
   - either empty violations (eligible) or explicit violation reasons (rejected)
4. Archive artifact JSON and attach to PM-C-002 evidence.

## Live Approval Procedure

1. Create approval token with:
   - `intentId`
   - `approvedNotionalUsd`
   - `approvedBy`
   - `ttlMs`
2. Execute guarded call with `live: true` and `approvalId`.
3. Verify:
   - approval is consumed once (`used: true`)
   - notional does not exceed approved amount
   - quote integrity is `ok: true` before submission
4. Record approval + execution artifact pair as audit evidence.

## Alert-Driven Triage

### Guarded rejection triage

Use for `prediction_gemini_guarded_rejection_spike`.

1. Inspect `assessment.violations` categories (notional, daily cap, slippage, no-naked).
2. Confirm whether caps were intentionally tightened or upstream risk inputs regressed.
3. If rejection rate blocks routing for >20m, hold Stage C progression and escalate to risk owner.

### Approval trail breach

Use for `prediction_gemini_live_without_approval`.

1. Treat as SEV-1 policy breach.
2. Trigger kill-switch evaluation immediately.
3. Freeze guarded-live mode until approval plumbing and logs are validated.
4. Attach breach timeline and remediation actions to incident record.

### Naked exposure violation

Use for `prediction_gemini_naked_exposure_violation`.

1. Halt further live submissions.
2. Validate provided exposure context against risk-engine outputs.
3. Reconcile hedged-leg state and projected net exposure inputs.
4. Resume only after no-naked checks pass in dry-run replay.

## Validation Commands

- Guarded Stage C evidence generation:
  - `bash infra/ci/validate-prediction-stage-c-gemini-guarded.sh`
