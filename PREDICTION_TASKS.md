# PREDICTION_TASKS.md

Status: Active
Last Updated: April 24, 2026 (UTC-4)
Canonical Inputs:
- `PRD.md`
- `AGENTS.md`
- `PREDICTION_MARKETS_PIVOT_PLAN.md`
- `CURSOR_AGENT_WINDOW_PLAYBOOK.md`
- `TASKS.md` (historical reference only)

## Status Legend

- `TODO`: not started
- `READY`: dependencies satisfied and can begin now
- `IN_PROGRESS`: worker actively implementing
- `BLOCKED`: waiting on dependency ID
- `REVIEW`: implementation complete; awaiting master quality gate checks
- `DONE`: accepted by master after all required gates/evidence pass

## Active Board

| ID | Owner | DependsOn | Scope | StageGate | EvidenceRequired | Status | Notes |
|---|---|---|---|---|---|---|---|
| PM-A-001 | Worker 1 (Contracts/Types) | None | `packages/contracts/**`, `packages/shared-types/**`, `packages/config/**`, `docs/architecture/**` | Stage A | Contract/type diff, compatibility notes, typecheck output | DONE | Prediction-specific ownership established: Worker 1 owns all prediction shared contracts and canonical enums. |
| PM-A-002 | Worker 2 (Cross-Venue Mapping/Canonicalization) | PM-A-001 | `services/ingestion-gateway/**`, `services/state-normalizer/**`, `tests/unit/ingestion/**`, `tests/integration/ingestion/**` | Stage A | Canonical market mapping artifacts, normalization tests, replay sample evidence | DONE | Prediction-specific ownership established: Worker 2 owns venue symbol/event canonicalization and mapping transforms. |
| PM-A-003 | Worker 3 (DFlow Prediction Execution) | PM-A-001 | `services/execution-orchestrator/adapters/dflow/**`, `tests/unit/dflow/**`, `tests/integration/dflow/**` | Stage A | DFlow prediction quote/order-status integrity tests and logs | DONE | Stage A scope constrained to quote/order integrity only; no live trade execution enablement. |
| PM-A-004 | Worker 4 (Gemini Prediction Execution) | PM-A-001 | `services/execution-orchestrator/adapters/gemini/**`, `tests/unit/gemini/**`, `tests/integration/gemini/**` | Stage A | Gemini market/quote adapter tests, auth-surface stubs, deterministic snapshot logs | DONE | Prediction-specific ownership established: Worker 4 owns Gemini adapter path; creates new scope under execution orchestrator. |
| PM-A-005 | Worker 5 (PNP Execution Hardening) | PM-A-001 | `services/execution-orchestrator/adapters/pnp/**`, `services/position-settlement-service/adapters/pnp/**`, `tests/unit/pnp/**`, `tests/integration/pnp/**` | Stage A | PNP quote integrity and stale-data rejection test evidence | DONE | Stage A only: quote integrity and validation hardening; no Stage D live promotion behavior yet. |
| PM-A-006 | Worker 8 (Control Plane + Observability + Runbooks) | None | `infra/**`, `.github/workflows/**`, `tests/smoke/**`, `docs/runbooks/**` | Stage A | Stage A dashboard/alerts/runbook docs + smoke evidence for ingestion/quote integrity | DONE | Prediction-specific ownership established: Worker 8 owns stage-gate observability and operational runbooks. |
| PM-B-001 | Worker 6 (Opportunity/Arb Engine) | PM-A-002, PM-A-003, PM-A-004, PM-A-005 | `services/opportunity-engine/**`, `tests/unit/opportunity/**`, `tests/integration/opportunity/**` | Stage B | Paper arb loop tests, deterministic decision logs, spread-to-intent artifacts | DONE | Stage B task. Must preserve no-naked-exposure assumption in decision outputs. |
| PM-B-002 | Worker 7 (Risk + PnL + Exposure Controls) | PM-B-001 | `services/risk-engine/**`, `services/position-settlement-service/reconciliation/**`, `tests/unit/risk/**`, `tests/integration/risk/**` | Stage B | PnL accounting evidence, exposure-limit tests, risk-breaker simulation logs | DONE | Stage B task. Hard block on any live routing until this is DONE and promoted. |
| PM-C-001 | Worker 3 (DFlow Prediction Execution) | PM-B-001, PM-B-002, PM-A-006 | `services/execution-orchestrator/adapters/dflow/**`, `infra/**`, `docs/runbooks/**` | Stage C | Guarded-live dry-run logs, risk-cap enforcement evidence, operator approval trail | DONE | Guarded live DFlow only after Stage B passes. |
| PM-C-002 | Worker 4 (Gemini Prediction Execution) | PM-B-001, PM-B-002, PM-A-006 | `services/execution-orchestrator/adapters/gemini/**`, `infra/**`, `docs/runbooks/**` | Stage C | Guarded-live dry-run logs, risk-cap enforcement evidence, operator approval trail | DONE | Guarded live Gemini path implemented with guarded-only execution, approval trail, and evidence script/runbook. |
| PM-D-001 | Worker 5 (PNP Execution Hardening) | PM-C-001, PM-C-002, PROMOTION-GATE | `services/execution-orchestrator/adapters/pnp/**`, `services/position-settlement-service/adapters/pnp/**`, `infra/**`, `docs/runbooks/**` | Stage D | Promotion-gate evidence bundle (7d paper, 3d live, positive realized PnL, zero critical breaches) | BLOCKED | Hard gate: no PNP live until promotion gate evidence is accepted by Master. BLOCKED on `PROMOTION-GATE`. |

## Stage-Gate Tracker

- Stage A: `DONE`
- Stage B: `DONE`
- Stage C: `DONE`
- Stage D: `LOCKED` (unlocks only after Stage C DONE and promotion gate satisfied: 7d paper, 3d guarded live, positive realized PnL, zero critical breaches)

## Master Quality Gate Checklist (per task before DONE)

- Scope compliance: pass/fail
- Dependency compliance: pass/fail
- Test evidence: pass/fail
- Stage-gate compliance: pass/fail
- Risk policy compliance: pass/fail
- Observability evidence (if applicable): pass/fail

If any check fails, task returns to worker with remediation checklist and status `IN_PROGRESS`.
