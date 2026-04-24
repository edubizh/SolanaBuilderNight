import { z } from "zod";
import {
  canonicalPredictionEventIdSchema,
  canonicalPredictionMarketIdSchema,
  predictionOutcomeSideSchema,
  predictionQuoteQualityMetadataSchema,
  predictionVenueSchema,
} from "./prediction-schema.js";

export const marketSnapshotSchema = z.object({
  venue: predictionVenueSchema,
  market_id: z.string().min(1),
  base_symbol: z.string().min(1),
  quote_symbol: z.string().min(1),
  bid_price: z.number().finite().optional(),
  ask_price: z.number().finite().optional(),
  mid_price: z.number().finite(),
  confidence_ratio: z.number().nonnegative().optional(),
  updated_at_ms: z.number().int().nonnegative(),
  canonical_event_id: canonicalPredictionEventIdSchema.optional(),
  canonical_market_id: canonicalPredictionMarketIdSchema.optional(),
  outcome_side: predictionOutcomeSideSchema.optional(),
  quote_quality: predictionQuoteQualityMetadataSchema.optional(),
});

export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
