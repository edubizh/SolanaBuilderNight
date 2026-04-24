import { assessPredictionQuoteIntegrity } from "./prediction-canonicalization.ts";
import type { QuoteFreshnessTier, QuoteIntegrityStatus } from "./prediction-canonicalization.ts";

/**
 * One venue quote already aligned to canonical event/market ids (e.g. from watchlist + venue mapper).
 * Yes-side bid/ask in probability space [0, 1].
 */
export interface PreCanonicalPredictionQuote {
  canonicalEventId: string;
  canonicalMarketId: string;
  venue: string;
  venueMarketId: string;
  yesBidPrice: number;
  yesAskPrice: number;
  observedAtMs: number;
  confidenceRatio?: number;
  depthScore?: number;
  venueAvailable?: boolean;
  /** When set, overrides default for integrity stale rejection (ms since observation). */
  maxAllowedStaleMs?: number;
}

export interface NormalizePredictionQuotesInput {
  nowMs: number;
  /**
   * Quotes grouped by venue key (e.g. dflow, gemini, pnp). Values are concatenated in stable venue-key order.
   */
  rawQuotesByVenue: Record<string, PreCanonicalPredictionQuote[] | undefined | null>;
}

/** Aligns with `CanonicalQuoteInput` in `paperArbLoop.js` (opportunity-engine). */
export interface CanonicalQuoteInput {
  traceId: string;
  canonicalEventId: string;
  canonicalMarketId: string;
  venue: string;
  venueMarketId: string;
  yesBidPrice: number;
  yesAskPrice: number;
  observedAtMs: number;
  freshnessTier: QuoteFreshnessTier;
  integrityStatus: QuoteIntegrityStatus;
  spreadBps?: number;
}

const VENUE_KEY_ORDER = ["dflow", "gemini", "kalshi", "pnp"] as const;

function flattenQuotes(raw: Record<string, PreCanonicalPredictionQuote[] | undefined | null>): PreCanonicalPredictionQuote[] {
  const out: PreCanonicalPredictionQuote[] = [];
  const keys = new Set<string>([...Object.keys(raw), ...VENUE_KEY_ORDER]);
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
export function buildPredictionQuoteTraceId(canonicalMarketId: string, venue: string, observedAtMs: number): string {
  return `trace_${canonicalMarketId}_${venue}_${observedAtMs}`;
}

/**
 * Map grouped raw quotes to {@link CanonicalQuoteInput} for `runPaperArbitrageLoop`.
 */
export function normalizePredictionQuotes(input: NormalizePredictionQuotesInput): CanonicalQuoteInput[] {
  const { nowMs } = input;
  const flat = flattenQuotes(input.rawQuotesByVenue);
  const result: CanonicalQuoteInput[] = [];

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
