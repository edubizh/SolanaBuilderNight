/**
 * Must stay aligned with `PreCanonicalPredictionQuote` in
 * `services/state-normalizer/src/normalize-prediction-quotes.ts` (ingestion is built with `rootDir: src`).
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
  maxAllowedStaleMs?: number;
}

export interface PnpRawQuoteMapInput {
  canonicalEventId: string;
  canonicalMarketId: string;
  marketId: string;
  /** Mid or executable price in [0, 1] */
  price: number;
  /** Epoch ms for observation; falls back to `nowMs` when missing (caller-provided). */
  observedAtMs: number;
}

/**
 * PNP `getQuote` returns a single price; model a tight two-sided book around mid for pre-canonical feed.
 */
export function mapPnpQuoteToPreCanonical(input: PnpRawQuoteMapInput): PreCanonicalPredictionQuote {
  const half = 0.0005;
  const bid = Math.max(0, input.price - half);
  const ask = Math.min(1, input.price + half);
  return {
    canonicalEventId: input.canonicalEventId,
    canonicalMarketId: input.canonicalMarketId,
    venue: "pnp",
    venueMarketId: input.marketId,
    yesBidPrice: bid,
    yesAskPrice: ask,
    observedAtMs: input.observedAtMs
  };
}

export interface DflowRawQuoteMapInput {
  canonicalEventId: string;
  canonicalMarketId: string;
  marketTicker: string;
  yesBid: number;
  yesAsk: number;
  observedAtMs: number;
}

export function mapDflowQuoteToPreCanonical(input: DflowRawQuoteMapInput): PreCanonicalPredictionQuote {
  return {
    canonicalEventId: input.canonicalEventId,
    canonicalMarketId: input.canonicalMarketId,
    venue: "dflow",
    venueMarketId: input.marketTicker,
    yesBidPrice: input.yesBid,
    yesAskPrice: input.yesAsk,
    observedAtMs: input.observedAtMs
  };
}

export interface GeminiRawQuoteMapInput {
  canonicalEventId: string;
  canonicalMarketId: string;
  instrumentSymbol: string;
  yesBid: number;
  yesAsk: number;
  observedAtMs: number;
}

export function mapGeminiQuoteToPreCanonical(input: GeminiRawQuoteMapInput): PreCanonicalPredictionQuote {
  return {
    canonicalEventId: input.canonicalEventId,
    canonicalMarketId: input.canonicalMarketId,
    venue: "gemini",
    venueMarketId: input.instrumentSymbol,
    yesBidPrice: input.yesBid,
    yesAskPrice: input.yesAsk,
    observedAtMs: input.observedAtMs
  };
}
