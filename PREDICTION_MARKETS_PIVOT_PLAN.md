# Prediction Markets Pivot Plan

## Goal
Pivot the bot from swap-only execution to prediction-market opportunity detection and execution across:
- DFlow (tokenized Kalshi on Solana)
- PNP markets
- Gemini prediction markets
- Kalshi direct API

## Current Reality In This Repo
- Live bot currently executes SOL -> USDC swaps (not prediction positions).
- PNP execution adapter is still scaffold-level for submission semantics.
- No Gemini/Kalshi authenticated execution adapter exists yet in this codebase.

## What Was Added Now
- Cross-venue prediction opportunity scanner script:
  - `scripts/prediction_market_scanner.mjs`
- Watchlist config for market mapping:
  - `config/prediction_markets_watchlist.json`
- npm commands:
  - `npm run prediction:scan:once`
  - `npm run prediction:scan`

## Immediate Cutover Steps
1. Stop swap bot to avoid non-prediction trades:
   - `kill "$(cat .artifacts/autobot/live.pid)"`
2. Update watchlist with real market IDs/symbols across venues.
3. Run one scan:
   - `npm run prediction:scan:once`
4. Run continuous scanner:
   - `npm run prediction:scan`
5. Watch scanner logs:
   - `.artifacts/prediction-bot/opportunity-scan-YYYY-MM-DD.jsonl`

## Required Market Mapping (Per Pair)
Each pair needs identifiers for at least 2 venues:
- `dflow.marketTicker`
- `gemini.symbol`
- `kalshi.ticker`
- `pnp.marketId`

Scanner ranks opportunities by YES spread:
- bestSellYesBid - bestBuyYesAsk
- actionable if spread >= `minSpreadToTrade`

## Phase Plan To Reach Live Prediction Execution
### Phase 1: Discovery + Ranking (done)
- Multi-venue data collection and opportunity ranking in dry mode.

### Phase 2: DFlow Prediction Execution
- Use DFlow prediction flow (`/order`, `/order-status`, metadata market discovery)
- Add wallet/KYC/Proof checks for outcome-token buys.

### Phase 3: Gemini Execution Adapter
- Implement authenticated order/positions integration:
  - `/v1/prediction-markets/order`
  - `/v1/prediction-markets/order/cancel`
  - `/v1/prediction-markets/orders/active`
  - `/v1/prediction-markets/orders/history`
  - `/v1/prediction-markets/positions`

### Phase 4: Kalshi Execution Adapter
- Implement authenticated order lifecycle on Kalshi:
  - `POST /trade-api/v2/portfolio/orders`
  - `GET /trade-api/v2/portfolio/orders`
  - plus fills/positions reconciliation

### Phase 5: True Cross-Venue Strategy
- Two-leg or hedged execution logic
- Exposure caps by event/category/venue
- Settlement/redeem and unresolved-risk monitoring

## Operational Risks To Handle Before Full Automation
- Venue-specific auth/signing and rate limits
- DFlow/Kalshi compliance and jurisdiction controls
- Partial fill risk and stale-quote risk
- Correlation risk across similar events
- Reliable settlement/redeem bookkeeping

## Source Links Used For API Validation
- DFlow prediction docs: `https://pond.dflow.net/learn/prediction-markets`
- DFlow market discovery recipe: `https://pond.dflow.net/build/recipes/prediction-markets/discover-markets`
- DFlow trade into position flow: `https://pond.dflow.net/build/recipes/prediction-markets/trade-into-position`
- Gemini prediction docs (landing): `https://developer.gemini.com/prediction-markets/prediction-markets`
- Gemini markets/trading/positions reference:
  - `https://docs.gemini.com/prediction-markets/markets`
  - `https://docs.gemini.com/prediction-markets/trading`
  - `https://docs.gemini.com/prediction-markets/positions`
- Kalshi docs (quick start + API):
  - `https://docs.kalshi.com/getting_started/quick_start_market_data`
  - `https://docs.kalshi.com/api-reference/orders/create-order`
  - `https://docs.kalshi.com/api-reference/orders/get-orders`
- PNP docs:
  - `https://docs.pnp.exchange/`
  - `https://docs.pnp.exchange/sdk/overview`
