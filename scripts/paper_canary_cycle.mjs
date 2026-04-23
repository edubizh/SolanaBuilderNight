import { DFlowAdapter } from "../services/execution-orchestrator/adapters/dflow/index.js";
import { PnpExecutionAdapter } from "../services/execution-orchestrator/adapters/pnp/index.js";
import { calculateEdgeNet } from "../services/opportunity-engine/src/scoring.js";
import { evaluateCandidateEligibility } from "../services/opportunity-engine/src/strategy.js";
import { RiskEngine } from "../services/risk-engine/src/index.js";

function asNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a finite number`);
  }
  return parsed;
}

function toDisplayAmount(atomic, decimals) {
  return Number(atomic) / 10 ** decimals;
}

function nowIso() {
  return new Date().toISOString();
}

async function getDflowPrice() {
  const dflowBaseUrl = process.env.DFLOW_QUOTE_API_URL ?? "https://dev-quote-api.dflow.net";
  const inputMint =
    process.env.DFLOW_INPUT_MINT ?? "So11111111111111111111111111111111111111112"; // SOL
  const outputMint =
    process.env.DFLOW_OUTPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
  const inDecimals = asNumber("DFLOW_INPUT_DECIMALS", 9);
  const outDecimals = asNumber("DFLOW_OUTPUT_DECIMALS", 6);
  const amountAtomic = String(
    asNumber("DFLOW_INPUT_AMOUNT_ATOMIC", 10_000_000), // 0.01 SOL
  );
  const slippageBps = String(asNumber("DFLOW_SLIPPAGE_BPS", 50));

  const adapter = new DFlowAdapter({
    tradingBaseUrl: dflowBaseUrl,
    metadataBaseUrl: process.env.DFLOW_METADATA_API_URL ?? "https://dev-prediction-markets-api.dflow.net",
  });

  const quote = await adapter.getQuote({
    inputMint,
    outputMint,
    amount: amountAtomic,
    slippageBps,
  });

  const inAmountAtomic = Number(quote.inAmount ?? amountAtomic);
  const outAmountAtomic = Number(quote.outAmount);
  if (!Number.isFinite(outAmountAtomic) || outAmountAtomic <= 0) {
    throw new Error("DFlow quote returned invalid outAmount");
  }

  const inDisplay = toDisplayAmount(inAmountAtomic, inDecimals);
  const outDisplay = toDisplayAmount(outAmountAtomic, outDecimals);
  const price = outDisplay / inDisplay;

  return {
    source: "dflow",
    requestId: quote.requestId ?? null,
    baseUrl: dflowBaseUrl,
    inputMint,
    outputMint,
    inAmountAtomic,
    outAmountAtomic,
    inDisplay,
    outDisplay,
    price,
  };
}

async function getPnpPriceFallbackAware(dflowPrice) {
  const pnpBaseUrl = process.env.PNP_API_BASE_URL ?? "https://api.pnp-protocol.io";
  const pnpMarketId = process.env.PNP_MARKET_ID ?? "";
  const pnpOrderSize = asNumber("PNP_ORDER_SIZE", 1);
  const mockSpreadBps = asNumber("PAPER_MOCK_PNP_SPREAD_BPS", 800); // 8.00%

  if (!pnpMarketId) {
    return {
      source: "pnp-mock",
      usedFallback: true,
      reason: "PNP_MARKET_ID not set",
      price: dflowPrice * (1 + mockSpreadBps / 10_000),
      baseUrl: pnpBaseUrl,
      marketId: null,
    };
  }

  const adapter = new PnpExecutionAdapter({
    client: undefined,
    enableV3: process.env.PNP_ENABLE_V3 === "true",
    featureFlags: { pnpV3: process.env.PNP_ENABLE_V3 === "true" },
  });

  // Override internal client base URL if provided.
  adapter.client.baseUrl = pnpBaseUrl;

  try {
    const quote = await adapter.getPrice({ marketId: pnpMarketId, size: pnpOrderSize });
    return {
      source: "pnp",
      usedFallback: false,
      price: quote.price,
      baseUrl: pnpBaseUrl,
      marketId: pnpMarketId,
    };
  } catch (error) {
    return {
      source: "pnp-mock",
      usedFallback: true,
      reason: `PNP quote unavailable: ${error.message}`,
      price: dflowPrice * (1 + mockSpreadBps / 10_000),
      baseUrl: pnpBaseUrl,
      marketId: pnpMarketId,
    };
  }
}

function evaluateDecision({ dflowPrice, pnpPrice }) {
  const grossEdge = Math.abs((pnpPrice - dflowPrice) / dflowPrice);

  const edge = calculateEdgeNet({
    grossEdge,
    feeCost: asNumber("PAPER_FEE_COST", 0.002),
    slippageCost: asNumber("PAPER_SLIPPAGE_COST", 0.001),
    confidencePenalty: asNumber("PAPER_CONFIDENCE_PENALTY", 0.0005),
    stalenessPenalty: asNumber("PAPER_STALENESS_PENALTY", 0.0005),
    latencyPenalty: asNumber("PAPER_LATENCY_PENALTY", 0.0005),
  });

  const mode = process.env.PAPER_STRATEGY_MODE ?? "balanced";
  const tradeNotionalUsd = asNumber("PAPER_TRADE_NOTIONAL_USD", 1_000);

  const candidate = {
    edgeNet: edge.edgeNet,
    expectedValueUsd: edge.edgeNet * tradeNotionalUsd,
    liquidityUsd: asNumber("PAPER_LIQUIDITY_USD", 20_000),
    fillProbability: asNumber("PAPER_FILL_PROBABILITY", 0.8),
  };

  const eligibility = evaluateCandidateEligibility(candidate, mode);
  const riskEngine = new RiskEngine();
  const risk = riskEngine.evaluatePreTrade({
    tradeNotionalUsd,
    currentMarketExposureUsd: asNumber("PAPER_CURRENT_MARKET_EXPOSURE_USD", 0),
    currentVenueExposureUsd: asNumber("PAPER_CURRENT_VENUE_EXPOSURE_USD", 0),
    currentDailyNotionalUsd: asNumber("PAPER_CURRENT_DAILY_NOTIONAL_USD", 0),
    currentDailyLossUsd: asNumber("PAPER_CURRENT_DAILY_LOSS_USD", 0),
    projectedTradeLossUsd: asNumber("PAPER_PROJECTED_TRADE_LOSS_USD", 10),
    currentPendingExecutions: asNumber("PAPER_CURRENT_PENDING_EXECUTIONS", 0),
  });

  const approved = eligibility.isEligible && risk.approved;

  return {
    mode,
    tradeNotionalUsd,
    edge,
    candidate,
    eligibility,
    risk,
    decision: approved ? "PAPER_TRADE_APPROVED" : "PAPER_TRADE_REJECTED",
  };
}

async function main() {
  const cycleId = `paper-${Date.now()}`;
  const dflow = await getDflowPrice();
  const pnp = await getPnpPriceFallbackAware(dflow.price);
  const decision = evaluateDecision({ dflowPrice: dflow.price, pnpPrice: pnp.price });

  const result = {
    cycleId,
    timestamp: nowIso(),
    dryRun: true,
    notes: [
      "Paper mode only. No wallet signing or transaction submission was performed.",
      "Use this as a canary decision-cycle check before any live trading wiring.",
    ],
    marketData: {
      dflow,
      pnp,
    },
    decision,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        dryRun: true,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
