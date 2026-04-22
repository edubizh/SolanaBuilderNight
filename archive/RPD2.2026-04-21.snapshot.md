# Note

The full product requirements document is in [`PRD.md`](./PRD.md).
# Product Requirements Document (PRD)

## 1. Document Control

- Project Name: `Solana Cross-Market Opportunity Engine` (working codename: `Aperture`)
- Version: `v1.0`
- Status: `Draft for build kickoff`
- Last Updated: `April 21, 2026 (America/Indiana/Indianapolis)`
- Primary Goal: Build a production-grade trading system that detects and executes money opportunities across DFlow and PNP markets on Solana.

---

## 2. Executive Summary

This project delivers a serious, production-intent trading platform that:

- Ingests real-time market and on-chain state from CoinGecko, Pyth, and Helius.
- Detects cross-venue opportunities between DFlow and PNP markets.
- Executes trades with strict risk controls, observability, and rollback/circuit-breaker behavior.
- Provides operator-facing controls, monitoring, and a user-facing wallet-connected interface.
- Uses the full required skill stack across data, trading, framework/tooling, frontend/payments, and testing.

The bot is not a single script. It is a service-oriented system with deterministic strategy evaluation, hardened execution, and production operations.

---

## 3. Product Vision and Objectives

### 3.1 Vision

Create the most reliable Solana-native cross-market opportunity engine for DFlow and PNP, with transparent risk controls and low-latency execution.

### 3.2 Core Objectives

- Objective 1: Identify actionable cross-market opportunities with low false-positive rate.
- Objective 2: Execute quickly and safely with venue-aware transaction handling.
- Objective 3: Keep operator risk bounded through hard limits, kill switches, and audit trails.
- Objective 4: Provide institutional-quality telemetry and incident response workflows.

### 3.3 Non-Goals (v1)

- No perpetual futures integrations beyond DFlow/PNP scope.
- No social-copy trading in v1.
- No autonomous market creation on PNP in v1 production mode (allowed in controlled R&D mode).

---

## 4. Skills Scope (Must-Use Matrix)

All required skills are explicitly mapped to system responsibilities.

| Skill Category | Skill | PRD Responsibility |
|---|---|---|
| Data | CoinGecko | Pool/DEX analytics, token metadata, OHLCV/trade context, liquidity filters |
| Data | Pyth | Canonical oracle price, confidence intervals, staleness checks, EMA reference |
| Data | Helius | RPC, streaming, parsing, transaction delivery (Sender), webhook/event infra |
| Money | DFlow Phantom Connect Skill | Wallet-connected app flows (Phantom), signature UX for execution controls |
| Money | DFlow Skill | Quote/order lifecycle, swap execution modes, prediction market APIs, WebSocket streams |
| Money | PNP Markets Skill | Market discovery, V2/V3 market operations, buy/sell, settlement/redeem lifecycle |
| Frame | Pinocchio | High-performance on-chain guardrail program for strategy intent/risk enforcement (phase-gated) |
| Frame | Kit ↔ web3.js Interop | Adapter boundary between Kit-first core and web3.js-dependent SDK edges |
| Frame | Frontend (framework-kit) | Next.js/React architecture, Solana provider pattern, wallet-standard-first hooks |
| Frame | Payments & Commerce | Billing/subscription/deposit checkout flows, payment verification and accounting |
| Frame | Testing Strategy | Pyramid: LiteSVM/Mollusk unit tests + Surfpool integration + cluster smoke tests |

---

## 5. User Personas

- Operator/Trader: configures strategies, risk limits, and monitors live positions.
- Protocol Researcher: defines opportunity models and validates signal quality.
- End User (optional commercial mode): connects wallet, subscribes, funds strategy wallet, tracks results.

---

## 6. Problem Statement

Cross-market inefficiencies between spot routing venues and prediction market venues are short-lived. Manual workflows miss opportunities and carry high operational risk. Existing bots are often under-specified on:

- data quality controls,
- execution certainty across asynchronous flows,
- risk governance,
- and incident response.

This product solves that gap with a full-stack, testable, controlled trading system.

---

## 7. Functional Requirements

### 7.1 Market Data Ingestion

- Must ingest DFlow quote/orderbook/trade streams and metadata APIs.
- Must ingest PNP market states, prices, liquidity, and resolution metadata.
- Must ingest CoinGecko on-chain token and pool analytics.
- Must ingest Pyth prices with confidence intervals and enforce max staleness.
- Must ingest Helius stream/webhook signals for transaction/account state confirmation.

### 7.2 Opportunity Engine

- Must normalize all prices to common units (atomic token units and decimal display units).
- Must compute opportunity scores with confidence-adjusted edge:
  - `edge_net = gross_edge - fees - slippage_budget - latency_penalty`.
- Must reject opportunities when:
  - Pyth confidence ratio exceeds threshold,
  - oracle data is stale,
  - required venue liquidity is insufficient,
  - risk limits would be violated.

### 7.3 Execution Engine

- Must support DFlow execution modes:
  - synchronous/atomic routes,
  - asynchronous order flows with status polling.
- Must support PNP buy/sell and redemption operations.
- Must submit transactions via Helius Sender path with priority fee + Jito tip policy.
- Must track transaction lifecycle to final state and persist outcomes.

### 7.4 Risk and Portfolio Controls

- Must enforce max position, max venue exposure, and daily loss limits.
- Must support global kill switch and per-strategy circuit breaker.
- Must use token-decimal-aware sizing and min-liquidity constraints.
- Must include reconciliation job for wallet balances and open intents.

### 7.5 Operator + User Interface

- Must provide dashboard for strategy state, PnL, open risk, and error feed.
- Must support Phantom wallet connection for privileged operator actions.
- Must include approvals/audit timeline for parameter changes.

### 7.6 Payments and Commerce

- Must support checkout/payment flow for subscription or strategy access (if commercial mode enabled).
- Must verify settlement on-chain before crediting user entitlement.

---

## 8. Opportunity Strategy Framework

### 8.1 Strategy Family A: Cross-Venue Probability Dislocation

- Compare implied probabilities and payout multipliers between DFlow prediction instruments and PNP YES/NO markets referencing same event.
- Trigger when adjusted spread exceeds threshold after fees, slippage, and confidence penalties.

### 8.2 Strategy Family B: Spot-to-Event Hedge Opportunities

- Use DFlow spot execution and PNP event positions when event payoff has measurable linkage to spot moves.
- Hedge ratio derived from scenario mapping and bounded by risk limits.

### 8.3 Strategy Family C: Liquidity Shock Capture

- Detect temporary liquidity imbalance (pool depth contraction, abrupt spread widening) using CoinGecko + venue book/trade streams.
- Trade only when post-impact expected edge remains positive under conservative slippage.

### 8.4 Scoring and Ranking

- Score factors:
  - expected net edge,
  - fill probability,
  - confidence quality,
  - time-to-expiry alignment,
  - execution complexity.
- Ranked opportunities enter execution queue with per-strategy concurrency caps.

---

## 9. System Architecture

### 9.1 High-Level Components

- `ingestion-service`: connectors for CoinGecko, Pyth, DFlow, PNP, Helius streams.
- `normalization-service`: canonical symbol/event mapping and decimal normalization.
- `opportunity-engine`: strategy computation and ranking.
- `risk-engine`: pre-trade and runtime risk checks.
- `execution-orchestrator`: transaction build/sign/send/confirm.
- `state-ledger`: positions, intents, fills, pnl, reconciliation records.
- `api-gateway`: internal + dashboard APIs.
- `frontend-console`: operator and optional end-user UI.
- `payments-service`: commerce checkout, entitlement, payment verification.
- `observability-stack`: metrics/logs/traces/alerts + runbooks.

### 9.2 Data Path (Hot Loop)

1. Stream and poll ingest updates.
2. Normalize and enrich with oracle confidence/staleness metadata.
3. Recompute opportunity graph on event or bounded interval.
4. Run risk pre-check.
5. Enqueue and execute.
6. Confirm and reconcile.
7. Emit telemetry and persist immutable audit record.

### 9.3 Reliability Pattern

- At-least-once ingestion with idempotent downstream processing.
- Deterministic intent IDs for de-duplication.
- Exactly-once logical execution enforced by execution lock and intent state machine.

---

## 10. Protocol-Specific Requirements

### 10.1 DFlow

- Use `order`/`quote`/`swap` APIs according to strategy mode.
- Handle both sync and async execution modes with explicit status lifecycle.
- Use WebSocket updates for low-latency market data where applicable.
- Honor API key and rate-limit constraints.

### 10.2 PNP Markets

- Support V2 AMM trading in production baseline.
- Include optional V3/P2P support behind feature flag.
- Respect market lifecycle and settlement state transitions.
- Enforce custom-oracle safety rule:
  - if custom markets are ever created, `setMarketResolvable` window constraints must be programmatically guarded.

### 10.3 Pyth

- Reject stale prices with configurable max age (default: 30s for hot loop).
- Reject prices when confidence ratio > configured threshold (default: 2% unless overridden by strategy).
- Keep EMA reference available for slower reversion models.

### 10.4 CoinGecko

- Use for broad discovery/filtering and liquidity context.
- Do not use as sole execution-time truth source.
- Enforce per-plan rate limit backoff and key isolation.

### 10.5 Helius

- Use Helius for RPC + streaming + parsed transaction workflows.
- Transaction send path policy:
  - include priority fee policy,
  - include Jito tip policy,
  - include retry/backoff and expiry handling.

---

## 11. Technical Stack and Framework Decisions

### 11.1 Core Runtime

- Language: TypeScript for services and frontend.
- Runtime: Node.js 22 LTS.
- API: Fastify (or equivalent low-overhead server).

### 11.2 Solana SDK Boundary

- Core domain: `@solana/kit` first.
- Compatibility edge: `@solana/web3-compat` adapters only where required.
- Rule: no uncontrolled `web3.js` type bleed into core strategy domain models.

### 11.3 Frontend

- Framework: Next.js App Router + React.
- Solana integration: framework-kit/provider + Wallet Standard-first discovery.
- Phantom connection flows via DFlow Phantom Connect patterns where wallet-centric trading UX is needed.

### 11.4 On-Chain Program (Phase 2)

- Framework: Pinocchio.
- Purpose: minimal, high-performance guardrail executor for signed strategy intents (optional but planned).
- Constraints: zero-copy account validation, strict compute budget targets.

### 11.5 Data and Caching

- Primary DB: Postgres (positions, fills, risk snapshots, audit logs).
- Cache/queue: Redis (hot quotes, throttles, task queues, dedupe keys).

---

## 12. Data Model (Core Entities)

- `market_event`: canonical event identity, venue mappings, expiry/resolution metadata.
- `market_quote`: time-series normalized quote/book snapshot.
- `oracle_snapshot`: pyth price/confidence/expo/publish_time.
- `opportunity_intent`: computed edge, rationale, required legs, risk checks.
- `execution_attempt`: tx payload hash, send status, signature(s), retries.
- `position`: venue-wise position state and cost basis.
- `risk_state`: current exposure, drawdown, strategy utilization.
- `audit_event`: immutable actor/action payload with timestamp.

---

## 13. Risk Management Requirements

### 13.1 Pre-Trade Hard Checks

- Max notional per trade.
- Max slippage bps by asset class.
- Max confidence ratio from oracle.
- Min liquidity depth and spread threshold.
- Max concurrent pending executions.

### 13.2 Runtime Controls

- Daily realized loss halt.
- Intraday drawdown halt.
- Venue outage fallback mode.
- Reconciliation mismatch halt.

### 13.3 Post-Trade Controls

- Settlement confirmation and state reconciliation.
- Drift detection between expected and actual inventory.
- Automatic generation of incident report for failed critical flows.

---

## 14. Security and Compliance

- Secrets in managed secret store only; never in repo.
- Least-privilege service accounts.
- Signed config changes for production strategies.
- Full audit trail for risk parameter changes.
- Geoblocking + identity checks for any prediction-market user flow where required by venue rules.
- Third-party skill usage policy:
  - Pin exact commit or release for every external skill dependency.

---

## 15. Testing Strategy (Required Pyramid)

### 15.1 Unit Tests

- Service logic, parsers, math, risk checks.
- Solana program unit tests with LiteSVM/Mollusk where relevant.

### 15.2 Integration Tests

- Multi-service flow tests using Surfpool/local fork setup.
- End-to-end execution replay tests with synthetic opportunity streams.

### 15.3 Cluster Smoke Tests

- Devnet smoke suite for transaction path validation.
- Mainnet-safe dry run mode for pre-production checks.

### 15.4 Determinism Requirements

- Opportunity scoring must be deterministic for same input snapshot.
- Execution idempotency must be validated under retry storm scenarios.

---

## 16. Observability and SRE Requirements

- Metrics:
  - opportunity count/hour,
  - accepted vs rejected ratio,
  - realized vs expected edge,
  - fill rate,
  - p50/p95 execution latency,
  - drawdown and exposure.
- Logs:
  - structured JSON with intent ID and tx signature correlation.
- Traces:
  - ingestion -> opportunity -> risk -> execution path.
- Alerts:
  - stale oracle,
  - execution failure burst,
  - drawdown breaches,
  - reconciliation mismatch.

---

## 17. Performance and SLO Targets

- Data freshness SLO: hot market data lag <= 2s p95.
- Opportunity compute latency: <= 300ms p95 per update cycle.
- Execution dispatch latency: <= 500ms p95 from intent approval.
- Confirmation tracking visibility: first status update <= 2s p95.
- Dashboard availability: 99.9% monthly target.

---

## 18. Delivery Plan

### Phase 0: Foundation (Week 1-2)

- Repo structure, environment, CI, secrets, telemetry skeleton.
- Connector skeletons and schema contracts.

### Phase 1: Data + Opportunity Core (Week 3-5)

- CoinGecko/Pyth/Helius/DFlow/PNP ingestion.
- Normalization engine + first opportunity strategy.

### Phase 2: Execution + Risk Hardening (Week 6-8)

- DFlow and PNP execution adapters.
- Full risk engine + circuit breakers + reconciliation.

### Phase 3: Console + Payments (Week 9-10)

- Operator dashboard, Phantom auth flows, payment/commerce integration.

### Phase 4: Programmatic Guardrails + Production Readiness (Week 11-12)

- Pinocchio guard program (feature-flagged).
- Load tests, disaster drills, launch checklist.

---

## 19. Acceptance Criteria

- Bot can ingest, score, and execute opportunities across DFlow and PNP in controlled production mode.
- All pre-trade and runtime risk controls are enforceable and tested.
- Full traceability from opportunity detection to final settlement exists.
- Failure modes trigger safe fallback behavior without unbounded risk.
- Test pyramid coverage and smoke tests pass for release gate.

---

## 20. Initial Agent Decomposition (For Upcoming `AGENTS.md`)

Recommended starting team: `8 agents` with disjoint ownership.

- Agent 1: Architecture + contracts + shared types.
- Agent 2: Data connectors (CoinGecko/Pyth/Helius).
- Agent 3: DFlow adapter + execution path.
- Agent 4: PNP adapter + market lifecycle handling.
- Agent 5: Opportunity engine + strategy math.
- Agent 6: Risk engine + reconciliation.
- Agent 7: Frontend + Phantom + operator console + payments UX.
- Agent 8: QA/SRE + test harness + observability + release automation.

This split minimizes file conflicts and allows parallel delivery.

---

## 21. Open Decisions Before Build Starts

- Legal/compliance envelope for jurisdictions and market types.
- Custody model:
  - operator-managed key vs delegated signer service vs vault abstraction.
- Primary monetization mode in v1:
  - internal prop strategy only vs paid external users.
- Exact initial strategy set to ship in production gate.

---

## 22. Source Baseline (Validated for this PRD)

- Solana Skills catalog: `https://solana.com/skills` (checked April 21, 2026).
- DFlow Phantom Connect Skill: `DFlowProtocol/dflow_phantom-connect-skill` at commit `a0a06f5`.
- DFlow Skill: `sendaifun/skills/skills/dflow` at commit `72ef2aa`.
- PNP Markets Skill: `pnp-protocol/solana-skill` at commit `54d164c`.
- CoinGecko Skill: `sendaifun/skills/skills/coingecko` at commit `72ef2aa`.
- Helius Skill: `sendaifun/skills/skills/helius` at commit `72ef2aa`.
- Pyth Skill: `sendaifun/skills/skills/pyth` at commit `72ef2aa`.
- Pinocchio Skill: `sendaifun/skills/skills/pinocchio-development` at commit `72ef2aa`.
- Solana Foundation references:
  - Kit <> web3.js Interop
  - Frontend with framework-kit
  - Payments & Commerce
  - Testing Strategy

---

## 23. Immediate Next Step

Using this PRD as baseline, next step is to create a deterministic installation plan for all required skills with pinned revisions, then scaffold `AGENTS.md` from Section 20.
