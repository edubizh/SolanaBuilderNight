# PNP Stage D — Guarded live runbook

## Purpose

This runbook describes how operators and automation run the **PNP (Prediction Network Protocol)** execution path in **Stage D guarded-live** mode: dry runs for validation, approval-gated live submissions, quote and order-status integrity checks, and settlement/redemption handoff. It complements Stage C DFlow procedures and reuses the **same notional and risk-cap policy** for consistency across venues.

## Scope

- **Components:** `PnpGuardedAdapter`, `PnpExecutionAdapter`, `PnpClient`, `PnpSettlementAdapter`.
- **Modes:** `dry_run` (default; no venue submission) and `guarded_live` (requires explicit `live: true`, valid approval token, and passing risk + quote gates).
- **Out of scope:** Changing promotion-gate thresholds, risk-engine limits, or circuit breaker settings (those are owned elsewhere and must not be edited as part of PNP adapter work).

## Guardrail policy (Stage D)

Aligned with Stage C DFlow defaults:

| Control | Value |
|--------|--------|
| Max notional per trade | **USD 250** |
| Max cumulative notional per UTC day | **USD 2,500** |
| Max slippage | **75 bps** |
| Approval TTL | **15 minutes** |
| No naked exposure | **Enforced** (requires exposure context or `reduceOnly` / hedge / reduction) |

## Required execution artifacts

Every guarded attempt should produce a durable record analogous to DFlow Stage C:

1. **Risk assessment** — output of `assessGuardedLiveRisk` (`allowed`, `violations`, `risk`, `caps`, `mode`).
2. **Execution artifact** — output of `executeGuardedLiveTrade` (`artifactId`, `liveRequested`, `liveExecuted`, `assessment`, `approval`, `quoteIntegrity`, `submission`).
3. **Audit trail** — `listGuardedExecutionAuditTrail()` entries (`approval_created`, `guarded_dry_run`, `guarded_rejected`, `guarded_live_executed`, etc.).
4. **Settlement records** — `buildSettlementRecord` → `markSettled` / `buildRedemptionRecord` as the position lifecycle completes.

Store artifacts under `infra/task-status/artifacts/` with UTC timestamps in filenames (see `infra/task-status/scripts/build-pnp-stage-d-evidence.mjs` for a dry-run template).

## Dry-run procedure

1. Configure `PnpGuardedAdapter` with `mode: "dry_run"` (default).
2. Build `orderRequest` (`marketId`, `side`, `size`, optional `maxSlippageBps`) and `riskContext` (`estimatedNotionalUsd`, exposure fields if no-naked enforcement is on).
3. Call `assessGuardedLiveRisk` and confirm `allowed === true` and `violations` is empty.
4. Call `executeGuardedLiveTrade(..., { live: false })` (or omit `live`).
5. Verify audit contains `guarded_dry_run`, `liveExecuted === false`, and `submission === null`.

## Live approval procedure

1. Operator (or tooling) calls `createGuardedLiveApproval` with `intentId`, `estimatedNotionalUsd`, and `approvedBy`.
2. Note `approvalId` and `expiresAtMs`; approvals expire after **15 minutes** by default.
3. For live execution, call `executeGuardedLiveTrade(..., { live: true, approvalId })` with `PnpGuardedAdapter` constructed in **`guarded_live`** mode.
4. The adapter peeks approval (non-consuming), validates quote integrity, then **consumes** the approval only after quote checks pass.
5. If submission fails after consumption, the audit records `guarded_rejected_submission_error` and the approval is already consumed — treat as incident and re-approve if appropriate.

## Order status polling

- Use `PnpExecutionAdapter.trackOrderStatusLifecycle({ orderId, intentId }, { pollIntervalMs: 500, maxAttempts: 20 })`.
- **Terminal states** include: `filled`, `succeeded`, `success`, `completed`, `confirmed`, `failed`, `rejected`, `cancelled` / `canceled`, `expired`, `dropped`.
- Validate each snapshot with `validateOrderStatusIntegrity(response, { nowMs, maxAgeMs: 30_000 })` before acting on status.

## Settlement and redemption

1. `buildSettlementRecord({ intentId, marketId, orderId, positionId? })` → `settlement_pending`.
2. `checkSettlementEligibility({ settlementRecord, nowMs })` before on-chain settlement work.
3. `markSettled({ settlementRecord, settlementTxId, settledAtMs })` → `settled`.
4. `buildRedemptionRecord({ settlementRecord, redemptionTxId, redeemedAtMs })` or `markRedeemed` → `redeemed` (evidence path may prefer `buildRedemptionRecord` for an immutable projection).

## Custom oracle guardrail

`PnpExecutionAdapter.executeOrder` enforces a **15-minute** window from `customOracleGuardrail.marketCreatedAtMs` when `requiresResolvableBy` is set: `setMarketResolvable` must be scheduled before that window elapses or orders are rejected. Remind desk engineers before any live cutover.

## Rollback / incident

- **Kill-switch:** Disable guarded live by setting adapter `mode` to `dry_run` or `guardrails.enabled` to `false` (assessments will fail closed with a configuration violation).
- **Escalation:** Preserve `executionAuditTrail` and evaluator/promotion-gate JSON; page Worker 5 / infra per `AGENTS.md` ownership.
- **Venue issues:** `PnpClient` retries idempotent **GET** requests on 408/429/5xx with bounded backoff; **POST /orders** does not retry unless explicitly changed — treat repeated failures as incident + potential idempotency review at the venue layer.
