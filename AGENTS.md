# AGENTS.md

Status: Active
Last Updated: April 21, 2026 (America/Indiana/Indianapolis)
Canonical PRD: [`PRD.md`](./PRD.md)

## 1. Purpose

Define a conflict-free multi-agent build plan for the Solana Cross-Market Opportunity Engine.

This document sets:
- exact agent responsibilities,
- file and directory ownership,
- shared contracts,
- merge and handoff protocol,
- quality gates per agent.

## 2. Canonical Inputs

All agents must align to:
- [`PRD.md`](./PRD.md)
- Skill set and references captured in PRD Section 25

Archived drafts for reference only:
- [`PRD1.md`](./PRD1.md)
- [`RPD2.md`](./RPD2.md)

## 3. Global Collaboration Rules

- One canonical branch policy: trunk-based with short-lived feature branches.
- No agent edits files outside owned write scope.
- Cross-scope changes require owner approval in writing in task log.
- Shared contracts are source of truth; adapters must conform.
- No secrets in repo, logs, fixtures, or test snapshots.
- All externally sourced constants (program IDs, URLs) must be centralized.

## 4. Planned Repository Layout

Agents should create and use this layout.

- `services/ingestion-gateway/`
- `services/state-normalizer/`
- `services/opportunity-engine/`
- `services/risk-engine/`
- `services/execution-orchestrator/`
- `services/position-settlement-service/`
- `services/control-plane-api/`
- `apps/frontend-console/`
- `programs/policy-guard/`
- `packages/contracts/`
- `packages/shared-types/`
- `packages/config/`
- `infra/`
- `tests/unit/`
- `tests/integration/`
- `tests/smoke/`
- `docs/runbooks/`

## 5. Shared Contract Files (Cross-Agent, Read-Only Except Owner)

These files are shared boundaries and must be stable.

- `packages/contracts/events.ts`
- `packages/contracts/market-schema.ts`
- `packages/contracts/opportunity-schema.ts`
- `packages/contracts/execution-schema.ts`
- `packages/contracts/risk-schema.ts`
- `packages/contracts/api-spec.yaml`

Owner for all shared contracts: Agent 1.

## 6. Agent Topology and Ownership

### Agent 1: Architecture and Contracts

Primary mission:
- Define domain models, event schemas, API surface, and config model.

Write scope:
- `packages/contracts/**`
- `packages/shared-types/**`
- `packages/config/**`
- `docs/architecture/**`

Must deliver:
- Versioned schemas for market, opportunity, execution, risk.
- Error taxonomy and retry semantics.
- Compatibility matrix for Kit <> web3 adapters.

Hard constraints:
- No protocol-specific execution logic.

### Agent 2: Data Connectors (CoinGecko, Pyth, Helius)

Primary mission:
- Build resilient ingestion adapters and normalization input feeds.

Write scope:
- `services/ingestion-gateway/**`
- `services/state-normalizer/**`
- `tests/unit/ingestion/**`
- `tests/integration/ingestion/**`

Must deliver:
- Connectors for CoinGecko, Pyth Hermes, Helius streams.
- Freshness, confidence, and rate-limit handling.
- Canonical timestamp and decimal normalization.

Hard constraints:
- No strategy scoring logic.
- No order execution code.

### Agent 3: DFlow Adapter and Execution Path

Primary mission:
- Implement DFlow trading integration and lifecycle tracking.

Write scope:
- `services/execution-orchestrator/adapters/dflow/**`
- `tests/unit/dflow/**`
- `tests/integration/dflow/**`

Must deliver:
- `GET /order`, `GET /order-status`, `GET /quote`, `POST /swap` flows.
- Sync and async execution mode handling.
- Idempotent submission and terminal-state tracking.

Hard constraints:
- Must consume Agent 1 contracts unchanged.

### Agent 4: PNP Adapter and Settlement Lifecycle

Primary mission:
- Implement PNP market/trading/settlement path.

Write scope:
- `services/execution-orchestrator/adapters/pnp/**`
- `services/position-settlement-service/adapters/pnp/**`
- `tests/unit/pnp/**`
- `tests/integration/pnp/**`

Must deliver:
- Discovery, pricing, buy/sell, settlement, redemption support.
- V2 baseline and V3 feature flag scaffolding.
- Guardrail for 15-minute `setMarketResolvable` custom-oracle constraint.

Hard constraints:
- No independent risk policy framework.

### Agent 5: Opportunity Engine and Strategy Scoring

Primary mission:
- Build deterministic scoring and candidate generation.

Write scope:
- `services/opportunity-engine/**`
- `tests/unit/opportunity/**`
- `tests/integration/opportunity/**`

Must deliver:
- `edge_net` scoring implementation.
- Strategy modes (conservative/balanced/aggressive).
- Deterministic tie-break and ranking semantics.

Hard constraints:
- No transaction submission logic.

### Agent 6: Risk Engine and Reconciliation

Primary mission:
- Enforce hard/soft limits, circuit breakers, and post-trade reconciliation.

Write scope:
- `services/risk-engine/**`
- `services/position-settlement-service/reconciliation/**`
- `tests/unit/risk/**`
- `tests/integration/risk/**`

Must deliver:
- Pre-trade hard checks and adaptive controls.
- Kill-switch triggers and resume protocol.
- Reconciliation mismatch detection and handling.

Hard constraints:
- No direct UI logic.

### Agent 7: Frontend, Wallet UX, and Commerce

Primary mission:
- Build operator console and wallet/payment UX surfaces.

Write scope:
- `apps/frontend-console/**`
- `services/control-plane-api/**`
- `tests/unit/frontend/**`
- `tests/integration/frontend/**`

Must deliver:
- Dashboard views from PRD.
- Phantom wallet connect/sign flows.
- Commerce hooks with settlement verification path.

Hard constraints:
- Must not bypass control-plane authorization checks.

### Agent 8: QA/SRE/Infra and Release Automation

Primary mission:
- Own CI quality gates, observability, deployment and runbooks.

Write scope:
- `infra/**`
- `.github/workflows/**`
- `tests/smoke/**`
- `docs/runbooks/**`

Must deliver:
- CI pipeline for unit/integration/smoke.
- Metrics/logging/tracing bootstrap.
- Alert policies and rollback automation criteria.

Hard constraints:
- No business logic edits in service modules.

## 7. Conflict-Free File Ownership Matrix

| Path | Owner Agent | Allowed Readers | Notes |
|---|---|---|---|
| `packages/contracts/**` | 1 | All | Shared boundary, versioned only |
| `services/ingestion-gateway/**` | 2 | All | Data source adapters |
| `services/state-normalizer/**` | 2 | All | Canonical normalization |
| `services/execution-orchestrator/adapters/dflow/**` | 3 | All | DFlow only |
| `services/execution-orchestrator/adapters/pnp/**` | 4 | All | PNP only |
| `services/opportunity-engine/**` | 5 | All | Scoring and ranking |
| `services/risk-engine/**` | 6 | All | Hard/soft limits |
| `services/position-settlement-service/reconciliation/**` | 6 | All | Reconciliation owner |
| `apps/frontend-console/**` | 7 | All | UI and wallet flows |
| `services/control-plane-api/**` | 7 | All | Operator APIs |
| `infra/**` | 8 | All | Deploy and runtime ops |
| `.github/workflows/**` | 8 | All | CI/CD |
| `tests/smoke/**` | 8 | All | Environment smoke checks |

## 8. Integration Contracts and Handoffs

All runtime handoffs must use Agent 1 contract definitions.

Required events:
- `market_data_updated`
- `opportunity_computed`
- `risk_decision_emitted`
- `execution_intent_dispatched`
- `execution_terminal_state`
- `position_reconciled`
- `circuit_breaker_triggered`

Required IDs in every event:
- `event_id`
- `intent_id` where applicable
- `trace_id`
- `source_service`
- `created_at_ms`

## 9. Delivery Waves and Dependencies

### Wave A: Foundation

Owners:
- Agent 1, Agent 8

Outputs:
- contracts, shared types, CI skeleton, environment baselines

### Wave B: Data and Scoring

Owners:
- Agent 2, Agent 5

Dependency:
- Agent 1 contracts must be tagged `v0.1.0`

### Wave C: Execution and Risk

Owners:
- Agent 3, Agent 4, Agent 6

Dependency:
- Wave B event contracts stable

### Wave D: Control Plane and UX

Owners:
- Agent 7

Dependency:
- risk and execution APIs exposed by Waves B/C

### Wave E: Hardening and Launch

Owners:
- Agent 8 with support from all agents

Outputs:
- smoke tests, runbooks, alerts, rollback drill

## 10. Quality Gates Per Agent

Each agent must pass:
- unit tests in owned scope,
- contract compatibility tests against `packages/contracts`,
- lint and type checks,
- no-secret scan,
- ownership check (no unauthorized path edits).

## 11. Merge Protocol

- PR title prefix: `[A<agent-number>] <summary>`.
- Every PR must include:
- scope paths,
- contract impact (`none` or schema change),
- test evidence,
- rollback note.
- Schema changes require Agent 1 approval.
- CI/workflow changes require Agent 8 approval.

## 12. Incident and Escalation Rules

- Critical execution/risk defects: Agent 6 primary responder.
- Provider outage issues: Agent 2 primary responder.
- Deployment or observability outages: Agent 8 primary responder.
- UI or control-plane incident: Agent 7 primary responder.

All sev-1 incidents require:
- immediate kill-switch evaluation,
- incident ticket creation,
- postmortem in `docs/runbooks/incidents/`.

## 13. Done Criteria for Multi-Agent Milestone 1

Milestone 1 is complete when:
1. Ingestion, scoring, risk, and execution services exchange contract-valid events end-to-end.
2. DFlow and PNP integration tests pass in staging mode.
3. Dashboard shows live intents, execution states, exposure, and kill-switch control.
4. Reconciliation job reports zero unresolved drift in test replay.
5. Smoke suite and rollback drill both pass.

## 14. Change Control for This Document

- `AGENTS.md` owner: Agent 1 (Architecture) and Agent 8 (Delivery Ops) jointly.
- Update policy: PR required, with changelog section at bottom.

## 15. Changelog

- 2026-04-21: Initial version created from PRD Section 23 and expanded with explicit path ownership and handoff protocol.
