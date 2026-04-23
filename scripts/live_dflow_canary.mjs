import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { DFlowAdapter } from "../services/execution-orchestrator/adapters/dflow/index.js";
import { RiskEngine } from "../services/risk-engine/src/index.js";

function getArgFlag(name) {
  return process.argv.includes(name);
}

function getEnv(name, fallback = null) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value;
}

function getNumberEnv(name, fallback) {
  const raw = getEnv(name, null);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }
  return parsed;
}

function toDisplayAmount(atomicAmount, decimals) {
  return Number(atomicAmount) / 10 ** decimals;
}

function parseKeypairFromEnv() {
  const raw = getEnv("LIVE_PRIVATE_KEY", null);
  if (!raw) {
    throw new Error("LIVE_PRIVATE_KEY is required for --execute-live");
  }

  let secretBytes;
  if (raw.trim().startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("LIVE_PRIVATE_KEY JSON format must be an array");
    }
    secretBytes = Uint8Array.from(parsed);
  } else {
    secretBytes = bs58.decode(raw.trim());
  }

  if (secretBytes.length === 64) {
    return Keypair.fromSecretKey(secretBytes);
  }
  if (secretBytes.length === 32) {
    return Keypair.fromSeed(secretBytes);
  }

  throw new Error(
    `LIVE_PRIVATE_KEY decoded length must be 64 (secret key) or 32 (seed), got ${secretBytes.length}`,
  );
}

function getDryRunPublicKey() {
  const raw = getEnv("DRY_RUN_WALLET_PUBLIC_KEY", null);
  if (!raw) {
    return null;
  }
  return new PublicKey(raw).toBase58();
}

function extractSignableTransaction(orderWithParsed) {
  const parsed = orderWithParsed?.parsedTransactions ?? [];
  if (parsed.length > 0 && parsed[0]?.transaction) {
    return parsed[0].transaction;
  }

  const fallbacks = [
    orderWithParsed?.transaction,
    orderWithParsed?.tx,
    orderWithParsed?.swapTransaction,
    Array.isArray(orderWithParsed?.transactions)
      ? orderWithParsed.transactions.find((entry) => typeof entry === "string")
      : null,
  ];

  return fallbacks.find((entry) => typeof entry === "string") ?? null;
}

function normalizePriceImpactPct(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const executeLive = getArgFlag("--execute-live");
  const dryRunExplicit = getArgFlag("--dry-run");
  if (!executeLive && !dryRunExplicit) {
    console.log("No mode flag provided; defaulting to --dry-run");
  }

  const dflowTradingBaseUrl = getEnv(
    "DFLOW_QUOTE_API_URL",
    "https://dev-quote-api.dflow.net",
  );
  const dflowMetadataBaseUrl = getEnv(
    "DFLOW_METADATA_API_URL",
    "https://dev-prediction-markets-api.dflow.net",
  );
  const rpcUrl = getEnv("SOLANA_RPC_URL", null);

  const inputMint = getEnv(
    "DFLOW_INPUT_MINT",
    "So11111111111111111111111111111111111111112",
  );
  const outputMint = getEnv(
    "DFLOW_OUTPUT_MINT",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  );
  const inputDecimals = getNumberEnv("DFLOW_INPUT_DECIMALS", 9);
  const outputDecimals = getNumberEnv("DFLOW_OUTPUT_DECIMALS", 6);
  const amountAtomic = String(getNumberEnv("DFLOW_INPUT_AMOUNT_ATOMIC", 1_000_000));
  const slippageBps = String(getNumberEnv("DFLOW_SLIPPAGE_BPS", 50));

  const maxNotionalUsd = getNumberEnv("DFLOW_MAX_NOTIONAL_USD", 5);
  const maxPriceImpactPct = getNumberEnv("DFLOW_MAX_PRICE_IMPACT_PCT", 1);
  const projectedTradeLossUsd = getNumberEnv("DFLOW_PROJECTED_TRADE_LOSS_USD", 1);

  const adapter = new DFlowAdapter({
    tradingBaseUrl: dflowTradingBaseUrl,
    metadataBaseUrl: dflowMetadataBaseUrl,
  });

  const keypair = executeLive ? parseKeypairFromEnv() : null;
  const userPublicKey = executeLive
    ? keypair.publicKey.toBase58()
    : getDryRunPublicKey();

  const orderParams = {
    inputMint,
    outputMint,
    amount: amountAtomic,
    slippageBps,
    userPublicKey: userPublicKey ?? undefined,
  };

  const order = await adapter.getOrderWithParsedTransactions(orderParams);
  const signableTx = extractSignableTransaction(order);

  const inAmountAtomic = Number(order.inAmount ?? amountAtomic);
  const outAmountAtomic = Number(order.outAmount ?? order.minOutAmount ?? 0);
  const inDisplay = toDisplayAmount(inAmountAtomic, inputDecimals);
  const outDisplay = toDisplayAmount(outAmountAtomic, outputDecimals);
  const notionalUsd = outDisplay;
  const priceImpactPct = normalizePriceImpactPct(order.priceImpactPct);

  const riskEngine = new RiskEngine();
  const risk = riskEngine.evaluatePreTrade({
    tradeNotionalUsd: notionalUsd,
    currentMarketExposureUsd: getNumberEnv("CURRENT_MARKET_EXPOSURE_USD", 0),
    currentVenueExposureUsd: getNumberEnv("CURRENT_VENUE_EXPOSURE_USD", 0),
    currentDailyNotionalUsd: getNumberEnv("CURRENT_DAILY_NOTIONAL_USD", 0),
    currentDailyLossUsd: getNumberEnv("CURRENT_DAILY_LOSS_USD", 0),
    projectedTradeLossUsd,
    currentPendingExecutions: getNumberEnv("CURRENT_PENDING_EXECUTIONS", 0),
  });

  const guardrailFailures = [];
  if (notionalUsd > maxNotionalUsd) {
    guardrailFailures.push("max_notional_usd_exceeded");
  }
  if (priceImpactPct !== null && priceImpactPct > maxPriceImpactPct) {
    guardrailFailures.push("max_price_impact_pct_exceeded");
  }
  if (!risk.approved) {
    guardrailFailures.push("risk_engine_rejected");
  }

  const summary = {
    timestamp: new Date().toISOString(),
    mode: executeLive ? "execute-live" : "dry-run",
    endpoints: {
      dflowTradingBaseUrl,
      dflowMetadataBaseUrl,
      rpcUrl: rpcUrl ?? null,
    },
    orderParams,
    quoteSummary: {
      inAmountAtomic,
      outAmountAtomic,
      inDisplay,
      outDisplay,
      notionalUsd,
      priceImpactPct,
      executionMode: order.executionMode ?? null,
      requestId: order.requestId ?? null,
      hasSignableTransaction: Boolean(signableTx),
    },
    guardrails: {
      maxNotionalUsd,
      maxPriceImpactPct,
      projectedTradeLossUsd,
      passed: guardrailFailures.length === 0,
      failures: guardrailFailures,
      risk,
    },
  };

  if (!executeLive) {
    summary.notes = [
      "Dry run mode: no signing, no on-chain transaction submission.",
      "Use --execute-live only after reviewing guardrails and having dedicated canary wallet funding.",
    ];
    printSummary(summary);
    return;
  }

  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL is required for --execute-live");
  }
  if (getEnv("LIVE_EXECUTION_CONFIRM", "") !== "I_UNDERSTAND") {
    throw new Error(
      "LIVE_EXECUTION_CONFIRM must be set to I_UNDERSTAND for --execute-live",
    );
  }
  if (!signableTx) {
    throw new Error("No signable transaction returned from DFlow /order response");
  }
  if (guardrailFailures.length > 0) {
    throw new Error(`Guardrail check failed: ${guardrailFailures.join(",")}`);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const tx = VersionedTransaction.deserialize(Buffer.from(signableTx, "base64"));
  tx.sign([keypair]);

  const signature = await connection.sendTransaction(tx, { maxRetries: 3 });

  let confirmation;
  if (
    order.lastValidBlockHeight !== undefined &&
    order.lastValidBlockHeight !== null
  ) {
    confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: tx.message.recentBlockhash,
        lastValidBlockHeight: Number(order.lastValidBlockHeight),
      },
      "confirmed",
    );
  } else {
    confirmation = await connection.confirmTransaction(signature, "confirmed");
  }

  let asyncLifecycle = null;
  if (String(order.executionMode ?? "").toLowerCase() === "async") {
    asyncLifecycle = await adapter.trackOrderStatusLifecycle(
      { signature },
      {
        timeoutMs: getNumberEnv("DFLOW_ASYNC_TIMEOUT_MS", 30_000),
        pollIntervalMs: getNumberEnv("DFLOW_ASYNC_POLL_INTERVAL_MS", 2_000),
      },
    );
  }

  summary.liveExecution = {
    wallet: keypair.publicKey.toBase58(),
    signature,
    orbExplorerUrl: `https://orbmarkets.io/tx/${signature}`,
    confirmation,
    asyncLifecycle,
  };

  printSummary(summary);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
