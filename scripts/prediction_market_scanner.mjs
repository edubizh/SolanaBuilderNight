import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PnpExecutionAdapter } from "../services/execution-orchestrator/adapters/pnp/index.js";

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

function parseMaybeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chooseMid({ bid, ask, last }) {
  if (bid !== null && ask !== null) {
    return (bid + ask) / 2;
  }
  if (last !== null) {
    return last;
  }
  return bid ?? ask ?? null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function loadWatchlist() {
  const path = getEnv(
    "PREDICTION_WATCHLIST_PATH",
    "/Users/elidubizh/Desktop/SolanaBuilderNight/config/prediction_markets_watchlist.json",
  );

  const content = await readFile(path, "utf8");
  const parsed = JSON.parse(content);
  const pairs = safeArray(parsed?.pairs);
  return {
    path,
    version: parsed?.version ?? 1,
    pairs,
  };
}

async function fetchDflowMarkets() {
  const baseUrl = getEnv("DFLOW_METADATA_API_URL", "https://dev-prediction-markets-api.dflow.net");
  const status = getEnv("DFLOW_MARKET_STATUS", "active");
  const limit = getNumberEnv("DFLOW_MARKET_LIMIT", 200);
  const url = `${baseUrl}/api/v1/events?withNestedMarkets=true&status=${encodeURIComponent(status)}&limit=${limit}`;
  const payload = await fetchJson(url);

  const marketByTicker = new Map();
  for (const event of safeArray(payload?.events)) {
    for (const market of safeArray(event?.markets)) {
      const yesBid = parseMaybeNumber(market?.yesBid);
      const yesAsk = parseMaybeNumber(market?.yesAsk);
      const yesMid = chooseMid({
        bid: yesBid,
        ask: yesAsk,
        last: null,
      });

      marketByTicker.set(String(market?.ticker), {
        source: "dflow",
        eventTicker: market?.eventTicker ?? event?.ticker ?? null,
        marketTicker: market?.ticker ?? null,
        title: market?.title ?? null,
        status: market?.status ?? null,
        yesBid,
        yesAsk,
        yesMid,
        raw: market,
      });
    }
  }

  return {
    source: "dflow",
    url,
    events: safeArray(payload?.events).length,
    markets: marketByTicker.size,
    marketByTicker,
  };
}

async function fetchGeminiContracts() {
  const limit = getNumberEnv("GEMINI_EVENTS_LIMIT", 200);
  const url = `https://api.gemini.com/v1/prediction-markets/events?limit=${limit}`;
  const payload = await fetchJson(url);

  const contractBySymbol = new Map();
  for (const event of safeArray(payload?.data)) {
    for (const contract of safeArray(event?.contracts)) {
      const yesAsk = parseMaybeNumber(contract?.prices?.buy?.yes);
      const yesBid = parseMaybeNumber(contract?.prices?.sell?.yes);
      const last = parseMaybeNumber(contract?.prices?.lastTradePrice);
      const yesMid = chooseMid({ bid: yesBid, ask: yesAsk, last });

      contractBySymbol.set(String(contract?.instrumentSymbol), {
        source: "gemini",
        eventTicker: event?.ticker ?? null,
        symbol: contract?.instrumentSymbol ?? null,
        label: contract?.label ?? null,
        status: contract?.status ?? null,
        yesBid,
        yesAsk,
        yesMid,
        raw: contract,
      });
    }
  }

  return {
    source: "gemini",
    url,
    events: safeArray(payload?.data).length,
    contracts: contractBySymbol.size,
    contractBySymbol,
  };
}

async function fetchKalshiMarkets() {
  const baseUrl = getEnv("KALSHI_BASE_URL", "https://api.elections.kalshi.com/trade-api/v2");
  const limit = getNumberEnv("KALSHI_MARKET_LIMIT", 500);
  const url = `${baseUrl}/markets?status=open&limit=${limit}`;
  const payload = await fetchJson(url);

  const marketByTicker = new Map();
  for (const market of safeArray(payload?.markets)) {
    const yesBid = parseMaybeNumber(market?.yes_bid_dollars);
    const yesAsk = parseMaybeNumber(market?.yes_ask_dollars);
    const last = parseMaybeNumber(market?.last_price_dollars);
    const yesMid = chooseMid({ bid: yesBid, ask: yesAsk, last });

    marketByTicker.set(String(market?.ticker), {
      source: "kalshi",
      ticker: market?.ticker ?? null,
      eventTicker: market?.event_ticker ?? null,
      status: market?.status ?? null,
      yesBid,
      yesAsk,
      yesMid,
      raw: market,
    });
  }

  return {
    source: "kalshi",
    url,
    markets: marketByTicker.size,
    marketByTicker,
  };
}

async function fetchPnpQuotesForWatchlist(watchlistPairs) {
  const configuredPairs = watchlistPairs.filter((pair) => pair?.venues?.pnp?.marketId);
  if (configuredPairs.length === 0) {
    return {
      source: "pnp",
      quotes: 0,
      quoteByMarketId: new Map(),
      warning: "No pnp.marketId values configured in watchlist",
    };
  }

  const adapter = new PnpExecutionAdapter({
    enableV3: getEnv("PNP_ENABLE_V3", "false") === "true",
    featureFlags: { pnpV3: getEnv("PNP_ENABLE_V3", "false") === "true" },
  });

  if (getEnv("PNP_API_BASE_URL", null)) {
    adapter.client.baseUrl = getEnv("PNP_API_BASE_URL", null);
  }

  const quoteByMarketId = new Map();

  for (const pair of configuredPairs) {
    const marketId = pair.venues.pnp.marketId;
    const size = parseMaybeNumber(pair.venues.pnp.size) ?? getNumberEnv("PNP_ORDER_SIZE", 1);

    try {
      const quote = await adapter.getPrice({ marketId, size });
      const yesMid = parseMaybeNumber(quote?.price);
      quoteByMarketId.set(String(marketId), {
        source: "pnp",
        marketId,
        size,
        yesBid: yesMid,
        yesAsk: yesMid,
        yesMid,
        raw: quote,
      });
    } catch (error) {
      quoteByMarketId.set(String(marketId), {
        source: "pnp",
        marketId,
        size,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    source: "pnp",
    quotes: quoteByMarketId.size,
    quoteByMarketId,
  };
}

function collectVenueQuotesForPair(pair, venueData) {
  const quotes = [];
  const venues = pair?.venues ?? {};

  const dflowTicker = venues?.dflow?.marketTicker;
  if (dflowTicker && venueData?.dflow?.marketByTicker?.has(String(dflowTicker))) {
    const dflow = venueData.dflow.marketByTicker.get(String(dflowTicker));
    quotes.push({
      venue: "dflow",
      key: String(dflowTicker),
      yesBid: dflow.yesBid,
      yesAsk: dflow.yesAsk,
      yesMid: dflow.yesMid,
    });
  }

  const geminiSymbol = venues?.gemini?.symbol;
  if (geminiSymbol && venueData?.gemini?.contractBySymbol?.has(String(geminiSymbol))) {
    const gemini = venueData.gemini.contractBySymbol.get(String(geminiSymbol));
    quotes.push({
      venue: "gemini",
      key: String(geminiSymbol),
      yesBid: gemini.yesBid,
      yesAsk: gemini.yesAsk,
      yesMid: gemini.yesMid,
    });
  }

  const kalshiTicker = venues?.kalshi?.ticker;
  if (kalshiTicker && venueData?.kalshi?.marketByTicker?.has(String(kalshiTicker))) {
    const kalshi = venueData.kalshi.marketByTicker.get(String(kalshiTicker));
    quotes.push({
      venue: "kalshi",
      key: String(kalshiTicker),
      yesBid: kalshi.yesBid,
      yesAsk: kalshi.yesAsk,
      yesMid: kalshi.yesMid,
    });
  }

  const pnpMarketId = venues?.pnp?.marketId;
  if (pnpMarketId && venueData?.pnp?.quoteByMarketId?.has(String(pnpMarketId))) {
    const pnp = venueData.pnp.quoteByMarketId.get(String(pnpMarketId));
    quotes.push({
      venue: "pnp",
      key: String(pnpMarketId),
      yesBid: pnp.yesBid ?? null,
      yesAsk: pnp.yesAsk ?? null,
      yesMid: pnp.yesMid ?? null,
      error: pnp.error ?? null,
    });
  }

  return quotes;
}

function evaluatePair(pair, quotes) {
  const validBids = quotes.filter((q) => q.yesBid !== null && q.yesBid > 0);
  const validAsks = quotes.filter((q) => q.yesAsk !== null && q.yesAsk > 0);

  if (validBids.length === 0 || validAsks.length === 0) {
    return {
      pairId: pair.id,
      question: pair.question ?? null,
      minSpreadToTrade: parseMaybeNumber(pair.minSpreadToTrade) ?? 0.02,
      quotes,
      actionable: false,
      reason: "insufficient_liquidity_quotes",
    };
  }

  const bestBuy = validAsks.reduce((best, current) => (current.yesAsk < best.yesAsk ? current : best));
  const bestSell = validBids.reduce((best, current) => (current.yesBid > best.yesBid ? current : best));
  const spread = bestSell.yesBid - bestBuy.yesAsk;
  const minSpreadToTrade = parseMaybeNumber(pair.minSpreadToTrade) ?? 0.02;

  return {
    pairId: pair.id,
    question: pair.question ?? null,
    minSpreadToTrade,
    quotes,
    bestBuy,
    bestSell,
    spread,
    actionable: spread >= minSpreadToTrade && bestBuy.venue !== bestSell.venue,
    reason:
      spread < minSpreadToTrade
        ? "spread_below_threshold"
        : bestBuy.venue === bestSell.venue
          ? "single_venue_only"
          : "ok",
  };
}

function createLogPath() {
  const logDir = getEnv("PREDICTION_BOT_LOG_DIR", ".artifacts/prediction-bot");
  const day = new Date().toISOString().slice(0, 10);
  return resolve(logDir, `opportunity-scan-${day}.jsonl`);
}

async function persistLog(record) {
  const path = createLogPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function runOnce(cycle) {
  const watchlist = await loadWatchlist();

  const venueData = {};
  const venueErrors = {};

  for (const task of [
    ["dflow", fetchDflowMarkets],
    ["gemini", fetchGeminiContracts],
    ["kalshi", fetchKalshiMarkets],
  ]) {
    const [name, fn] = task;
    try {
      venueData[name] = await fn();
    } catch (error) {
      venueErrors[name] = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    venueData.pnp = await fetchPnpQuotesForWatchlist(watchlist.pairs);
  } catch (error) {
    venueErrors.pnp = error instanceof Error ? error.message : String(error);
  }

  const evaluations = watchlist.pairs.map((pair) =>
    evaluatePair(pair, collectVenueQuotesForPair(pair, venueData)),
  );

  const opportunities = evaluations
    .filter((entry) => entry.actionable)
    .sort((a, b) => b.spread - a.spread);

  const summary = {
    cycle,
    timestamp: new Date().toISOString(),
    watchlistPath: watchlist.path,
    watchlistPairs: watchlist.pairs.length,
    venueStats: {
      dflow: venueData?.dflow
        ? { events: venueData.dflow.events, markets: venueData.dflow.markets }
        : null,
      gemini: venueData?.gemini
        ? { events: venueData.gemini.events, contracts: venueData.gemini.contracts }
        : null,
      kalshi: venueData?.kalshi ? { markets: venueData.kalshi.markets } : null,
      pnp: venueData?.pnp ? { quotes: venueData.pnp.quotes, warning: venueData.pnp.warning ?? null } : null,
    },
    venueErrors,
    opportunities,
    topCandidates: evaluations
      .filter((entry) => entry.bestBuy && entry.bestSell)
      .sort((a, b) => (b.spread ?? -Infinity) - (a.spread ?? -Infinity))
      .slice(0, 10),
  };

  console.log(JSON.stringify(summary, null, 2));
  await persistLog(summary);
}

async function main() {
  const runOnceOnly = getArgFlag("--once") || !getArgFlag("--loop");
  const intervalMs = getNumberEnv("PREDICTION_SCAN_INTERVAL_MS", 30_000);

  let cycle = 0;
  while (true) {
    cycle += 1;
    try {
      await runOnce(cycle);
    } catch (error) {
      const failure = {
        cycle,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      console.error(JSON.stringify(failure, null, 2));
      await persistLog(failure);
    }

    if (runOnceOnly) {
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
