import { z } from "zod";

export const predictionVenueSchema = z.enum(["dflow", "gemini", "pnp"]);

export const predictionDeterministicIdVersionSchema = z.enum(["v1"]);

export const canonicalPredictionEventIdSchema = z
  .string()
  .regex(/^pm_evt_v1_[a-z0-9]{8,64}$/);

export const canonicalPredictionMarketIdSchema = z
  .string()
  .regex(/^pm_mkt_v1_[a-z0-9]{8,64}$/);

export const canonicalPredictionOutcomeIdSchema = z
  .string()
  .regex(/^pm_out_v1_[a-z0-9]{8,64}$/);

export const predictionEventStateSchema = z.enum([
  "scheduled",
  "live",
  "closed",
  "resolved",
  "cancelled",
]);

export const predictionMarketTypeSchema = z.enum([
  "binary",
  "multi_outcome",
  "scalar",
]);

export const predictionOutcomeSideSchema = z.enum([
  "yes",
  "no",
  "long",
  "short",
  "over",
  "under",
  "custom",
]);

export const quoteFreshnessTierSchema = z.enum([
  "realtime",
  "fresh",
  "stale",
  "expired",
]);

export const quoteIntegrityStatusSchema = z.enum([
  "ok",
  "crossed_book",
  "outlier",
  "stale_rejected",
  "insufficient_depth",
  "venue_unavailable",
]);

export const quoteConfidenceTierSchema = z.enum([
  "high",
  "medium",
  "low",
  "unknown",
]);

export const predictionQuoteQualityMetadataSchema = z.object({
  freshness_tier: quoteFreshnessTierSchema,
  integrity_status: quoteIntegrityStatusSchema,
  confidence_tier: quoteConfidenceTierSchema,
  spread_bps: z.number().nonnegative().optional(),
  depth_score: z.number().nonnegative().optional(),
  stale_by_ms: z.number().int().nonnegative().optional(),
});

export const predictionCanonicalMappingSchema = z.object({
  id_version: predictionDeterministicIdVersionSchema.default("v1"),
  venue: predictionVenueSchema,
  venue_event_id: z.string().min(1),
  venue_market_id: z.string().min(1),
  venue_outcome_id: z.string().min(1).optional(),
  canonical_event_id: canonicalPredictionEventIdSchema,
  canonical_market_id: canonicalPredictionMarketIdSchema,
  canonical_outcome_id: canonicalPredictionOutcomeIdSchema.optional(),
  event_state: predictionEventStateSchema.optional(),
  market_type: predictionMarketTypeSchema.optional(),
  outcome_side: predictionOutcomeSideSchema.optional(),
});

export type PredictionVenue = z.infer<typeof predictionVenueSchema>;
export type PredictionDeterministicIdVersion = z.infer<
  typeof predictionDeterministicIdVersionSchema
>;
export type CanonicalPredictionEventId = z.infer<
  typeof canonicalPredictionEventIdSchema
>;
export type CanonicalPredictionMarketId = z.infer<
  typeof canonicalPredictionMarketIdSchema
>;
export type CanonicalPredictionOutcomeId = z.infer<
  typeof canonicalPredictionOutcomeIdSchema
>;
export type PredictionEventState = z.infer<typeof predictionEventStateSchema>;
export type PredictionMarketType = z.infer<typeof predictionMarketTypeSchema>;
export type PredictionOutcomeSide = z.infer<typeof predictionOutcomeSideSchema>;
export type QuoteFreshnessTier = z.infer<typeof quoteFreshnessTierSchema>;
export type QuoteIntegrityStatus = z.infer<typeof quoteIntegrityStatusSchema>;
export type QuoteConfidenceTier = z.infer<typeof quoteConfidenceTierSchema>;
export type PredictionQuoteQualityMetadata = z.infer<
  typeof predictionQuoteQualityMetadataSchema
>;
export type PredictionCanonicalMapping = z.infer<
  typeof predictionCanonicalMappingSchema
>;
