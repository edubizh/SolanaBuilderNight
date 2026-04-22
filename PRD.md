# PRD: Solana Cross-Market Opportunity Engine (DFlow + PNP)

Version: 2.0 (Unified)
Date: April 21, 2026 (America/Indiana/Indianapolis)
Status: Build-Lock Candidate
Owner: Product + Engineering

## 1. Executive Summary

Build a production-grade Solana trading platform that detects and executes risk-adjusted opportunities across DFlow and PNP markets using a deterministic, auditable architecture.

The system combines:
- market and chain data (CoinGecko, Pyth, Helius, DFlow, PNP),
- strategy and risk engines with hard limits,
- low-latency execution with confirmation tracking,
- operator control plane and optional commercial access flows,
- test and observability standards required for serious deployment.

This is not a single trading script. It is a multi-service system designed for continuous operation, bounded risk, and clear incident response.

## 2. Product Vision, Problem, and Principles

### 2.1 Problem

Cross-venue inefficiencies are fragmented and short-lived. Manual detection and execution is too slow and error-prone under network latency, API instability, and market volatility.

### 2.2 Vision

Create the most reliable Solana-native cross-market opportunity engine for DFlow and PNP with:
- deterministic decisioning,
- strict risk boundaries,
- high-quality execution telemetry,
- explicit operational controls.

### 2.3 Engineering Principles

- Determinism: same inputs produce same decision output.
- Safety first: no trade bypasses hard risk checks.
- Idempotency: retries cannot create duplicate logical executions.
- Explainability: every decision can be reconstructed from event logs.
- Progressive hardening: paper mode -> constrained live -> scaled live.

## 3. Scope, Non-Goals, and Phase Boundaries

### 3.1 In Scope

- Real-time ingestion from CoinGecko, Pyth, Helius, DFlow, PNP.
- Opportunity detection across DFlow and PNP.
- Execution orchestration and confirmation lifecycle.
- Position and settlement management.
- Risk engine, circuit breakers, global kill switch.
- Operator dashboard and config management.
- Optional payments and access gating architecture.
- Comprehensive testing pyramid and release gates.

### 3.2 Out of Scope (v1)

- Cross-chain strategies.
- CEX integrations.
- Consumer mobile app.
- Mandatory autonomous market creation on PNP.

### 3.3 Phase Boundaries

- Phase 1: paper trading + replay validation.
- Phase 2: constrained live trading with strict limits.
- Phase 3: scale, strategy expansion, optional commercialization.

## 4. Skill-to-System Mapping (All Required Skills)

| Skill Group | Skill | Responsibility in System |
|---|---|---|
| Data | CoinGecko | Token/pool/trade context, liquidity and trend filters, outlier checks |
| Data | Pyth | Oracle reference pricing, confidence bounds, staleness controls |
| Data | Helius | Core RPC, streaming, parsed tx data, sender strategy |
| Money | DFlow Phantom Connect Skill | Wallet-connect UX and signing flows in frontend |
| Money | DFlow Skill | DFlow order/quote/swap APIs, execution mode handling, metadata streams |
| Money | PNP Markets Skill | PNP market discovery, pricing, buy/sell, settlement/redemption lifecycle |
| Frame | Pinocchio | Optional on-chain policy guardrail program for deterministic constraints |
| Frame | Kit <> web3.js Interop | Strict adapter boundaries between Kit-first core and legacy web3 dependencies |
| Frame | Frontend | Next.js + framework-kit patterns for operator console |
| Frame | Payments & Commerce | Subscription and entitlement settlement verification flows |
| Frame | Testing Strategy | LiteSVM + Mollusk + Surfpool + cluster smoke gating |

## 5. Users and Jobs to Be Done

### 5.1 Quant Operator

Needs:
- run/stop strategies safely,
- inspect live exposure and PnL,
- audit decisions and failures quickly.

### 5.2 Product/Admin Operator

Needs:
- manage configs and approvals,
- monitor system health and incidents,
- control access/billing if SaaS mode is enabled.

### 5.3 Optional Paid User (Future)

Needs:
- wallet-authenticated access,
- plan-based feature entitlements,
- transparent performance and risk view.

## 6. Success Metrics and SLOs

### 6.1 Trading Quality KPIs

- Net PnL after fees/slippage.
- Opportunity hit rate: executed / approved opportunities.
- Fill quality delta: expected vs realized execution outcome.
- Failure ratio by reason category.

### 6.2 Reliability SLOs

- Core service availability: >= 99.5% (Phase 2), target 99.9% (Phase 3).
- Decision latency p95 (signal -> execution intent): <= 700 ms.
- Dispatch latency p95 (approved intent -> tx submission): <= 500 ms.
- Freshness SLO for oracle: Pyth staleness <= 2 s in fast mode, <= 10 s safe mode.
- Freshness SLO for venue quotes: actionable quote staleness <= 3 s.

### 6.3 Risk KPIs

- Hard-limit breaches: 0.
- Kill-switch trigger to halt: <= 1 s from breach event.
- Reconciliation mismatch unresolved > 5 min: 0 in steady state.

## 7. Functional Requirements

### 7.1 FR-01 Multi-Source Ingestion

System must ingest and normalize:
- DFlow quotes/orders/trades + prediction metadata,
- PNP market data and trading state,
- Pyth price/confidence/publish_time,
- CoinGecko token/pool/trade context,
- Helius parsed transaction and stream signals.

### 7.2 FR-02 Opportunity Engine

System must compute actionable opportunities using:
- cross-venue differential,
- fees and slippage budgets,
- confidence and staleness penalties,
- depth and fill-probability constraints.

### 7.3 FR-03 Strategy Modes

Must support:
- Conservative: tighter confidence and sizing.
- Balanced: default production profile.
- Aggressive: wider threshold and tighter execution timeout.

### 7.4 FR-04 Execution Routing

Must support:
- DFlow sync and async execution flows,
- PNP buy/sell and redemption operations,
- requote/retry with idempotency,
- full state tracking from submit to terminal status.

### 7.5 FR-05 Risk Enforcement

Must enforce:
- max notional per trade,
- per-market/per-venue exposure caps,
- drawdown and loss limits,
- freshness/confidence gates,
- failure-rate circuit breaker.

### 7.6 FR-06 Position and Settlement

Must maintain:
- open positions by venue/market/side,
- settlement eligibility and backlog,
- redemption execution and reconciliation,
- intent-to-outcome ledger.

### 7.7 FR-07 Operator Console

Must provide:
- live status, opportunity stream, executions,
- exposure/PnL/risk dashboards,
- pause/resume and global kill-switch,
- config changes with audit trail.

### 7.8 FR-08 Commerce Readiness

If enabled, must include:
- payment flow hooks,
- plan-based access control,
- on-chain verification before entitlement grant.

### 7.9 FR-09 Quality Gates

Must pass unit, integration, and cluster smoke suites before release.

## 8. Non-Functional Requirements

- Security: secret isolation, key custody abstraction, no key leakage.
- Idempotency: logical exactly-once execution per intent ID.
- Scalability: horizontal workers for ingest/scoring/execution.
- Auditability: append-only event lineage.
- Operability: traceable failures with clear remediation.
- Determinism: bounded nondeterminism and explicit tie-break rules.

## 9. Architecture

### 9.1 Service Topology

1. `ingestion-gateway`
- Connector adapters for all external data providers.
- Schema validation and timestamp normalization.

2. `state-normalizer`
- Canonical symbols/events mapping.
- Decimal normalization and unit conversions.

3. `opportunity-engine`
- Strategy scoring, ranking, and candidate generation.

4. `risk-engine`
- Pre-trade checks, dynamic throttles, runtime breakers.

5. `execution-orchestrator`
- Venue-specific transaction generation and submission.
- Confirmation and retry policies.

6. `position-settlement-service`
- Position lifecycle, settlement checks, redemption actions.

7. `control-plane-api`
- Config, approval workflows, risk controls, report APIs.

8. `frontend-console`
- Operator UI and optional user features.

9. `observability-stack`
- Metrics, logs, traces, alerts, runbook links.

### 9.2 Logical Data Flow

1. Ingest event.
2. Normalize and enrich.
3. Recompute opportunity graph.
4. Risk pre-check.
5. Emit execution intent.
6. Submit and monitor.
7. Persist and reconcile.
8. Publish telemetry.

### 9.3 Reliability Model

- At-least-once ingestion + idempotent processors.
- Deterministic `intent_id` for dedupe.
- State-machine guarded transitions only.

## 10. Canonical Data Model

### 10.1 Core Entities

- `market_event`: canonical event and venue mappings.
- `quote_snapshot`: normalized quote/depth/timestamp.
- `oracle_snapshot`: Pyth price/confidence/exponent/publish_time.
- `opportunity_intent`: computed edge, rationale, constraints.
- `execution_attempt`: tx build hash, signature, retry metadata.
- `position`: inventory, cost basis, realized/unrealized PnL.
- `settlement_event`: resolution/redeem lifecycle data.
- `risk_snapshot`: active risk metrics at decision time.
- `config_version`: immutable config fingerprint.
- `audit_event`: actor/action/when/why payload.

### 10.2 Data Guarantees

- All monetary values stored in atomic units + decimals metadata.
- All decision timestamps in UTC epoch milliseconds.
- All state changes append-only and versioned.

## 11. Opportunity and Strategy Framework

### 11.1 Strategy Families

- Family A: cross-venue probability dislocation.
- Family B: spot-event hedge opportunities.
- Family C: liquidity shock capture.

### 11.2 Core Score Formula (v1)

`edge_net = gross_edge - fee_cost - slippage_cost - confidence_penalty - staleness_penalty - latency_penalty`

Where:
- `gross_edge`: raw differential opportunity.
- `fee_cost`: protocol + network + priority execution costs.
- `slippage_cost`: depth-aware size impact estimate.
- `confidence_penalty`: function of Pyth confidence ratio.
- `staleness_penalty`: function of data age and drift risk.
- `latency_penalty`: expected degradation from queue/dispatch delay.

### 11.3 Eligibility Rules

Trade candidate is executable only when:
- `edge_net >= min_edge_threshold(mode)`
- `expected_value_usd >= min_ev_usd`
- all hard risk gates pass
- required venue health status is green

### 11.4 Sizing Logic

- Base size from risk budget per strategy mode.
- Downscale factor from confidence ratio and venue health.
- Hard cap from max notional/exposure limits.

## 12. Protocol Integration Requirements

### 12.1 DFlow

APIs and behavior:
- Trading base: `https://quote-api.dflow.net`.
- Metadata base: `https://api.prod.dflow.net`.
- Required flows: `GET /order`, `GET /order-status`, `GET /quote`, `POST /swap`.
- Must support both sync and async execution modes.
- Must persist route plan and expected out amount for ex-post analysis.

### 12.2 PNP Markets

Program IDs:
- Mainnet: `6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb`
- Devnet: `pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz`

Required operations:
- discovery, pricing, buy/sell, settlement, redemption.
- V2 required for production baseline; V3 behind feature flag.

Critical lifecycle guard:
- If custom oracle markets are created, `setMarketResolvable(..., true)` must be called within 15 minutes or market can freeze permanently.

### 12.3 Pyth

- Hermes endpoint: `https://hermes.pyth.network`.
- Must enforce max staleness and confidence-ratio gates.
- Default reject threshold: confidence ratio > 2%.
- Maintain EMA reference for volatility-heavy conditions.

Known addresses:
- Receiver: `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`
- Price Feed Program: `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`

### 12.4 CoinGecko

- Demo base: `https://api.coingecko.com/api/v3/onchain`
- Pro base: `https://pro-api.coingecko.com/api/v3/onchain`
- Use for context/filtering, not sole execution-time truth.
- Must implement rate-limit aware retry with exponential backoff.

### 12.5 Helius

- Use as primary Solana infrastructure and submission path.
- Must integrate dynamic priority fee strategy.
- Must include retry and terminal-status tracking.
- Must capture parsed transaction artifacts for reconciliation.

## 13. Risk Management and Controls

### 13.1 Hard Limits (Blocking)

- max single-trade notional,
- max exposure per market,
- max exposure per venue,
- max daily notional,
- max daily loss,
- max pending executions.

### 13.2 Soft Limits (Adaptive)

- confidence-aware downsize,
- volatility-aware downsize,
- venue-health routing preference,
- adaptive minimum edge threshold.

### 13.3 Circuit Breakers

Triggers:
- consecutive execution failures,
- stale critical feeds,
- slippage outlier breaches,
- reconciliation mismatch above threshold,
- RPC/venue degradation sustained for configured window.

### 13.4 Kill-Switch

- Manual kill-switch from UI and CLI.
- Automatic global halt on critical rule breach.
- Resume requires explicit operator approval event.

## 14. Transaction and State Machines

### 14.1 Opportunity Lifecycle

`DETECTED -> SCORED -> RISK_APPROVED -> QUEUED -> DISPATCHED -> SENT -> LANDED | FAILED | EXPIRED -> RECONCILED`

### 14.2 Position Lifecycle

`OPENING -> OPEN -> HEDGED | REDUCING -> CLOSED -> SETTLEMENT_PENDING -> REDEEMED`

### 14.3 Incident Lifecycle

`OPEN -> TRIAGE -> MITIGATED -> RESOLVED -> POSTMORTEM_COMPLETE`

## 15. Technology and Framework Decisions

### 15.1 Runtime

- Services: TypeScript on Node.js 22 LTS.
- API layer: Fastify.
- Queue/cache: Redis streams or NATS + Redis.
- Database: Postgres (optionally Timescale for time-series).

### 15.2 Solana SDK Boundary

- Core domain: Kit-first.
- Adapters: web3-compat at boundaries only.
- No uncontrolled `PublicKey`/`Address` type mixing across core domain.

### 15.3 Frontend

- Next.js App Router + React.
- framework-kit provider with wallet-standard-first.
- Phantom-connect UX patterns for operator signing flows.

### 15.4 On-Chain Guardrails (Phase 2+)

- Pinocchio-based policy guard program.
- Minimal instruction set for policy checks and delegated authority controls.

## 16. Frontend and Commerce Requirements

### 16.1 Core Views

- live opportunity tape,
- active positions and exposure,
- execution trace and replay,
- risk controls and kill-switch,
- configuration history and approvals,
- billing/plan page when enabled.

### 16.2 UX Requirements

- immediate action-state feedback,
- clear pending/confirmed/failed/expired statuses,
- explicit confirmation for destructive actions.

### 16.3 Commerce Requirements

- unique payment references/memos,
- chain-settlement verification before entitlement changes,
- strict wallet separation between billing and trading treasury.

## 17. Security, Compliance, and Governance

### 17.1 Secrets and Key Custody

- no secrets in git,
- managed secret store only,
- signer abstraction (KMS/HSM/hardware or delegated signer service),
- key rotation and access scoping.

### 17.2 Data and Transport Security

- TLS for all integrations,
- encryption at rest for sensitive data,
- structured redaction policy for logs.

### 17.3 Policy and Regulatory Controls

- jurisdiction and geoblocking controls where required,
- KYC/identity checks for restricted flows if enabled,
- immutable audit records for operator and strategy changes.

## 18. Testing and Quality Strategy

### 18.1 Unit Tests

- scoring math, policy checks, parser and adapter contracts,
- Pinocchio logic with LiteSVM/Mollusk where applicable.

### 18.2 Integration Tests

- Surfpool-based detect -> execute -> reconcile flows,
- multi-failure injection: stale quote, blockhash expiry, insufficient balance, RPC outages.

### 18.3 Cluster Smoke Tests

- devnet canary with constrained limits,
- mainnet dry-run (no-signing or no-send mode) before release enablement.

### 18.4 Coverage and Reliability Gates

- core strategy/risk modules >= 90% statement coverage,
- integration success >= 95% in pre-release suite,
- zero critical test failures in release candidate.

## 19. Observability and Operations

### 19.1 Metrics

- opportunity throughput,
- queue lag and decision latency,
- dispatch latency and confirmation times,
- fill quality and slippage,
- failure rates by venue/provider,
- PnL and drawdown curves,
- reconciliation backlog.

### 19.2 Logs and Traces

- structured JSON logs with `intent_id` and signature lineage,
- distributed traces across ingestion, scoring, risk, execution,
- incident correlation ID attached to all remediation actions.

### 19.3 Alerts

- kill-switch activation,
- hard risk breach,
- data staleness breach,
- provider outage/error spike,
- settlement backlog threshold breach.

## 20. Deployment, Environments, and Release

### 20.1 Environments

- local dev,
- CI ephemeral,
- staging (devnet + simulated stress),
- production (mainnet).

### 20.2 Release Strategy

- feature flags by strategy and venue,
- canary bot before full rollout,
- blue/green for APIs where feasible.

### 20.3 Automatic Rollback Conditions

- sustained failure-rate breach,
- SLO collapse with degraded fills,
- critical risk-engine malfunction,
- unresolved reconciliation drift over threshold.

## 21. Delivery Plan

### Phase 0 (Weeks 1-2): Foundations

- service scaffolding,
- schemas and connector interfaces,
- CI and baseline observability,
- dashboard shell.

### Phase 1 (Weeks 3-5): Opportunity + Paper Trading

- full ingestion,
- scoring v1,
- replay and simulation harness,
- paper trading validation.

### Phase 2 (Weeks 6-8): Controlled Live

- constrained live execution,
- risk and reconciliation hardening,
- alerts and incident workflows live.

### Phase 3 (Weeks 9-12): Scale + Productization

- strategy expansion,
- Pinocchio policy layer,
- optional billing/entitlement rollout,
- production readiness drills.

## 22. Acceptance Criteria (Definition of Done)

1. End-to-end autonomous flow runs in staging for 7 consecutive days with no critical incident.
2. No hard risk-rule violations during stress and chaos scenarios.
3. All execution intents are traceable from detection to terminal outcome.
4. DFlow and PNP normal/failure paths pass integration suites.
5. Runbooks, rollback procedures, and on-call alerts are validated in drill.

## 23. Recommended Agent Decomposition (for AGENTS.md)

Recommended: 8 agents with disjoint ownership.

- Agent 1: architecture contracts and shared models.
- Agent 2: CoinGecko/Pyth/Helius connectors.
- Agent 3: DFlow adapter and execution flow.
- Agent 4: PNP adapter and settlement lifecycle.
- Agent 5: opportunity engine and strategy scoring.
- Agent 6: risk engine, breakers, reconciliation.
- Agent 7: frontend, wallet UX, commerce integration.
- Agent 8: QA/SRE, test harness, observability, release.

## 24. Open Decisions Before Build Lock

1. Strategy scope at launch: strict arbitrage only or include directional models.
2. Initial capital limits and turnover targets.
3. Custody model at day one: hot wallet vs delegated signer/KMS.
4. Commercial mode timing: launch with paid access or defer.
5. Jurisdiction and compliance envelope.

## 25. Verified Source Baseline

Validated against skills and references available as of April 21, 2026.

- Solana Skills catalog: `https://solana.com/skills`
- DFlow Phantom Connect Skill: `DFlowProtocol/dflow_phantom-connect-skill` (`a0a06f5`)
- DFlow Skill: `sendaifun/skills/skills/dflow` (`72ef2aa`)
- PNP Markets Skill: `pnp-protocol/solana-skill` (`54d164c`)
- CoinGecko Skill: `sendaifun/skills/skills/coingecko` (`72ef2aa`)
- Helius Skill: `sendaifun/skills/skills/helius` (`72ef2aa`)
- Pyth Skill: `sendaifun/skills/skills/pyth` (`72ef2aa`)
- Pinocchio Skill: `sendaifun/skills/skills/pinocchio-development` (`72ef2aa`)
- Solana Foundation reference: `kit-web3-interop.md`
- Solana Foundation reference: `frontend-framework-kit.md`
- Solana Foundation reference: `payments.md`
- Solana Foundation reference: `testing.md`

## 26. Immediate Next Step

Create a deterministic skills-installation checklist with pinned commits, then generate `AGENTS.md` from Section 23 with explicit file ownership and conflict-free workstreams.
