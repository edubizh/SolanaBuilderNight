import { assessPredictionQuoteIntegrity } from "./prediction-canonicalization.ts";
const VENUE_KEY_ORDER = ["dflow", "gemini", "kalshi", "pnp"];
function flattenQuotes(raw) {
    const out = [];
    const keys = new Set([...Object.keys(raw), ...VENUE_KEY_ORDER]);
    const ordered = [...keys].sort((a, b) => a.localeCompare(b));
    for (const k of ordered) {
        const list = raw[k];
        if (!Array.isArray(list)) {
            continue;
        }
        for (const item of list) {
            if (item && typeof item === "object") {
                out.push(item);
            }
        }
    }
    return out;
}
/**
 * `trace_${canonicalMarketId}_${venue}_${observedAtMs}` — unique per quote observation.
 */
export function buildPredictionQuoteTraceId(canonicalMarketId, venue, observedAtMs) {
    return `trace_${canonicalMarketId}_${venue}_${observedAtMs}`;
}
/**
 * Map grouped raw quotes to {@link CanonicalQuoteInput} for `runPaperArbitrageLoop`.
 */
export function normalizePredictionQuotes(input) {
    const { nowMs } = input;
    const flat = flattenQuotes(input.rawQuotesByVenue);
    const result = [];
    for (const q of flat) {
        const meta = assessPredictionQuoteIntegrity({
            observedAtMs: q.observedAtMs,
            nowMs,
            bidPrice: q.yesBidPrice,
            askPrice: q.yesAskPrice,
            confidenceRatio: q.confidenceRatio,
            depthScore: q.depthScore,
            venueAvailable: q.venueAvailable,
            maxAllowedStaleMs: q.maxAllowedStaleMs
        });
        const traceId = buildPredictionQuoteTraceId(q.canonicalMarketId, q.venue, q.observedAtMs);
        result.push({
            traceId,
            canonicalEventId: String(q.canonicalEventId),
            canonicalMarketId: String(q.canonicalMarketId),
            venue: String(q.venue),
            venueMarketId: String(q.venueMarketId),
            yesBidPrice: q.yesBidPrice,
            yesAskPrice: q.yesAskPrice,
            observedAtMs: q.observedAtMs,
            freshnessTier: meta.freshness_tier,
            integrityStatus: meta.integrity_status,
            spreadBps: meta.spread_bps
        });
    }
    return result;
}
