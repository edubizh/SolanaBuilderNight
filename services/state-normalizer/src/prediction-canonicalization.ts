import { createHash } from "node:crypto";

export type PredictionVenue = "dflow" | "gemini" | "pnp";
export type PredictionDeterministicIdVersion = "v1";
export type PredictionEventState = "scheduled" | "live" | "closed" | "resolved" | "cancelled";
export type PredictionMarketType = "binary" | "multi_outcome" | "scalar";
export type PredictionOutcomeSide = "yes" | "no" | "long" | "short" | "over" | "under" | "custom";
export type QuoteFreshnessTier = "realtime" | "fresh" | "stale" | "expired";
export type QuoteIntegrityStatus =
  | "ok"
  | "crossed_book"
  | "outlier"
  | "stale_rejected"
  | "insufficient_depth"
  | "venue_unavailable";
export type QuoteConfidenceTier = "high" | "medium" | "low" | "unknown";

export interface PredictionCanonicalMapping {
  id_version: PredictionDeterministicIdVersion;
  venue: PredictionVenue;
  venue_event_id: string;
  venue_market_id: string;
  venue_outcome_id?: string;
  canonical_event_id: string;
  canonical_market_id: string;
  canonical_outcome_id?: string;
  event_state?: PredictionEventState;
  market_type?: PredictionMarketType;
  outcome_side?: PredictionOutcomeSide;
}

export interface PredictionQuoteQualityMetadata {
  freshness_tier: QuoteFreshnessTier;
  integrity_status: QuoteIntegrityStatus;
  confidence_tier: QuoteConfidenceTier;
  spread_bps?: number;
  depth_score?: number;
  stale_by_ms?: number;
}

export interface PredictionCanonicalizationInput {
  venue: PredictionVenue;
  venueEventId: string;
  venueMarketId: string;
  venueOutcomeId?: string;
  eventTitle: string;
  marketQuestion: string;
  outcomeLabel?: string;
  eventStartMs?: number;
  eventState?: PredictionEventState;
  marketType?: PredictionMarketType;
  outcomeSide?: PredictionOutcomeSide;
}

export interface PredictionQuoteInput {
  observedAtMs: number;
  nowMs: number;
  bidPrice?: number;
  askPrice?: number;
  confidenceRatio?: number;
  depthScore?: number;
  venueAvailable?: boolean;
  maxAllowedStaleMs?: number;
}

export function buildPredictionCanonicalMapping(
  input: PredictionCanonicalizationInput
): PredictionCanonicalMapping {
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

export function assessPredictionQuoteIntegrity(
  input: PredictionQuoteInput
): PredictionQuoteQualityMetadata {
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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTimestampToken(epochMs: number | undefined): string {
  if (!epochMs || !Number.isFinite(epochMs) || epochMs <= 0) {
    return "unknown_time";
  }
  return `t${Math.trunc(epochMs)}`;
}

function hashFingerprint(fingerprint: string): string {
  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
}

function classifyFreshness(staleByMs: number): QuoteFreshnessTier {
  if (staleByMs <= 1_500) {
    return "realtime";
  }
  if (staleByMs <= 10_000) {
    return "fresh";
  }
  if (staleByMs <= 60_000) {
    return "stale";
  }
  return "expired";
}

function classifyIntegrity(input: PredictionQuoteInput, staleByMs: number): QuoteIntegrityStatus {
  if (input.venueAvailable === false) {
    return "venue_unavailable";
  }

  if (
    (input.bidPrice !== undefined && !isPredictionBounded(input.bidPrice)) ||
    (input.askPrice !== undefined && !isPredictionBounded(input.askPrice))
  ) {
    return "outlier";
  }

  if (
    input.bidPrice !== undefined &&
    input.askPrice !== undefined &&
    Number.isFinite(input.bidPrice) &&
    Number.isFinite(input.askPrice) &&
    input.askPrice < input.bidPrice
  ) {
    return "crossed_book";
  }

  if (input.depthScore !== undefined && input.depthScore < 0.1) {
    return "insufficient_depth";
  }

  const maxAllowedStaleMs = input.maxAllowedStaleMs ?? 60_000;
  if (staleByMs > maxAllowedStaleMs) {
    return "stale_rejected";
  }

  return "ok";
}

function classifyConfidenceTier(confidenceRatio: number | undefined): QuoteConfidenceTier {
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

function computeSpreadBps(bidPrice: number | undefined, askPrice: number | undefined): number | undefined {
  if (
    bidPrice === undefined ||
    askPrice === undefined ||
    !Number.isFinite(bidPrice) ||
    !Number.isFinite(askPrice)
  ) {
    return undefined;
  }

  const midpoint = (bidPrice + askPrice) / 2;
  if (midpoint <= 0) {
    return undefined;
  }

  return ((askPrice - bidPrice) / midpoint) * 10_000;
}

function isPredictionBounded(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
