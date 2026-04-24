import { mkdir, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { DFlowAdapter } from "../services/execution-orchestrator/adapters/dflow/index.js";
import {
  computeRealizedNetUsdFromJsonParsedTx,
  getTransactionJsonParsed,
  isDflowOrderStatusFilled,
  isHttpRpcUrl,
  waitForSignatureConfirmedRpc,
} from "../services/execution-orchestrator/adapters/dflow/solanaRpcConfirm.mjs";
import { RiskEngine } from "../services/risk-engine/src/index.js";

const DEFAULT_DFLOW_QUOTE_API_URL = "https://dev-quote-api.dflow.net";
const DEFAULT_DFLOW_METADATA_API_URL = "https://dev-prediction-markets-api.dflow.net";
const DEFAULT_INPUT_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_OUTPUT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

function parseBooleanEnv(name, fallback = false) {
  const raw = getEnv(name, null);
  if (raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  throw new Error(`${name} must be a boolean (true/false)`);
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

function resolveCoinGeckoHeaderName(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized === "pro") {
    return "x-cg-pro-api-key";
  }
  return "x-cg-demo-api-key";
}

function normalizeCoinGeckoBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/api/v3/onchain")) {
    return normalized.slice(0, -"/onchain".length);
  }
  return normalized;
}

async function fetchSolUsdReferencePrice() {
  const configuredBaseUrl = getEnv("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3");
  const baseUrl = normalizeCoinGeckoBaseUrl(configuredBaseUrl);
  const apiKey = getEnv("COINGECKO_API_KEY", null);
  const apiType = getEnv("COINGECKO_API_TYPE", "demo");
  const timeoutMs = getNumberEnv("COINGECKO_TIMEOUT_MS", 3_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL("simple/price", `${baseUrl}/`);
    url.searchParams.set("ids", "solana");
    url.searchParams.set("vs_currencies", "usd");

    const headers = {};
    if (apiKey) {
      headers[resolveCoinGeckoHeaderName(apiType)] = apiKey;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`CoinGecko simple/price failed (${response.status})`);
    }

    const payload = await response.json();
    const solUsd = Number(payload?.solana?.usd);
    if (!Number.isFinite(solUsd) || solUsd <= 0) {
      throw new Error("CoinGecko simple/price missing solana.usd");
    }

    return {
      source: "coingecko",
      baseUrl: configuredBaseUrl,
      solUsd,
      observedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createCycleLogPath() {
  const logDir = getEnv("AUTOBOT_LOG_DIR", ".artifacts/autobot");
  const day = new Date().toISOString().slice(0, 10);
  return resolve(logDir, `profit-loop-${day}.jsonl`);
}

async function persistCycleLog(result) {
  const path = createCycleLogPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(result)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assertLiveRuntimeGuards({ signableTx, rpcUrl, guardrailFailures }) {
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
}

async function executeLiveSwap({ rpcUrl, keypair, signableTx, order, adapter, usdcMint, solUsd }) {
  const connection = new Connection(rpcUrl, "confirmed");
  const tx = VersionedTransaction.deserialize(Buffer.from(signableTx, "base64"));
  tx.sign([keypair]);
  const wallet = keypair.publicKey.toBase58();

  const signature = await connection.sendTransaction(tx, { maxRetries: 3 });
  const base = {
    wallet,
    signature,
    orbExplorerUrl: `https://orbmarkets.io/tx/${signature}`,
  };

  if (!isHttpRpcUrl(rpcUrl)) {
    return {
      ...base,
      status: "unconfirmed_no_rpc",
      reason: "missing_or_invalid_http_rpc_url",
      confirmation: null,
      realizedNetUsd: null,
    };
  }

  const lastValidBlockHeight =
    order.lastValidBlockHeight !== undefined && order.lastValidBlockHeight !== null
      ? Number(order.lastValidBlockHeight)
      : null;

  const wait = await waitForSignatureConfirmedRpc({
    rpcUrl,
    signature,
    lastValidBlockHeight: Number.isFinite(lastValidBlockHeight) ? lastValidBlockHeight : null,
  });

  if (wait.ok) {
    let net = { ok: false, reason: "get_transaction_unavailable" };
    try {
      const chainTx = await getTransactionJsonParsed(rpcUrl, signature);
      net = computeRealizedNetUsdFromJsonParsedTx(chainTx, wallet, usdcMint, solUsd);
    } catch (error) {
      net = {
        ok: false,
        reason: "get_transaction_fetch_failed",
        getTransactionError: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      ...base,
      status: "confirmed",
      confirmation: {
        source: "rpc",
        value: wait.value,
        confirmationStatus: wait.confirmationStatus,
      },
      realizedNetUsd: net.ok ? net.realizedNetUsd : null,
      realizedMeta: net.ok
        ? { solDelta: net.solDelta, usdcDelta: net.usdcDelta, solUsd, computeOk: true }
        : { reason: net.reason, getTransactionError: net.getTransactionError, solUsd, computeOk: false },
    };
  }

  const orderId = order?.orderId ?? order?.order_id;
  let dflowOrderStatusFallback = null;
  if (orderId) {
    try {
      const st = await adapter.getOrderStatus({ orderId: String(orderId) });
      const state = st?.status ?? st?.state ?? st?.orderStatus ?? st?.executionStatus;
      dflowOrderStatusFallback = {
        orderId: String(orderId),
        filledHint: isDflowOrderStatusFilled(state),
        state: typeof state === "string" ? state : null,
        response: st,
      };
    } catch (error) {
      dflowOrderStatusFallback = {
        orderId: String(orderId),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    ...base,
    status: "submitted_unconfirmed",
    reason: wait.reason,
    blockHeightExceeded: wait.blockHeightExceeded === true,
    confirmation: { source: "rpc", lastRpcWait: wait },
    dflowOrderStatusFallback,
    realizedNetUsd: null,
  };
}

async function runCycle({ executeLive, adapter, keypair }) {
  const rpcUrl = getEnv("SOLANA_RPC_URL", null);
  const inputMint = getEnv("DFLOW_INPUT_MINT", DEFAULT_INPUT_MINT);
  const outputMint = getEnv("DFLOW_OUTPUT_MINT", DEFAULT_OUTPUT_MINT);
  const inputDecimals = getNumberEnv("DFLOW_INPUT_DECIMALS", 9);
  const outputDecimals = getNumberEnv("DFLOW_OUTPUT_DECIMALS", 6);
  const amountAtomic = String(getNumberEnv("DFLOW_INPUT_AMOUNT_ATOMIC", 1_000_000));
  const slippageBps = String(getNumberEnv("DFLOW_SLIPPAGE_BPS", 50));

  const maxNotionalUsd = getNumberEnv("DFLOW_MAX_NOTIONAL_USD", 1);
  const maxPriceImpactPct = getNumberEnv("DFLOW_MAX_PRICE_IMPACT_PCT", 1);
  const projectedTradeLossUsd = getNumberEnv("DFLOW_PROJECTED_TRADE_LOSS_USD", 0.25);

  const minExpectedNetUsd = getNumberEnv("AUTOBOT_MIN_EXPECTED_NET_USD", 0.05);
  const safetyBufferUsd = getNumberEnv("AUTOBOT_SAFETY_BUFFER_USD", 0.02);
  const estimatedTxFeeLamports = getNumberEnv("AUTOBOT_ESTIMATED_TX_FEE_LAMPORTS", 6_000);
  const outputUsdPrice = getNumberEnv(
    "AUTOBOT_OUTPUT_USD_PRICE",
    outputMint === DEFAULT_USDC_MINT ? 1 : NaN,
  );
  const requireCoinGecko = parseBooleanEnv("AUTOBOT_REQUIRE_COINGECKO", true);

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
  const notionalUsd = outDisplay * outputUsdPrice;
  const priceImpactPct = normalizePriceImpactPct(order.priceImpactPct);

  let referencePrice = null;
  let referenceFailure = null;
  try {
    referencePrice = await fetchSolUsdReferencePrice();
  } catch (error) {
    referenceFailure = error instanceof Error ? error.message : String(error);
  }

  const solUsd = referencePrice?.solUsd ?? null;
  const estimatedInputUsd = solUsd === null ? null : inDisplay * solUsd;
  const estimatedOutputUsd = Number.isFinite(outputUsdPrice) ? outDisplay * outputUsdPrice : null;
  const estimatedNetworkFeeUsd =
    solUsd === null ? null : (estimatedTxFeeLamports / 1_000_000_000) * solUsd;

  const estimatedGrossUsd =
    estimatedOutputUsd !== null && estimatedInputUsd !== null
      ? estimatedOutputUsd - estimatedInputUsd
      : null;
  const expectedNetUsd =
    estimatedGrossUsd !== null && estimatedNetworkFeeUsd !== null
      ? estimatedGrossUsd - estimatedNetworkFeeUsd - safetyBufferUsd
      : null;

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
  if (!Number.isFinite(outputUsdPrice)) {
    guardrailFailures.push("output_usd_price_unavailable");
  }
  if (requireCoinGecko && solUsd === null) {
    guardrailFailures.push("missing_coingecko_reference_price");
  }
  if (expectedNetUsd === null) {
    guardrailFailures.push("expected_net_usd_unavailable");
  } else if (expectedNetUsd < minExpectedNetUsd) {
    guardrailFailures.push("expected_net_usd_below_threshold");
  }

  const summary = {
    timestamp: new Date().toISOString(),
    mode: executeLive ? "execute-live" : "dry-run",
    endpoints: {
      dflowTradingBaseUrl: adapter.tradingBaseUrl,
      dflowMetadataBaseUrl: adapter.metadataBaseUrl,
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
    profitGate: {
      minExpectedNetUsd,
      safetyBufferUsd,
      estimatedTxFeeLamports,
      referencePrice,
      referenceFailure,
      estimatedInputUsd,
      estimatedOutputUsd,
      estimatedNetworkFeeUsd,
      estimatedGrossUsd,
      expectedNetUsd,
      pass: expectedNetUsd !== null && expectedNetUsd >= minExpectedNetUsd,
    },
    guardrails: {
      maxNotionalUsd,
      maxPriceImpactPct,
      projectedTradeLossUsd,
      passed: guardrailFailures.length === 0,
      failures: guardrailFailures,
      risk,
    },
    liveExecution: null,
  };

  if (!executeLive) {
    summary.notes = [
      "Dry run mode: no signing, no on-chain transaction submission.",
      "Autobot checks profit/risk gates every cycle and prints decision evidence.",
    ];
    return summary;
  }

  if (guardrailFailures.length > 0) {
    summary.notes = ["Live mode enabled, but this cycle was skipped due to failed guards."];
    return summary;
  }

  assertLiveRuntimeGuards({ signableTx, rpcUrl, guardrailFailures });
  const usdcMintForPnl = outputMint;
  const solUsd = referencePrice?.solUsd ?? null;
  summary.liveExecution = await executeLiveSwap({
    rpcUrl,
    keypair,
    signableTx,
    order,
    adapter,
    usdcMint: usdcMintForPnl,
    solUsd,
  });
  summary.notes = ["Live execution submitted because all profit/risk guards passed."];
  if (summary.liveExecution?.status === "unconfirmed_no_rpc") {
    summary.notes.push("unconfirmed_no_rpc: valid HTTP SOLANA_RPC_URL is required to confirm and realize PnL.");
  } else if (summary.liveExecution?.status === "submitted_unconfirmed") {
    summary.notes.push(
      "submitted_unconfirmed: RPC did not confirm the signature before timeout or blockhash expiry; see liveExecution for details.",
    );
  }
  return summary;
}

async function main() {
  const executeLive = getArgFlag("--execute-live");
  const dryRunExplicit = getArgFlag("--dry-run");
  const runOnce = getArgFlag("--once");
  const stopOnError = parseBooleanEnv("AUTOBOT_STOP_ON_ERROR", false);
  const intervalMs = getNumberEnv("AUTOBOT_INTERVAL_MS", 15_000);
  const maxCycles = getNumberEnv("AUTOBOT_MAX_CYCLES", 0);

  if (!executeLive && !dryRunExplicit) {
    console.log("No mode flag provided; defaulting to --dry-run");
  }

  const adapter = new DFlowAdapter({
    tradingBaseUrl: getEnv("DFLOW_QUOTE_API_URL", DEFAULT_DFLOW_QUOTE_API_URL),
    metadataBaseUrl: getEnv("DFLOW_METADATA_API_URL", DEFAULT_DFLOW_METADATA_API_URL),
  });

  const keypair = executeLive ? parseKeypairFromEnv() : null;

  const runtimeConfig = {
    mode: executeLive ? "execute-live" : "dry-run",
    runOnce,
    intervalMs,
    maxCycles,
    stopOnError,
  };

  console.log(JSON.stringify({ timestamp: new Date().toISOString(), runtimeConfig }, null, 2));

  let cycle = 0;
  while (true) {
    cycle += 1;
    const cycleMeta = {
      cycle,
      startedAt: new Date().toISOString(),
    };

    try {
      const result = await runCycle({ executeLive, adapter, keypair });
      const wrapped = {
        ...cycleMeta,
        ...result,
      };
      console.log(JSON.stringify(wrapped, null, 2));
      await persistCycleLog(wrapped);
    } catch (error) {
      const failure = {
        ...cycleMeta,
        timestamp: new Date().toISOString(),
        mode: executeLive ? "execute-live" : "dry-run",
        error: error instanceof Error ? error.message : String(error),
      };
      console.error(JSON.stringify(failure, null, 2));
      await persistCycleLog(failure);
      if (stopOnError) {
        process.exit(1);
      }
    }

    if (runOnce) {
      break;
    }
    if (maxCycles > 0 && cycle >= maxCycles) {
      break;
    }

    await sleep(intervalMs);
  }
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
