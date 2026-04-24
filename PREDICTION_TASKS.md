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
| PM-D-001 | Worker 5 (PNP Execution Hardening) | PM-C-001, PM-C-002, PROMOTION-GATE | `services/execution-orchestrator/adapters/pnp/**`, `services/position-settlement-service/adapters/pnp/**`, `infra/**`, `docs/runbooks/**` | Stage D | Promotion-gate evidence bundle (7d paper, 3d live, positive realized PnL, zero critical breaches) | BLOCKED | Latest deterministic gate decision at `2026-04-24T20:55:06.541Z`: `paper_days_completed=7`, `guarded_live_days_completed=3`, `realized_pnl_usd=0`, `critical_risk_breaches=15`, `overall_pass=false`, `failed_criteria=[realized_pnl_positive_requirement,critical_risk_breach_requirement]`. Evidence: `.artifacts/promotion-gate/runtime-pnl-report.json`, `.artifacts/promotion-gate/evaluator-runtime.json`, `infra/task-status/artifacts/promotion-gate/promotion-gate-daily-snapshot-20260424T205506.541Z.json`, `infra/task-status/artifacts/promotion-gate/promotion-gate-daily-summary-20260424T205506.541Z.md`, `infra/task-status/artifacts/readiness/readiness-report-20260424T205506Z.json`, `infra/task-status/artifacts/readiness/readiness-report-20260424T205506Z.md`. Remediation actions: reduce `critical_risk_breaches` to 0 via PM-O-002 classifier output and guarded reliability tuning; improve realized PnL above 0 under conservative constraints. Next evidence run: next UTC daily cycle (`00:05Z`) or immediate on materially new runtime data. |
| PM-G-001 | Worker 7 (Promotion Evaluator Core) | None | `services/control-plane-api/**`, `tests/integration/frontend/**`, `tests/unit/frontend/**` | Promotion Gate | Deterministic evaluator output artifact + strict-wall-clock day-count tests | DONE | STRICT WALL-CLOCK ONLY. Required keys: `as_of_utc`, `paper_days_completed`, `guarded_live_days_completed`, `realized_pnl_usd`, `critical_risk_breaches`, `overall_pass`, `failed_criteria[]`. Deterministic failed_criteria ordering required. |
| PM-G-002 | Worker 8 (Daily Artifact Pipeline + Wiring) | PM-G-001 | `infra/**`, `.github/workflows/**`, `tests/smoke/**`, `docs/runbooks/**` | Promotion Gate | Daily machine JSON + markdown summary artifacts with UTC-stable names and “remaining to unlock” | DONE | Evaluator-wired daily pipeline implemented with contract validation, strict UTC wall-clock checks, scheduled workflow inputs, and deterministic remaining-to-unlock artifacts. |
| PM-G-003 | Worker 7 (Board Enforcement Guard) | PM-G-001 | `services/control-plane-api/**`, `tests/integration/frontend/**`, `tests/unit/frontend/**` | Promotion Gate | Deterministic board transition guard evidence for `PM-D-001` BLOCKED/READY | DONE | Enforced deterministic transition guard: READY only when evaluator `overall_pass=true`; otherwise BLOCKED with exact failed criteria in Notes. |
| PM-G-004 | Worker 8 (Gate Pipeline Validation/Failure Modes) | PM-G-001, PM-G-002, PM-G-003 | `infra/**`, `.github/workflows/**`, `tests/smoke/**`, `docs/runbooks/**` | Promotion Gate | Smoke/integration evidence for pass path + missing-data deterministic failure (non-zero exit) | DONE | Emits explicit blocker reason on missing required input data with deterministic non-zero failure behavior. |
| PM-O-001 | Worker 8 (Infra/Workflow Hardening) | PM-G-004 | `infra/**`, `.github/workflows/**`, `tests/smoke/**`, `docs/runbooks/**` | Ops Hardening | Daily promotion-evidence hardening evidence (retention + diagnostics) | DONE | Operational phase only. No Stage D rollout work. |
| PM-O-002 | Worker 7 (Risk/PnL/Reconciliation) | PM-G-003 | `services/risk-engine/**`, `services/position-settlement-service/reconciliation/**`, `tests/unit/risk/**`, `tests/integration/risk/**` | Ops Hardening | Deterministic critical-breach classifier + top-cause rollup artifact | DONE | Focus on explicit deterministic categories and counts, no risk-limit relaxation. |
| PM-O-003 | Worker 6 (Opportunity Telemetry) | PM-B-001, PM-B-002 | `services/opportunity-engine/**`, `tests/unit/opportunity/**`, `tests/integration/opportunity/**` | Ops Hardening | Deterministic opportunity quality telemetry snapshot artifact | DONE | Must emit accepted/skipped counts by reason + expected-net distributions. |
| PM-O-004 | Worker 3 + Worker 4 (Serialized) | PM-C-001, PM-C-002, PM-O-002, PM-O-003 | `services/execution-orchestrator/adapters/dflow/**`, `tests/unit/dflow/**`, `tests/integration/dflow/**`, `services/execution-orchestrator/adapters/gemini/**`, `tests/unit/gemini/**`, `tests/integration/gemini/**` | Ops Hardening | Guarded-live reliability tuning evidence without policy weakening | DONE | Completed with deterministic retry/timeout envelope tuning and fail-closed guarded submission behavior; no risk-policy relaxation. |
| PM-O-005 | Worker 8 (Unified Readiness Report) | PM-O-001, PM-O-002, PM-O-003, PM-O-004 | `infra/**`, `docs/runbooks/**`, `tests/smoke/**` | Ops Hardening | Unified daily readiness report (machine + markdown) | DONE | Produced deterministic readiness outputs: `infra/task-status/artifacts/readiness/readiness-report-20260424T205506Z.json` and `.md`; fail-closed blocker emission preserved. |
| PM-O-006 | Master (Status Decision) | PM-O-005 | `PREDICTION_TASKS.md` | Promotion Decision | Deterministic PM-D-001 decision log and board update evidence | DONE | Master decision executed from same-run evidence bundle; `PM-D-001` remains `BLOCKED` because `overall_pass=false` with explicit failed criteria recorded. |

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
