import { createHash } from "node:crypto";

/**
 * @typedef {"realtime" | "fresh" | "stale" | "expired"} QuoteFreshnessTier
 * @typedef {"ok" | "crossed_book" | "outlier" | "stale_rejected" | "insufficient_depth" | "venue_unavailable"} QuoteIntegrityStatus
 *
 * @typedef {Object} CanonicalQuoteInput
 * @property {string} traceId
 * @property {string} canonicalEventId
 * @property {string} canonicalMarketId
 * @property {string} venue
 * @property {string} venueMarketId
 * @property {number} yesBidPrice
 * @property {number} yesAskPrice
 * @property {number} observedAtMs
 * @property {QuoteFreshnessTier} freshnessTier
 * @property {QuoteIntegrityStatus} integrityStatus
 * @property {number} [spreadBps]
 *
 * @typedef {Object} PaperArbLoopOptions
 * @property {number} [minSpreadToTrade]
 * @property {number} [tradeNotionalUsd]
 * @property {"paper_only" | "live"} [executionMode]
 * @property {number} [nowMs]
 *
 * @typedef {Object} SpreadToIntentArtifact
 * @property {string} intentId
 * @property {string} traceId
 * @property {string} canonicalEventId
 * @property {string} canonicalMarketId
 * @property {string} buyVenue
 * @property {string} buyVenueMarketId
 * @property {number} buyYesAsk
 * @property {string} sellVenue
 * @property {string} sellVenueMarketId
 * @property {number} sellYesBid
 * @property {number} spread
 * @property {number} spreadBps
 * @property {number} expectedValueUsd
 * @property {number} tradeNotionalUsd
 * @property {"paper_only"} executionMode
 * @property {{ required: true, passed: true, reason: string }} noNakedExposure
 * @property {number} createdAtMs
 *
 * @typedef {Object} PaperDecisionLog
 * @property {string} traceId
 * @property {string} canonicalMarketId
 * @property {"accepted" | "rejected"} decision
 * @property {string[]} reasons
 * @property {number} createdAtMs
 * @property {{ required: true, passed: boolean, reason: string }} noNakedExposure
 * @property {number | null} expectedNetUsd
 *
 * @typedef {Object} OpportunityQualityTelemetry
 * @property {{ accepted: number, skipped: number, total: number }} totals
 * @property {Record<string, number>} acceptedByReason
 * @property {Record<string, number>} skippedByReason
 * @property {{
 *   accepted: { count: number, min: number | null, max: number | null, avg: number | null, buckets: Record<string, number> },
 *   skipped: { count: number, min: number | null, max: number | null, avg: number | null, buckets: Record<string, number> }
 * }} expectedNetDistributions
 *
 * @typedef {Object} OperationalSnapshot
 * @property {number} generatedAtMs
 * @property {number} minSpreadToTrade
 * @property {number} tradeNotionalUsd
 * @property {"paper_only" | "live"} requestedExecutionMode
 * @property {OpportunityQualityTelemetry} telemetry
 * @property {PaperDecisionLog[]} decisions
 */

/**
 * @param {ReadonlyArray<CanonicalQuoteInput>} inputs
 * @param {PaperArbLoopOptions} [options]
 * @returns {{ intents: SpreadToIntentArtifact[], decisionLogs: PaperDecisionLog[], telemetry: OpportunityQualityTelemetry }}
 */
export function runPaperArbitrageLoop(inputs, options = {}) {
  const executionMode = options.executionMode ?? "paper_only";
  const nowMs = options.nowMs ?? Date.now();
  const minSpreadToTrade = options.minSpreadToTrade ?? 0.01;
  const tradeNotionalUsd = options.tradeNotionalUsd ?? 100;

  const groups = groupByMarket(normalizeInputs(inputs));
  const intents = [];
  const decisionLogs = [];

  const orderedMarketIds = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const canonicalMarketId of orderedMarketIds) {
    const quotes = groups.get(canonicalMarketId) ?? [];
    const traceId = quotes[0]?.traceId ?? "trace-missing";
    const canonicalEventId = quotes[0]?.canonicalEventId ?? "event-missing";
    const reasons = [];

    if (executionMode !== "paper_only") {
      reasons.push("execution_mode_not_paper_only");
    }

    const validQuotes = quotes
      .filter((quote) => quote.integrityStatus === "ok")
      .filter((quote) => quote.freshnessTier === "realtime" || quote.freshnessTier === "fresh")
      .sort((a, b) => compareQuotes(a, b));

    if (validQuotes.length < 2) {
      reasons.push("insufficient_integrity_valid_quotes");
    }

    const buyLeg = [...validQuotes].sort((a, b) => a.yesAskPrice - b.yesAskPrice || compareQuotes(a, b))[0];
    const sellLeg = [...validQuotes].sort((a, b) => b.yesBidPrice - a.yesBidPrice || compareQuotes(a, b))[0];

    const hasTwoSided = Boolean(buyLeg && sellLeg && buyLeg.venue !== sellLeg.venue);
    if (!hasTwoSided) {
      reasons.push("no_cross_venue_two_sided_legs");
    }

    const spread = hasTwoSided ? sellLeg.yesBidPrice - buyLeg.yesAskPrice : Number.NEGATIVE_INFINITY;
    if (!(spread >= minSpreadToTrade)) {
      reasons.push("spread_below_threshold");
    }

    const noNakedExposure = {
      required: true,
      passed: reasons.length === 0,
      reason: reasons.length === 0 ? "paired_buy_and_sell_legs_confirmed" : "paired_legs_missing_or_non_actionable",
    };

    if (reasons.length > 0) {
      decisionLogs.push({
        traceId,
        canonicalMarketId,
        decision: "rejected",
        reasons: reasons.sort(),
        createdAtMs: nowMs,
        noNakedExposure,
        expectedNetUsd: null,
      });
      continue;
    }

    const spreadBps = Number((((spread / buyLeg.yesAskPrice) * 10_000) || 0).toFixed(6));
    const expectedValueUsd = Number((spread * tradeNotionalUsd).toFixed(6));
    const intentId = buildIntentId({
      traceId,
      canonicalMarketId,
      buyVenue: buyLeg.venue,
      sellVenue: sellLeg.venue,
      buyYesAsk: buyLeg.yesAskPrice,
      sellYesBid: sellLeg.yesBidPrice,
      createdAtMs: nowMs,
    });

    intents.push({
      intentId,
      traceId,
      canonicalEventId,
      canonicalMarketId,
      buyVenue: buyLeg.venue,
      buyVenueMarketId: buyLeg.venueMarketId,
      buyYesAsk: buyLeg.yesAskPrice,
      sellVenue: sellLeg.venue,
      sellVenueMarketId: sellLeg.venueMarketId,
      sellYesBid: sellLeg.yesBidPrice,
      spread,
      spreadBps,
      expectedValueUsd,
      tradeNotionalUsd,
      executionMode: "paper_only",
      noNakedExposure: {
        required: true,
        passed: true,
        reason: "paired_buy_and_sell_legs_confirmed",
      },
      createdAtMs: nowMs,
    });

    decisionLogs.push({
      traceId,
      canonicalMarketId,
      decision: "accepted",
      reasons: ["spread_actionable_and_paper_safe"],
      createdAtMs: nowMs,
      noNakedExposure: {
        required: true,
        passed: true,
        reason: "paired_buy_and_sell_legs_confirmed",
      },
      expectedNetUsd: expectedValueUsd,
    });
  }

  intents.sort((a, b) => b.spread - a.spread || a.canonicalMarketId.localeCompare(b.canonicalMarketId));
  decisionLogs.sort((a, b) => a.canonicalMarketId.localeCompare(b.canonicalMarketId));
  return { intents, decisionLogs, telemetry: buildOpportunityQualityTelemetry(decisionLogs) };
}

/**
 * @param {{
 *   intents: SpreadToIntentArtifact[],
 *   decisionLogs: PaperDecisionLog[],
 *   telemetry: OpportunityQualityTelemetry
 * }} result
 * @param {PaperArbLoopOptions} [options]
 * @returns {OperationalSnapshot}
 */
export function buildOperationalSnapshot(result, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const minSpreadToTrade = options.minSpreadToTrade ?? 0.01;
  const tradeNotionalUsd = options.tradeNotionalUsd ?? 100;
  const requestedExecutionMode = options.executionMode ?? "paper_only";
  return {
    generatedAtMs: nowMs,
    minSpreadToTrade,
    tradeNotionalUsd,
    requestedExecutionMode,
    telemetry: result.telemetry,
    decisions: result.decisionLogs,
  };
}

/**
 * @param {OperationalSnapshot} snapshot
 * @returns {string}
 */
export function serializeOperationalSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * @param {PaperDecisionLog[]} decisionLogs
 * @returns {OpportunityQualityTelemetry}
 */
function buildOpportunityQualityTelemetry(decisionLogs) {
  /** @type {Record<string, number>} */
  const acceptedByReason = {};
  /** @type {Record<string, number>} */
  const skippedByReason = {};
  const acceptedExpectedNet = [];
  const skippedExpectedNet = [];

  for (const decisionLog of decisionLogs) {
    const bucket = decisionLog.decision === "accepted" ? acceptedByReason : skippedByReason;
    for (const reason of decisionLog.reasons) {
      bucket[reason] = (bucket[reason] ?? 0) + 1;
    }

    if (decisionLog.expectedNetUsd !== null) {
      if (decisionLog.decision === "accepted") {
        acceptedExpectedNet.push(decisionLog.expectedNetUsd);
      } else {
        skippedExpectedNet.push(decisionLog.expectedNetUsd);
      }
    }
  }

  return {
    totals: {
      accepted: decisionLogs.filter((entry) => entry.decision === "accepted").length,
      skipped: decisionLogs.filter((entry) => entry.decision === "rejected").length,
      total: decisionLogs.length,
    },
    acceptedByReason: sortRecordKeys(acceptedByReason),
    skippedByReason: sortRecordKeys(skippedByReason),
    expectedNetDistributions: {
      accepted: summarizeExpectedNetDistribution(acceptedExpectedNet),
      skipped: summarizeExpectedNetDistribution(skippedExpectedNet),
    },
  };
}

/**
 * @param {Record<string, number>} value
 * @returns {Record<string, number>}
 */
function sortRecordKeys(value) {
  /** @type {Record<string, number>} */
  const result = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    result[key] = value[key];
  }
  return result;
}

/**
 * @param {number[]} expectedNetValues
 * @returns {{ count: number, min: number | null, max: number | null, avg: number | null, buckets: Record<string, number> }}
 */
function summarizeExpectedNetDistribution(expectedNetValues) {
  const buckets = {
    negative: 0,
    low: 0,
    medium: 0,
    high: 0,
    very_high: 0,
  };

  for (const expectedNet of expectedNetValues) {
    if (expectedNet < 0) {
      buckets.negative += 1;
    } else if (expectedNet < 2) {
      buckets.low += 1;
    } else if (expectedNet < 5) {
      buckets.medium += 1;
    } else if (expectedNet < 10) {
      buckets.high += 1;
    } else {
      buckets.very_high += 1;
    }
  }

  if (expectedNetValues.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
      buckets,
    };
  }

  const min = Math.min(...expectedNetValues);
  const max = Math.max(...expectedNetValues);
  const avg = expectedNetValues.reduce((sum, value) => sum + value, 0) / expectedNetValues.length;

  return {
    count: expectedNetValues.length,
    min: Number(min.toFixed(6)),
    max: Number(max.toFixed(6)),
    avg: Number(avg.toFixed(6)),
    buckets,
  };
}

/**
 * @param {ReadonlyArray<CanonicalQuoteInput>} inputs
 * @returns {CanonicalQuoteInput[]}
 */
function normalizeInputs(inputs) {
  return [...inputs]
    .map((item) => ({
      ...item,
      traceId: String(item.traceId),
      canonicalEventId: String(item.canonicalEventId),
      canonicalMarketId: String(item.canonicalMarketId),
      venue: String(item.venue),
      venueMarketId: String(item.venueMarketId),
      yesBidPrice: toFinite(item.yesBidPrice, "yesBidPrice"),
      yesAskPrice: toFinite(item.yesAskPrice, "yesAskPrice"),
      observedAtMs: toFinite(item.observedAtMs, "observedAtMs"),
      freshnessTier: item.freshnessTier,
      integrityStatus: item.integrityStatus,
    }))
    .sort(compareQuotes);
}

/**
 * @param {CanonicalQuoteInput} a
 * @param {CanonicalQuoteInput} b
 * @returns {number}
 */
function compareQuotes(a, b) {
  if (a.canonicalMarketId !== b.canonicalMarketId) {
    return a.canonicalMarketId.localeCompare(b.canonicalMarketId);
  }
  if (a.venue !== b.venue) {
    return a.venue.localeCompare(b.venue);
  }
  if (a.venueMarketId !== b.venueMarketId) {
    return a.venueMarketId.localeCompare(b.venueMarketId);
  }
  return a.observedAtMs - b.observedAtMs;
}

/**
 * @param {CanonicalQuoteInput[]} inputs
 * @returns {Map<string, CanonicalQuoteInput[]>}
 */
function groupByMarket(inputs) {
  const grouped = new Map();
  for (const quote of inputs) {
    const existing = grouped.get(quote.canonicalMarketId);
    if (existing) {
      existing.push(quote);
    } else {
      grouped.set(quote.canonicalMarketId, [quote]);
    }
  }
  return grouped;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function toFinite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Expected ${field} to be a finite number.`);
  }
  return value;
}

/**
 * @param {{
 *   traceId: string;
 *   canonicalMarketId: string;
 *   buyVenue: string;
 *   sellVenue: string;
 *   buyYesAsk: number;
 *   sellYesBid: number;
 *   createdAtMs: number;
 * }} value
 * @returns {string}
 */
function buildIntentId(value) {
  const fingerprint = [
    value.traceId,
    value.canonicalMarketId,
    value.buyVenue,
    value.sellVenue,
    value.buyYesAsk.toFixed(8),
    value.sellYesBid.toFixed(8),
    String(value.createdAtMs),
  ].join("|");
  return `paper_intent_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 20)}`;
}
