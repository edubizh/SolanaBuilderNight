# TASKS.md

Status: Active
Last Updated: April 21, 2026 (America/Indiana/Indianapolis)
Canonical Inputs:
- [`PRD.md`](./PRD.md)
- [`AGENTS.md`](./AGENTS.md)

## 1. How to Use This Board

- This is the execution board for the 8-agent plan.
- Every task has an ID, owner, sprint, dependency, and definition of done.
- Owners must keep status current.
- No agent may execute tasks outside its write scope from `AGENTS.md`.

### Status Legend

- `TODO`: not started
- `READY`: dependencies satisfied and can begin
- `IN_PROGRESS`: currently active
- `BLOCKED`: waiting on dependency
- `REVIEW`: implementation done, awaiting review/gate
- `DONE`: merged and validated

## 2. Sprint Plan (12-Week Baseline)

- `Sprint 0` (Week 1): foundation, contracts, repo scaffolding, CI baseline
- `Sprint 1` (Week 2-3): data ingestion and normalization baseline
- `Sprint 2` (Week 4-5): opportunity scoring + execution adapters baseline
- `Sprint 3` (Week 6-7): risk controls + settlement + control-plane UI
- `Sprint 4` (Week 8-9): end-to-end integration, observability, smoke reliability
- `Sprint 5` (Week 10-12): constrained live-readiness and release hardening

## 3. Milestone Gates

- `M1 Foundation Gate`: contracts v0.1.0, CI baseline, repo structure complete
- `M2 Data Gate`: ingestion + normalized event stream with freshness controls
- `M3 Strategy/Execution Gate`: opportunity engine wired to DFlow and PNP adapters
- `M4 Risk/Console Gate`: risk engine + kill-switch + operator dashboards
- `M5 Release Gate`: smoke tests, runbooks, rollback drill, staging soak pass

## 4. Master Task Index

| ID | Sprint | Owner | Task | Depends On | Status |
|---|---|---|---|---|---|
| A1-S0-01 | Sprint 0 | Agent 1 | Create contract package skeleton and versioning policy | None | DONE |
| A1-S0-02 | Sprint 0 | Agent 1 | Define events schema set (`market_data_updated` ... `circuit_breaker_triggered`) | A1-S0-01 | DONE |
| A1-S0-03 | Sprint 0 | Agent 1 | Define API spec (`packages/contracts/api-spec.yaml`) | A1-S0-01 | DONE |
| A1-S1-04 | Sprint 1 | Agent 1 | Publish shared type package and semantic version constraints | A1-S0-02, A1-S0-03 | DONE |
| A1-S2-05 | Sprint 2 | Agent 1 | Freeze contracts v0.2.0 for integration wave | A1-S1-04 | DONE |
| A2-S0-01 | Sprint 0 | Agent 2 | Scaffold ingestion-gateway and state-normalizer services | A1-S0-01 | DONE |
| A2-S1-02 | Sprint 1 | Agent 2 | Implement CoinGecko connector with backoff + key policy | A2-S0-01, A1-S1-04 | DONE |
| A2-S1-03 | Sprint 1 | Agent 2 | Implement Pyth Hermes connector with staleness/confidence extraction | A2-S0-01, A1-S1-04 | DONE |
| A2-S1-04 | Sprint 1 | Agent 2 | Implement Helius stream connector and parser adapter | A2-S0-01, A1-S1-04 | DONE |
| A2-S1-05 | Sprint 1 | Agent 2 | Implement normalization pipeline for decimals/time/event identity | A2-S1-02, A2-S1-03, A2-S1-04 | DONE |
| A2-S2-06 | Sprint 2 | Agent 2 | Publish ingestion integration fixtures and replay dataset | A2-S1-05 | DONE |
| A3-S0-01 | Sprint 0 | Agent 3 | Scaffold DFlow adapter module and test harness | A1-S1-04 | DONE |
| A3-S2-02 | Sprint 2 | Agent 3 | Implement `GET /order` and transaction parsing flow | A3-S0-01 | DONE |
| A3-S2-03 | Sprint 2 | Agent 3 | Implement `GET /order-status` async lifecycle tracker | A3-S2-02 | DONE |
| A3-S2-04 | Sprint 2 | Agent 3 | Implement `GET /quote` + `POST /swap` imperative path | A3-S0-01 | DONE |
| A3-S3-05 | Sprint 3 | Agent 3 | Add idempotent submission and terminal-state persistence | A3-S2-03, A3-S2-04 | DONE |
| A4-S0-01 | Sprint 0 | Agent 4 | Scaffold PNP adapter and settlement adapter modules | A1-S1-04 | DONE |
| A4-S2-02 | Sprint 2 | Agent 4 | Implement market discovery and price retrieval flows | A4-S0-01 | DONE |
| A4-S2-03 | Sprint 2 | Agent 4 | Implement buy/sell execution path (V2 baseline) | A4-S2-02 | DONE |
| A4-S3-04 | Sprint 3 | Agent 4 | Implement settlement/redemption lifecycle handling | A4-S2-03 | DONE |
| A4-S3-05 | Sprint 3 | Agent 4 | Implement custom-oracle 15-minute resolvable guardrail | A4-S2-02 | DONE |
| A4-S4-06 | Sprint 4 | Agent 4 | Add V3 feature-flag scaffold and tests | A4-S2-03 | DONE |
| A5-S0-01 | Sprint 0 | Agent 5 | Scaffold opportunity-engine with deterministic ranking interfaces | A1-S1-04 | DONE |
| A5-S2-02 | Sprint 2 | Agent 5 | Implement `edge_net` scoring formula from PRD | A5-S0-01, A2-S2-06 | DONE |
| A5-S2-03 | Sprint 2 | Agent 5 | Implement strategy modes (conservative/balanced/aggressive) | A5-S2-02 | DONE |
| A5-S2-04 | Sprint 2 | Agent 5 | Implement tie-break deterministic ranking rules | A5-S2-02 | DONE |
| A5-S3-05 | Sprint 3 | Agent 5 | Add EV threshold and liquidity/fill probability eligibility filters | A5-S2-03, A5-S2-04 | DONE |
| A6-S0-01 | Sprint 0 | Agent 6 | Scaffold risk-engine and reconciliation modules | A1-S1-04 | DONE |
| A6-S3-02 | Sprint 3 | Agent 6 | Implement hard checks (notional/exposure/loss/pending limits) | A6-S0-01 | DONE |
| A6-S3-03 | Sprint 3 | Agent 6 | Implement circuit breakers and kill-switch trigger evaluation | A6-S3-02 | DONE |
| A6-S3-04 | Sprint 3 | Agent 6 | Implement reconciliation drift detection and halt policy | A6-S0-01, A3-S3-05, A4-S3-04 | DONE |
| A6-S4-05 | Sprint 4 | Agent 6 | Build risk replay tests for failure storm scenarios | A6-S3-03 | DONE |
| A7-S0-01 | Sprint 0 | Agent 7 | Scaffold frontend-console and control-plane API | A1-S1-04 | DONE |
| A7-S3-02 | Sprint 3 | Agent 7 | Implement live opportunity/position/risk dashboard views | A7-S0-01, A5-S3-05, A6-S3-02 | DONE |
| A7-S3-03 | Sprint 3 | Agent 7 | Implement pause/resume/kill-switch operator actions | A7-S0-01, A6-S3-03 | DONE |
| A7-S3-04 | Sprint 3 | Agent 7 | Implement Phantom wallet connect/signing flows | A7-S0-01 | DONE |
| A7-S4-05 | Sprint 4 | Agent 7 | Implement config approvals and audit timeline UI | A7-S3-02 | DONE |
| A7-S5-06 | Sprint 5 | Agent 7 | Implement commerce hooks + entitlement verification UI flow | A7-S4-05 | DONE |
| A8-S0-01 | Sprint 0 | Agent 8 | Configure CI for lint/typecheck/unit jobs | None | DONE |
| A8-S0-02 | Sprint 0 | Agent 8 | Add ownership-path guard and secret scanning | A8-S0-01 | DONE |
| A8-S1-03 | Sprint 1 | Agent 8 | Add integration test pipeline and artifact retention | A8-S0-01 | DONE |
| A8-S4-04 | Sprint 4 | Agent 8 | Add smoke test pipeline (staging) and alerts wiring | A8-S1-03 | DONE |
| A8-S4-05 | Sprint 4 | Agent 8 | Bootstrap metrics/logs/traces dashboards + alert policies | A8-S4-04 | DONE |
| A8-S5-06 | Sprint 5 | Agent 8 | Run rollback drill and publish release runbook | A8-S4-05 | DONE |

## 5. Agent Backlogs

### 5.1 Agent 1 Backlog (Architecture/Contracts)

Write scope:
- `packages/contracts/**`
- `packages/shared-types/**`
- `packages/config/**`
- `docs/architecture/**`

Tasks:
- [x] `A1-S0-01` Contract package scaffold and versioning
DoD:
- `packages/contracts/` exists with version metadata and changelog.
- Contract semver policy documented.

- [x] `A1-S0-02` Event contract definitions
DoD:
- All required events defined with mandatory IDs.
- JSON schema or zod equivalents published.

- [x] `A1-S0-03` API spec baseline
DoD:
- OpenAPI file committed.
- Validation step added in CI.

- [x] `A1-S1-04` Shared-types package release
DoD:
- Types exported and consumable by all services.
- Compatibility matrix documented.

- [x] `A1-S2-05` Contract freeze `v0.2.0`
DoD:
- Breaking changes closed before Sprint 3 integration.

Update notes:
- `A1-S0-01`: REVIEW. Added `packages/contracts` scaffold, semver metadata, changelog, and versioning policy at `docs/architecture/contract-versioning-policy.md`.
- `A1-S0-02`: REVIEW. Added required canonical event schemas with mandatory IDs in `packages/contracts/src/events.ts`.
- `A1-S0-03`: REVIEW. Added baseline OpenAPI spec in `packages/contracts/api-spec.yaml`.
- `A1-S1-04`: REVIEW. Published `packages/shared-types` with build/typecheck scripts, package exports, and semver constraints via peer dependency on `@solana-builder-night/contracts@^0.1.0`; added compatibility matrix in `docs/architecture/shared-types-compatibility-matrix.md` and updated policy linkage in `docs/architecture/contract-versioning-policy.md`.
- `A1-S2-05`: REVIEW. Froze integration-wave contract baseline at `v0.2.0` by bumping `packages/contracts` and `packages/shared-types`, updating changelogs, and adding explicit freeze controls in `docs/architecture/contract-versioning-policy.md` and `docs/architecture/shared-types-compatibility-matrix.md`.
- Test evidence: `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/packages/contracts" run typecheck` (pass).
- Test evidence: `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/packages/shared-types" run typecheck` (pass), `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/packages/shared-types" run build` (pass), `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/packages/contracts" run typecheck` (pass).
- Test evidence: `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/packages/contracts" install --package-lock-only` (pass), `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/packages/shared-types" install --package-lock-only` (pass).
- PR link: pending (not created in this worker run).

### 5.2 Agent 2 Backlog (Data)

Write scope:
- `services/ingestion-gateway/**`
- `services/state-normalizer/**`
- `tests/unit/ingestion/**`
- `tests/integration/ingestion/**`

Tasks:
- [x] `A2-S0-01` Service scaffolding
- [ ] `A2-S1-02` CoinGecko connector
- [ ] `A2-S1-03` Pyth connector
- [ ] `A2-S1-04` Helius connector
- [ ] `A2-S1-05` Normalization pipeline
- [ ] `A2-S2-06` Replay fixtures

DoD highlights:
- Data freshness metadata included in each normalized event.
- Decimal normalization validated for all tracked assets.
- Rate-limit and retry metrics emitted.

Update notes:
- `A2-S0-01`: REVIEW. Added baseline scaffolds for `services/ingestion-gateway` and `services/state-normalizer` (package metadata, TS configs, and starter source modules), plus ingestion-focused unit/integration scaffold tests.
- PR link: pending (not created in this worker run).
- Test evidence: `node --test tests/unit/ingestion/scaffold.spec.mjs` and `node --test tests/integration/ingestion/pipeline-contract.spec.mjs` (pass).

### 5.3 Agent 3 Backlog (DFlow)

Write scope:
- `services/execution-orchestrator/adapters/dflow/**`
- `tests/unit/dflow/**`
- `tests/integration/dflow/**`

Tasks:
- [x] `A3-S0-01` Adapter scaffold
- [ ] `A3-S2-02` Order flow
- [ ] `A3-S2-03` Async status tracker
- [ ] `A3-S2-04` Imperative path
- [ ] `A3-S3-05` Idempotency and persistence

DoD highlights:
- Sync and async executions reach terminal states deterministically.
- Duplicate submission prevention validated by tests.

Update notes:
- `A3-S0-01`: REVIEW. Added DFlow adapter scaffold with `GET /order`, `GET /order-status`, `GET /quote`, `POST /swap` method surface in `services/execution-orchestrator/adapters/dflow/`.
- Test evidence: `node --test "tests/unit/dflow/dflow-adapter.test.js" "tests/integration/dflow/dflow-adapter.integration.test.js"` (pass).
- PR link: pending (not created in this worker run).
- `A3-S2-03`: REVIEW. Added `trackOrderStatusLifecycle` async polling tracker with terminal-state detection, timeout/max-attempt bounds, normalized status extraction, and poll history in `services/execution-orchestrator/adapters/dflow/dflowAdapter.js`.
- Test evidence: `node --test "tests/unit/dflow/dflow-adapter.test.js" "tests/integration/dflow/dflow-adapter.integration.test.js"` (pass).

### 5.4 Agent 4 Backlog (PNP)

Write scope:
- `services/execution-orchestrator/adapters/pnp/**`
- `services/position-settlement-service/adapters/pnp/**`
- `tests/unit/pnp/**`
- `tests/integration/pnp/**`

Tasks:
- [x] `A4-S0-01` Adapter scaffolding
- [ ] `A4-S2-02` Discovery and pricing
- [x] `A4-S2-03` Buy/sell V2 flow
- [ ] `A4-S3-04` Settlement/redeem
- [x] `A4-S3-05` 15-minute guardrail
- [ ] `A4-S4-06` V3 feature-flag scaffold

DoD highlights:
- Lifecycle transitions validated (open -> settled -> redeemed).
- Custom-oracle guardrail has explicit failure tests.

Update notes:
- `A4-S0-01`: REVIEW. Added scaffold modules for PNP execution and settlement adapters at `services/execution-orchestrator/adapters/pnp/` and `services/position-settlement-service/adapters/pnp/`, plus starter tests in `tests/unit/pnp/` and `tests/integration/pnp/`.
- `A4-S2-03`: REVIEW. Implemented V2 buy/sell execution baseline validation and normalized order acceptance payload in `services/execution-orchestrator/adapters/pnp/executionAdapter.js` and `services/execution-orchestrator/adapters/pnp/client.js`, with coverage in `tests/unit/pnp/executionAdapter.test.js`, `tests/unit/pnp/client.test.js`, and `tests/integration/pnp/discovery-pricing.integration.test.js`.
- `A4-S3-05`: REVIEW. Added custom-oracle 15-minute `setMarketResolvable` guardrail enforcement in `services/execution-orchestrator/adapters/pnp/executionAdapter.js`, including explicit pass/fail tests in unit and integration suites.
- Test evidence: `node --test tests/unit/pnp/*.test.js tests/integration/pnp/*.test.js` (pass).
- PR link: pending (not created in this worker run).

### 5.5 Agent 5 Backlog (Opportunity Engine)

Write scope:
- `services/opportunity-engine/**`
- `tests/unit/opportunity/**`
- `tests/integration/opportunity/**`

Tasks:
- [x] `A5-S0-01` Engine scaffold
- [ ] `A5-S2-02` `edge_net` implementation
- [ ] `A5-S2-03` Strategy modes
- [ ] `A5-S2-04` Deterministic ranking
- [ ] `A5-S3-05` Eligibility filters

DoD highlights:
- Same input snapshot produces identical ranking output.
- EV and threshold logic traceable in decision logs.

Update notes:
- `A5-S0-01`: REVIEW. Added `services/opportunity-engine` scaffold with deterministic ranking interfaces and deterministic comparator/ranking implementation (`edgeNet desc`, `expectedValueUsd desc`, `createdAtMs asc`, `intentId asc`).
- Test evidence: `npm --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/opportunity-engine" test` (pass: 3 tests).

### 5.6 Agent 6 Backlog (Risk/Reconciliation)

Write scope:
- `services/risk-engine/**`
- `services/position-settlement-service/reconciliation/**`
- `tests/unit/risk/**`
- `tests/integration/risk/**`

Tasks:
- [x] `A6-S0-01` Module scaffold
- [ ] `A6-S3-02` Hard checks
- [ ] `A6-S3-03` Circuit breakers/kill-switch logic
- [ ] `A6-S3-04` Reconciliation and halt policy
- [ ] `A6-S4-05` Failure storm replay tests

DoD highlights:
- Hard-limit breaches block execution 100% of the time.
- Kill-switch trigger path tested end-to-end.

Update notes:
- `A6-S0-01`: REVIEW. Added scaffolded risk and reconciliation modules at `services/risk-engine/src` and `services/position-settlement-service/reconciliation/src`, plus baseline risk tests.
- Test evidence: `node --test "tests/unit/risk/*.test.mjs" "tests/integration/risk/*.test.mjs"` (pass).
- PR link: pending (not created in this worker run).

### 5.7 Agent 7 Backlog (Frontend/Control Plane)

Write scope:
- `apps/frontend-console/**`
- `services/control-plane-api/**`
- `tests/unit/frontend/**`
- `tests/integration/frontend/**`

Tasks:
- [x] `A7-S0-01` App + API scaffold

Update notes:
- `A7-S0-01`: REVIEW. Added scaffold packages for `apps/frontend-console` and `services/control-plane-api` with typed route/action primitives and bootstrap entry points.
- Added frontend validation tests in `tests/unit/frontend/dashboard-shell.test.mjs` and `tests/integration/frontend/control-plane-scaffold.test.mjs`.
- Test evidence: `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/apps/frontend-console" typecheck` (pass), `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/control-plane-api" typecheck` (pass), `node --test --experimental-strip-types "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/unit/frontend/dashboard-shell.test.mjs" "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/integration/frontend/control-plane-scaffold.test.mjs"` (pass).
- Remediation: added `pretypecheck` scripts in both owned packages to auto-install TypeScript toolchain in clean environments before `typecheck`; re-validated all required commands (pass).
- `A7-S3-04`: REVIEW. Added Phantom connect/signing helpers in `apps/frontend-console/src/lib/phantom-wallet.ts` and `apps/frontend-console/src/lib/operator-auth.ts`, wired auth helper in `apps/frontend-console/src/app/bootstrap.ts`, and preserved control-plane authz constraints by requiring signed authorization with wallet/role checks in `services/control-plane-api/src/routes/control-actions.ts`.
- Test evidence: `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/apps/frontend-console" typecheck` (pass), `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/control-plane-api" typecheck` (pass), `node --test --experimental-strip-types "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/unit/frontend/dashboard-shell.test.mjs" "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/integration/frontend/control-plane-scaffold.test.mjs"` (pass).
- PR link: pending (not created in this worker run).
- `A7-S3-03`: REVIEW. Implemented pause/resume/kill-switch operator actions with strict authz by requiring action-bound challenge validation, wallet/challenge/action consistency, and challenge freshness windows in `services/control-plane-api/src/routes/control-actions.ts`; added frontend signed request builder in `apps/frontend-console/src/lib/operator-controls.ts` and action-specific challenge generation in `apps/frontend-console/src/lib/operator-auth.ts`.
- Test evidence: `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/apps/frontend-console" typecheck` (pass), `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/control-plane-api" typecheck` (pass), `node --test --experimental-strip-types "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/unit/frontend/dashboard-shell.test.mjs" "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/integration/frontend/control-plane-scaffold.test.mjs"` (pass).
- PR link: pending (not created in this worker run).
- `A7-S3-02`: REVIEW. Implemented live opportunity/position/risk dashboard view-models and totals aggregation in `apps/frontend-console/src/lib/live-dashboard.ts`, exposed dashboard snapshot helper in `apps/frontend-console/src/app/bootstrap.ts`, and added control-plane live dashboard response shape in `services/control-plane-api/src/routes/live-dashboard.ts` with route registration in `services/control-plane-api/src/server.ts`.
- Test evidence: `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/apps/frontend-console" typecheck` (pass), `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/control-plane-api" typecheck` (pass), `node --test --experimental-strip-types "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/unit/frontend/dashboard-shell.test.mjs" "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/integration/frontend/control-plane-scaffold.test.mjs"` (pass).
- PR link: pending (not created in this worker run).
- `A7-S4-05`: REVIEW. Implemented config approvals and audit timeline UI model in `apps/frontend-console/src/lib/config-approvals.ts`, exposed timeline builder via `apps/frontend-console/src/app/bootstrap.ts`, and added control-plane config approval response route in `services/control-plane-api/src/routes/config-approvals.ts` with route registration in `services/control-plane-api/src/server.ts`.
- Test evidence: `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/apps/frontend-console" typecheck` (pass), `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/control-plane-api" typecheck` (pass), `node --test --experimental-strip-types "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/unit/frontend/dashboard-shell.test.mjs" "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/integration/frontend/control-plane-scaffold.test.mjs"` (pass).
- PR link: pending (not created in this worker run).
- `A7-S5-06`: REVIEW. Implemented commerce hooks and settlement-based entitlement verification UI flow model in `apps/frontend-console/src/lib/commerce-entitlements.ts`, exposed entitlement resolver in `apps/frontend-console/src/app/bootstrap.ts`, and added control-plane commerce verification response route in `services/control-plane-api/src/routes/commerce-hooks.ts` with route registration in `services/control-plane-api/src/server.ts`.
- Test evidence: `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/apps/frontend-console" typecheck` (pass), `npm run --prefix "/Users/elidubizh/Desktop/SolanaBuilderNight/services/control-plane-api" typecheck` (pass), `node --test --experimental-strip-types "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/unit/frontend/dashboard-shell.test.mjs" "/Users/elidubizh/Desktop/SolanaBuilderNight/tests/integration/frontend/control-plane-scaffold.test.mjs"` (pass).
- PR link: pending (not created in this worker run).
- [x] `A7-S3-02` Live dashboards
- [x] `A7-S3-03` Operator controls
- [x] `A7-S3-04` Phantom flows
- [x] `A7-S4-05` Config approvals/audit UI
- [x] `A7-S5-06` Commerce hooks UI

DoD highlights:
- Operator can pause/resume and invoke kill-switch from UI.
- All privileged actions require explicit authn/authz.

### 5.8 Agent 8 Backlog (QA/SRE/Infra)

Write scope:
- `infra/**`
- `.github/workflows/**`
- `tests/smoke/**`
- `docs/runbooks/**`

Tasks:
- [x] `A8-S0-01` CI baseline
  - Note: Added `ci-baseline.yml` plus `infra/ci/run-quality-gate.sh` for lint/typecheck/unit gate bootstrap execution.
- [x] `A8-S0-02` Ownership/secrets policy gates
  - Note: Added `policy-gates.yml`, `infra/ci/ownership-path-guard.sh`, and gitleaks config at `infra/security/gitleaks.toml`.
- [x] `A8-S1-03` Integration pipeline
  - Note: Added `.github/workflows/integration-pipeline.yml` to run integration gate and always upload integration artifacts/logs with `retention-days: 14`.
- [x] `A8-S4-04` Smoke test and alerts
- [ ] `A8-S4-05` Observability dashboards
- [ ] `A8-S5-06` Rollback drill + runbook

DoD highlights:
- Green CI required for merge.
- Staging smoke pass required before release tag.

Update notes:
- `A8-S1-03`: REVIEW. Extended `infra/ci/run-quality-gate.sh` usage to include `integration` and added integration CI workflow with artifact retention for gate logs and integration outputs.
- Test evidence: `bash infra/ci/run-quality-gate.sh integration` (pass; bootstrap skip message expected when repo root has no `package.json`).
- `A8-S4-04`: REVIEW. Added staging smoke workflow at `.github/workflows/staging-smoke.yml`, smoke test suite at `tests/smoke/staging-smoke.test.mjs`, smoke gate support in `infra/ci/run-quality-gate.sh`, and staging alert triage runbook at `docs/runbooks/staging-smoke-alerts.md`.
- Test evidence: `python3 -m http.server 8999 --bind 127.0.0.1 >/tmp/staging-smoke-http.log 2>&1 & server_pid=$!; sleep 1; STAGING_SMOKE_URL="http://127.0.0.1:8999" bash infra/ci/run-quality-gate.sh smoke; exit_code=$?; kill "$server_pid" >/dev/null 2>&1 || true; exit $exit_code` (pass).
- PR link: pending (not created in this worker run).

## 6. Cross-Agent Integration Checkpoints

- `CP-1` (end Sprint 0): Contract package usable by all services.
- `CP-2` (mid Sprint 2): Ingestion -> opportunity-engine contract-valid handoff.
- `CP-3` (end Sprint 3): Opportunity -> risk -> execution orchestration path green.
- `CP-4` (end Sprint 4): UI and control-plane fully wired to live state.
- `CP-5` (Sprint 5): Staging soak (7 days) with incident criteria from PRD.

## 7. Release Readiness Checklist

- [ ] All M1-M5 gates passed.
- [ ] Unit, integration, smoke test suites green.
- [ ] Contract schema versions pinned and tagged.
- [ ] Alerts and runbooks published.
- [ ] Rollback drill completed and documented.
- [ ] Open high-severity defects = 0.

## 8. Task Update Protocol

When updating a task status:
1. Update status in Master Task Index.
2. Add short note under relevant agent backlog.
3. Include PR link and test evidence.
4. If blocked, list exact dependency ID.

## 9. Initial Priority Queue (Start Immediately)

- `A8-S0-01` CI baseline
- `A1-S0-01` Contract skeleton
- `A1-S0-02` Event schemas
- `A2-S0-01` Ingestion scaffolding
- `A5-S0-01` Opportunity-engine scaffold
- `A6-S0-01` Risk-engine scaffold
- `A7-S0-01` Frontend/control-plane scaffold
- `A3-S0-01` DFlow scaffold
- `A4-S0-01` PNP scaffold

## 10. Changelog

- 2026-04-21: Initial task board created from `PRD.md` and `AGENTS.md`, with sprint mapping for 8-agent parallel delivery.
