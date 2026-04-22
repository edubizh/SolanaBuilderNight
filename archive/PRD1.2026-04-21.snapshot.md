# PRD: Cross-Venue Solana Trading Bot (DFlow + PNP)

Version: 1.0  
Date: 2026-04-21 (America/Indiana/Indianapolis)  
Status: Draft for implementation kickoff  
Owner: Product + Engineering

## 1. Executive Summary

Build a production-grade, autonomous trading system on Solana that discovers and executes risk-adjusted opportunities across:
- DFlow spot and prediction-market execution infrastructure
- PNP Markets prediction market liquidity

The system combines off-chain intelligence (CoinGecko, Pyth, Helius, DFlow metadata, PNP market data), deterministic risk controls, and low-latency transaction execution. The platform includes a web control plane for strategy operations, observability, and optional monetization flows.

This PRD assumes we will use all listed Solana skills and convert them into concrete architecture, interfaces, and testing gates.

## 2. Product Vision and Problem

### 2.1 Problem

Liquidity and pricing inefficiencies across Solana trading venues are fragmented and short-lived. Manual identification and execution is too slow, error-prone, and inconsistent under network congestion.

### 2.2 Vision

Deliver a bot platform that:
- Detects cross-venue mispricing and expected-value opportunities in near real time
- Executes safely with strict risk and compliance controls
- Supports institutional-grade operations: observability, replayability, incident response, and auditable decisions

### 2.3 Target Outcome

A bot stack capable of continuously running, with configurable strategies, deterministic controls, and measurable alpha net of fees, slippage, and failure costs.

## 3. Goals, Non-Goals, and Scope

### 3.1 In-Scope

- Real-time data ingestion from CoinGecko, Pyth, Helius, DFlow, and PNP
- Opportunity scoring for DFlow <-> PNP venue differentials
- Automated order generation and execution routing
- Position tracking, settlement handling, and PnL attribution
- Risk engine and kill-switch framework
- Web dashboard (operator-facing)
- Commerce support for future paid access (payments module)
- Comprehensive testing pyramid (unit/integration/cluster)

### 3.2 Out-of-Scope (Phase 1)

- Cross-chain trading
- CEX integrations
- Fully autonomous market creation on PNP (allowed later, not MVP-critical)
- Consumer mobile app

## 4. Skill-to-Architecture Mapping (Required Skills)

| Skill Group | Skill | Role in Product |
|---|---|---|
| DATA | CoinGecko | External market/pricing/liquidity context (token prices, pools, OHLCV, trades) |
| DATA | Pyth | Oracle confidence bounds + reference pricing and sanity checks |
| DATA | Helius | Primary Solana infrastructure: high-performance RPC, sender strategy, websockets/webhooks, parsed txs |
| MONEY | DFlow Phantom Connect Skill | Wallet connectivity and user/operator wallet UX patterns for frontend |
| MONEY | DFlow Skill | DFlow order/quote/swap/trade APIs and prediction-market metadata APIs |
| MONEY | PNP Markets Skill | PNP market discovery, pricing, trading, resolution, redemption |
| FRAME | Pinocchio | High-performance on-chain policy/guard program for deterministic execution constraints |
| FRAME | Kit <> web3.js Interop | Adapter boundary strategy between modern Kit stack and legacy SDK deps |
| FRAME | Frontend | Next.js/React operator console with framework-kit patterns |
| FRAME | Payments & Commerce | Subscription/access control payment rails for SaaS mode |
| FRAME | Testing Strategy | LiteSVM + Mollusk + Surfpool testing pyramid |

## 5. Users and Personas

### 5.1 Primary Persona: Quant Operator

Needs:
- Fast strategy iteration
- Clear risk boundaries
- Transparent logs and replayability

### 5.2 Secondary Persona: Product Admin

Needs:
- Service health visibility
- Configuration safety and approvals
- Billing/access management (future commercial mode)

## 6. Success Metrics (KPIs)

### 6.1 Trading Quality

- Net PnL (daily/weekly/monthly), net of fees and slippage
- Opportunity hit rate: executed opportunities / qualified opportunities
- Slippage delta: expected fill vs realized fill
- Failed execution ratio by reason

### 6.2 System Reliability

- Uptime target: >= 99.5% for core bot services (Phase 1)
- End-to-end decision latency p95 <= 1200 ms (signal -> signed tx submission)
- Data freshness SLO:
  - Pyth updates max staleness <= 2 seconds for fast mode, <= 10 seconds for safe mode
  - Venue quote staleness <= 3 seconds for actionable opportunity

### 6.3 Risk Discipline

- Hard risk limit breaches: 0
- Circuit-breaker response time <= 1 second from trigger

## 7. Product Requirements

## 7.1 Functional Requirements

### FR-1: Multi-Source Data Ingestion

System must ingest and normalize:
- DFlow trading quotes/orders and prediction-market metadata
- PNP market/account/price data via SDK + RPC
- Pyth prices with confidence and publish timestamp
- CoinGecko token/pool/trade context
- Helius parsed transactions and stream events

### FR-2: Opportunity Detection Engine

The engine must compute actionable opportunities using:
- Cross-venue implied probability/price differentials
- Fee and gas estimates
- Slippage and depth estimates
- Confidence penalties from Pyth
- Staleness penalties

### FR-3: Strategy Layer

Support at least 3 strategy modes:
- Conservative: high certainty threshold, small size, strict confidence filter
- Balanced: default production mode
- Aggressive: wider thresholds, higher turnover, tighter timeout controls

### FR-4: Execution Router

Must route orders with fallback behavior:
- Primary path: DFlow order/trade API for swap/trade tx generation
- PNP execution path for YES/NO token operations
- Requote/retry policy when stale or failed
- Async status tracking for DFlow async execution mode

### FR-5: Risk Engine

Must enforce:
- Max notional per trade
- Max exposure per market and per venue
- Max daily drawdown
- Confidence/staleness gates
- Failure-rate circuit breaker

### FR-6: Position and Settlement Manager

Must track:
- Open positions by market and side
- Pending settlement markets
- Eligibility for redemption and automated redemption calls
- Full ledger from intent -> tx signature -> outcome

### FR-7: Operator Dashboard (Web)

Must provide:
- Real-time bot status
- Opportunity stream and executed trades
- PnL and risk dashboards
- Manual pause/resume + emergency kill-switch
- Config edits with audit trail

### FR-8: Commerce Readiness (Optional but implemented)

Must include payment architecture hooks for:
- Subscription tiers
- Access gating for dashboards/APIs
- On-chain payment verification patterns

### FR-9: Testing Coverage

Must implement testing pyramid:
- Unit: LiteSVM/Mollusk where relevant
- Integration: Surfpool
- Staging smoke tests against devnet/mainnet-like conditions

## 7.2 Non-Functional Requirements

- Security: keys never committed; hardware wallet/KMS signer abstraction
- Auditability: every trade decision explainable from immutable event data
- Idempotency: retries never double-execute intents
- Scalability: horizontal workers for data and scoring pipelines
- Determinism: policy layer must be deterministic for same inputs

## 8. System Architecture

### 8.1 High-Level Components

1. Data Gateway Service
- Adapters for CoinGecko, Pyth, Helius, DFlow, PNP
- Normalizes raw payloads into internal schemas

2. Market State Store
- In-memory hot cache for latest state
- Durable event log in Postgres/Timescale

3. Opportunity Engine
- Computes edge score and opportunity ranking
- Emits execution candidates

4. Risk and Policy Engine
- Applies hard/soft constraints
- Calls optional on-chain Pinocchio policy verifier

5. Execution Service
- Builds and submits txs (DFlow + PNP)
- Tracks confirmations/status transitions

6. Position and Settlement Service
- Maintains position book
- Handles settlement/redeem lifecycle

7. Control Plane API
- Config, metrics, operator actions

8. Frontend Console
- Next.js App Router + framework-kit wallet flows

9. Observability Stack
- Metrics (Prometheus/Grafana)
- Structured logs
- Alerting (PagerDuty/Slack/Webhook)

### 8.2 Reference Tech Stack

- Language: TypeScript (Node.js 20 LTS) for off-chain services
- On-chain: Rust + Pinocchio (policy/guardrails program)
- Web: Next.js + React + `@solana/client` + `@solana/react-hooks` + Kit
- Queue/stream: Redis streams or NATS
- DB: Postgres + Timescale extension
- Secrets: 1Password Connect / AWS Secrets Manager / GCP Secret Manager
- Container/Deploy: Docker + Kubernetes or Fly.io + managed DB

## 9. Detailed Integration Requirements

### 9.1 DFlow Integration

Use DFlow endpoints as follows:
- Swap/Trading base: `https://quote-api.dflow.net`
- Prediction metadata base: `https://api.prod.dflow.net`
- Auth: `x-api-key` where required

Required flows:
- `GET /order` for quote + transaction generation
- `GET /order-status` for async execution lifecycle
- `GET /quote` + `POST /swap` for imperative route controls when needed

Execution requirements:
- Respect `executionMode` and poll async orders until terminal state
- Expire stale quotes before signing
- Record full route plan and expected out amount for post-trade analysis

### 9.2 PNP Integration

Use `pnp-sdk` for:
- Market discovery (`fetchMarketAddresses`, `fetchMarkets`, `fetchMarket`)
- Pricing (`getMarketPriceV2`, `trading.getPrices`)
- Trading (`buyTokensUsdc`, `sellTokensBase`, V2/V3 methods as needed)
- Settlement (`fetchSettlementCriteria`, `fetchSettlementData`, `settleMarket`, `redeemPosition`)

Program IDs:
- Mainnet: `6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb`
- Devnet: `pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz`

Critical rule:
- For custom oracle markets, `setMarketResolvable(..., true)` must be called within 15 minutes of creation or market freezes permanently.

### 9.3 CoinGecko Integration

Use on-chain API for Solana market context:
- Base URLs:
  - Demo: `https://api.coingecko.com/api/v3/onchain`
  - Pro: `https://pro-api.coingecko.com/api/v3/onchain`
- Headers:
  - Demo: `x-cg-demo-api-key`
  - Pro: `x-cg-pro-api-key`

Required endpoints:
- Token prices: `/simple/networks/solana/token_price/{addresses}`
- Pool details: `/networks/solana/pools/{address}`
- OHLCV: `/networks/solana/pools/{pool}/ohlcv/{timeframe}`
- Trades: `/networks/solana/pools/{pool}/trades`

Usage in strategy:
- Liquidity/trend and trade-flow filters
- Independent market context for outlier rejection

### 9.4 Pyth Integration

Use Hermes client for off-chain price validation:
- Endpoint: `https://hermes.pyth.network`
- Packages: `@pythnetwork/hermes-client`, `@pythnetwork/pyth-solana-receiver`

Risk gate rules:
- Reject stale prices beyond strategy max age
- Reject prices where `conf / abs(price)` exceeds configured threshold (default 2%)
- Prefer EMA when volatility spikes

Known core addresses:
- Receiver: `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`
- Price Feed Program: `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`

### 9.5 Helius Integration

Use Helius as primary infra for:
- High-quality RPC and transaction submission strategy
- Parsed transaction/history enrichment
- Realtime account/tx stream events

Requirements:
- Dedicated API key and rate-limit aware client
- Dynamic priority fee estimation integration
- Webhook/websocket feed fallback model

## 10. Opportunity Model (Core Logic)

### 10.1 Normalized Price Representation

For each candidate market/outcome:
- `p_dflow`: implied probability/price from DFlow quote path
- `p_pnp`: implied probability/price from PNP market state
- `p_ref`: reference probability from oracle/context transformation

### 10.2 Edge Score (example v1)

`edge = |p_dflow - p_pnp| - fee_cost - slippage_cost - confidence_penalty - staleness_penalty`

Where:
- `fee_cost` includes protocol and network costs
- `slippage_cost` estimated from order size and depth
- `confidence_penalty` scales with Pyth confidence interval
- `staleness_penalty` scales with data age

### 10.3 Decision Thresholds

Opportunity is tradable when:
- `edge >= min_edge_threshold(strategy_mode)`
- `expected_value >= min_ev_usd`
- `all risk checks pass`

## 11. Risk and Controls

### 11.1 Hard Limits

- Max single-trade notional
- Max market exposure
- Max daily notional
- Max daily loss
- Max open positions

### 11.2 Soft Limits

- Dynamic downsize during volatility spikes
- Confidence-aware sizing
- Venue-health-based routing preference

### 11.3 Circuit Breakers

Trigger immediate pause when:
- Consecutive execution failures above threshold
- RPC health degradation sustained above threshold
- Unexpected slippage above configured multiple
- Data freshness SLO violated across critical feeds

### 11.4 Kill Switch

- Manual operator switch from UI and CLI
- Automatic global halt upon critical rule breach
- Resume requires explicit approval event

## 12. Pinocchio Program (On-Chain Policy Layer)

### 12.1 Purpose

Enforce minimal deterministic controls on-chain before high-value operations, including:
- Allowed venue/program whitelist
- Max notional per instruction bundle
- Signature policy checks for delegated bot authorities

### 12.2 Design Constraints

- Zero-copy account parsing for CU efficiency
- Minimal account footprint
- Upgrade governance with timelocked authority

### 12.3 Candidate Instructions

- `initialize_policy`
- `set_limits`
- `approve_delegate`
- `validate_execution_intent`
- `pause_policy`

### 12.4 Why Pinocchio Here

This layer gives deterministic enforcement under reduced CU cost and smaller binary footprint vs heavier frameworks, while off-chain strategy stays flexible.

## 13. Frontend Requirements

### 13.1 Framework and Wallet

- Next.js App Router
- Single Solana client instance via framework-kit provider
- Wallet Standard-first discovery/connect
- Phantom connection patterns from DFlow Phantom Connect skill

### 13.2 Primary Views

- Live Opportunity Tape
- Active Positions and Exposure
- Strategy Configuration
- Execution Trace/Replay viewer
- Risk Controls and Kill Switch
- Billing/Plan (if SaaS mode enabled)

### 13.3 UX Requirements

- Signature and confirmation states visible immediately
- Clear action-state transitions (pending, confirmed, failed, expired)
- Operator confirmation for destructive actions

## 14. Payments and Commerce Requirements

- Integrate commerce primitives for plan management
- Verify settlement on-chain before granting premium access
- Use unique references/memos for payment replay protection
- Separate production billing wallet from trading wallets

## 15. Data Model Requirements

Core entities:
- `Market`
- `QuoteSnapshot`
- `Opportunity`
- `ExecutionIntent`
- `ExecutionAttempt`
- `Position`
- `SettlementEvent`
- `RiskSnapshot`
- `ConfigVersion`

Event-sourcing requirement:
- Every state change represented as append-only event with monotonic timestamp + source ID

## 16. State Machines

### 16.1 Trade Lifecycle

`DETECTED -> SCORED -> APPROVED -> SENT -> LANDED | FAILED | EXPIRED -> RECONCILED`

### 16.2 Position Lifecycle

`OPENING -> OPEN -> HEDGED | CLOSING -> CLOSED -> SETTLEMENT_PENDING -> REDEEMED`

### 16.3 Incident Lifecycle

`OPEN -> TRIAGE -> MITIGATED -> RESOLVED -> POSTMORTEM_COMPLETE`

## 17. Testing and Quality Strategy

### 17.1 Unit Tests

- Core math, scoring, risk checks
- Pinocchio instruction validation with LiteSVM/Mollusk
- Adapter contract tests for each external provider

### 17.2 Integration Tests

- Surfpool-based end-to-end transaction flows
- Multi-step path: detect -> execute -> confirm -> reconcile
- Failure injection: stale quote, expired blockhash, insufficient funds

### 17.3 Staging/Smoke

- Devnet canary with reduced size and strict kill-switch thresholds
- Production dry-run mode (no-signing) before enabling live execution

### 17.4 Minimum Coverage Targets

- Core decision/risk modules >= 90% statement coverage
- Integration flow success rate >= 95% in CI pre-release suite

## 18. Security and Compliance

### 18.1 Secrets and Keys

- No plaintext private keys in repo or logs
- Signer abstraction for hardware/KMS key custody
- Rotating API keys and scoped least privilege

### 18.2 Data Security

- Encrypt secrets at rest
- TLS for all outbound integrations
- Signed config snapshots for tamper detection

### 18.3 Regulatory and Policy Controls

- Prediction market jurisdiction checks and geoblocking controls where required
- Audit logs for all operator actions and strategy changes
- Clear risk disclaimers and restricted-mode support

## 19. Observability and Operations

### 19.1 Metrics

- Opportunity throughput
- Decision latency and queue lag
- Fill quality and slippage
- API error rates by provider
- PnL and drawdown curves

### 19.2 Logging

- Structured JSON logs with correlation IDs
- Trade-intent lineage ID across all services
- Redaction policy for secrets/PII

### 19.3 Alerting

Critical alerts:
- Kill-switch activation
- Drawdown breach
- Provider outage/failure-rate spike
- Settlement backlog exceeding threshold

## 20. Deployment and Environment Strategy

### 20.1 Environments

- Local development
- CI ephemeral test env
- Staging (devnet + simulated mainnet conditions)
- Production (mainnet)

### 20.2 Release Strategy

- Blue/green for API services
- Feature flags for strategy modules
- Canary bot instance before full rollout

### 20.3 Rollback Criteria

Automatic rollback if:
- Execution failure rate > threshold for sustained window
- Latency SLO breach + degraded fills
- Critical risk engine errors

## 21. Delivery Plan (Phased)

### Phase 0: Foundations (1-2 weeks)

- Repo scaffolding and service boundaries
- Data adapters with schema contracts
- Basic dashboard shell
- CI baseline and lint/test gates

### Phase 1: Opportunity + Paper Trading (2-3 weeks)

- Real-time ingestion complete
- Opportunity scoring v1
- Simulated execution and replay tools

### Phase 2: Controlled Live Trading (2-4 weeks)

- Low-size live execution with strict limits
- Position manager + reconciliation
- Full incident and alerting workflows

### Phase 3: Scale and Commercialization (ongoing)

- Multi-strategy orchestration
- Pinocchio policy hardening
- Billing/access monetization rollout

## 22. Acceptance Criteria (Definition of Done)

1. End-to-end flow from market data ingestion to trade reconciliation runs autonomously in staging for 7 consecutive days with no critical incidents.
2. Risk engine prevents all configured hard-limit violations during stress tests.
3. Dashboard supports real-time monitoring, manual pause/resume, and full trade audit replay.
4. Integration tests cover normal and failure paths for DFlow and PNP execution.
5. Production readiness checklist completed (secrets, alerting, rollback, runbooks, on-call).

## 23. Open Questions (Must Resolve Before Build Lock)

1. Strategy mandate: strictly arbitrage only, or include directional forecasting trades?
2. Capital constraints: initial notional, max daily notional, and target turnover?
3. Custody model: hot wallet only, or MPC/KMS from day one?
4. Commercial mode timing: include paid user access in first launch or defer?
5. Venue policy: are any jurisdictions/users excluded at launch?

## 24. Appendix: Verified Reference Inputs

- Solana skills index: `https://solana.com/skills`
- DFlow skill and Phantom Connect skill docs/repo
- PNP Markets Solana skill docs/repo
- CoinGecko skill reference (on-chain API usage)
- Pyth skill reference (Hermes + Solana receiver)
- Helius skill reference (RPC/sender/realtime architecture)
- Solana dev references:
  - frontend framework-kit
  - kit <-> web3 interop
  - payments and commerce
  - testing strategy (LiteSVM/Mollusk/Surfpool)
- Pinocchio development skill reference

