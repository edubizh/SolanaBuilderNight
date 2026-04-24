import { createHash } from "node:crypto";
export function buildPredictionCanonicalMapping(input) {
    const eventFingerprint = [
        normalizeText(input.eventTitle),
        normalizeTimestampToken(input.eventStartMs)
    ].join("|");
    const marketFingerprint = [eventFingerprint, normalizeText(input.marketQuestion)].join("|");
    const outcomeFingerprint = input.outcomeLabel
        ? [marketFingerprint, normalizeText(input.outcomeLabel)].join("|")
        : undefined;
    return {
        id_version: "v1",
        venue: input.venue,
        venue_event_id: input.venueEventId,
        venue_market_id: input.venueMarketId,
        venue_outcome_id: input.venueOutcomeId,
        canonical_event_id: `pm_evt_v1_${hashFingerprint(eventFingerprint)}`,
        canonical_market_id: `pm_mkt_v1_${hashFingerprint(marketFingerprint)}`,
        canonical_outcome_id: outcomeFingerprint ? `pm_out_v1_${hashFingerprint(outcomeFingerprint)}` : undefined,
        event_state: input.eventState,
        market_type: input.marketType,
        outcome_side: input.outcomeSide
    };
}
export function assessPredictionQuoteIntegrity(input) {
    const staleByMs = Math.max(0, input.nowMs - input.observedAtMs);
    const freshnessTier = classifyFreshness(staleByMs);
    const integrityStatus = classifyIntegrity(input, staleByMs);
    return {
        freshness_tier: freshnessTier,
        integrity_status: integrityStatus,
        confidence_tier: classifyConfidenceTier(input.confidenceRatio),
        spread_bps: computeSpreadBps(input.bidPrice, input.askPrice),
        depth_score: input.depthScore,
        stale_by_ms: staleByMs
    };
}
function normalizeText(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeTimestampToken(epochMs) {
    if (!epochMs || !Number.isFinite(epochMs) || epochMs <= 0) {
        return "unknown_time";
    }
    return `t${Math.trunc(epochMs)}`;
}
function hashFingerprint(fingerprint) {
    return createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
}
/** PM-R-005: 5s realtime, 30s fresh, 5m stale, else expired. */
const FRESHNESS_REALTIME_MS = 5_000;
const FRESHNESS_FRESH_MS = 30_000;
const FRESHNESS_STALE_MS = 300_000;
function classifyFreshness(staleByMs) {
    if (staleByMs <= FRESHNESS_REALTIME_MS) {
        return "realtime";
    }
    if (staleByMs <= FRESHNESS_FRESH_MS) {
        return "fresh";
    }
    if (staleByMs <= FRESHNESS_STALE_MS) {
        return "stale";
    }
    return "expired";
}
function classifyIntegrity(input, staleByMs) {
    if (input.venueAvailable === false) {
        return "venue_unavailable";
    }
    if ((input.bidPrice !== undefined && !isPredictionBounded(input.bidPrice)) ||
        (input.askPrice !== undefined && !isPredictionBounded(input.askPrice))) {
        return "outlier";
    }
    if (input.bidPrice !== undefined &&
        input.askPrice !== undefined &&
        Number.isFinite(input.bidPrice) &&
        Number.isFinite(input.askPrice) &&
        input.askPrice < input.bidPrice) {
        return "crossed_book";
    }
    if (input.depthScore !== undefined && input.depthScore < 0.1) {
        return "insufficient_depth";
    }
    const maxAllowedStaleMs = input.maxAllowedStaleMs ?? FRESHNESS_STALE_MS;
    if (staleByMs > maxAllowedStaleMs) {
        return "stale_rejected";
    }
    return "ok";
}
function classifyConfidenceTier(confidenceRatio) {
    if (confidenceRatio === undefined || !Number.isFinite(confidenceRatio) || confidenceRatio < 0) {
        return "unknown";
    }
    if (confidenceRatio <= 0.01) {
        return "high";
    }
    if (confidenceRatio <= 0.03) {
        return "medium";
    }
    if (confidenceRatio <= 0.08) {
        return "low";
    }
    return "unknown";
}
function computeSpreadBps(bidPrice, askPrice) {
    if (bidPrice === undefined ||
        askPrice === undefined ||
        !Number.isFinite(bidPrice) ||
        !Number.isFinite(askPrice)) {
        return undefined;
    }
    const midpoint = (bidPrice + askPrice) / 2;
    if (midpoint <= 0) {
        return undefined;
    }
    return ((askPrice - bidPrice) / midpoint) * 10_000;
}
function isPredictionBounded(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1;
}
