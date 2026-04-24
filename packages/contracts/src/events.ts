import { z } from "zod";
import {
  canonicalPredictionEventIdSchema,
  canonicalPredictionMarketIdSchema,
  predictionOutcomeSideSchema,
  predictionQuoteQualityMetadataSchema,
  predictionVenueSchema,
} from "./prediction-schema.js";

export const eventNameSchema = z.enum([
  "market_data_updated",
  "opportunity_computed",
  "risk_decision_emitted",
  "execution_intent_dispatched",
  "execution_terminal_state",
  "position_reconciled",
  "circuit_breaker_triggered",
]);

export const eventEnvelopeSchema = z.object({
  event_id: z.uuid(),
  intent_id: z.uuid().optional(),
  trace_id: z.string().min(1),
  source_service: z.string().min(1),
  created_at_ms: z.number().int().nonnegative(),
  event_name: eventNameSchema,
  version: z.string().min(1).default("0.1.0"),
});

export const marketDataUpdatedPayloadSchema = z.object({
  venue: predictionVenueSchema,
  market_symbol: z.string().min(1),
  quote_timestamp_ms: z.number().int().nonnegative(),
  oracle_timestamp_ms: z.number().int().nonnegative().optional(),
  bid_price: z.number().finite().optional(),
  ask_price: z.number().finite().optional(),
  mid_price: z.number().finite().optional(),
  confidence_ratio: z.number().nonnegative().optional(),
  staleness_ms: z.number().int().nonnegative(),
  canonical_event_id: canonicalPredictionEventIdSchema.optional(),
  canonical_market_id: canonicalPredictionMarketIdSchema.optional(),
  outcome_side: predictionOutcomeSideSchema.optional(),
  quote_quality: predictionQuoteQualityMetadataSchema.optional(),
});

export const opportunityComputedPayloadSchema = z.object({
  strategy_mode: z.enum(["conservative", "balanced", "aggressive"]),
  edge_net: z.number().finite(),
  expected_value_usd: z.number().finite(),
  rank: z.number().int().positive(),
});

export const riskDecisionPayloadSchema = z.object({
  decision: z.enum(["approved", "rejected", "downsized"]),
  reason_codes: z.array(z.string().min(1)).default([]),
  max_notional_usd: z.number().nonnegative(),
});

export const executionIntentPayloadSchema = z.object({
  venue: predictionVenueSchema,
  operation: z.string().min(1),
  requested_notional_usd: z.number().positive(),
  idempotency_key: z.string().min(1),
});

export const executionTerminalStatePayloadSchema = z.object({
  terminal_state: z.enum(["landed", "failed", "expired", "cancelled"]),
  signature: z.string().min(1).optional(),
  failure_category: z.string().min(1).optional(),
  finalized_at_ms: z.number().int().nonnegative(),
});

export const positionReconciledPayloadSchema = z.object({
  position_id: z.string().min(1),
  reconciliation_state: z.enum(["matched", "drift_detected", "resolved"]),
  drift_usd: z.number().finite(),
  resolved_at_ms: z.number().int().nonnegative().optional(),
});

export const circuitBreakerTriggeredPayloadSchema = z.object({
  breaker_code: z.string().min(1),
  severity: z.enum(["warning", "critical"]),
  trigger_reason: z.string().min(1),
  halt_trading: z.boolean(),
});

export const domainEventSchemaMap = {
  market_data_updated: marketDataUpdatedPayloadSchema,
  opportunity_computed: opportunityComputedPayloadSchema,
  risk_decision_emitted: riskDecisionPayloadSchema,
  execution_intent_dispatched: executionIntentPayloadSchema,
  execution_terminal_state: executionTerminalStatePayloadSchema,
  position_reconciled: positionReconciledPayloadSchema,
  circuit_breaker_triggered: circuitBreakerTriggeredPayloadSchema,
} as const;

export const canonicalEventSchema = z.discriminatedUnion("event_name", [
  eventEnvelopeSchema.extend({
    event_name: z.literal("market_data_updated"),
    payload: marketDataUpdatedPayloadSchema,
  }),
  eventEnvelopeSchema.extend({
    event_name: z.literal("opportunity_computed"),
    payload: opportunityComputedPayloadSchema,
  }),
  eventEnvelopeSchema.extend({
    event_name: z.literal("risk_decision_emitted"),
    payload: riskDecisionPayloadSchema,
  }),
  eventEnvelopeSchema.extend({
    event_name: z.literal("execution_intent_dispatched"),
    payload: executionIntentPayloadSchema,
  }),
  eventEnvelopeSchema.extend({
    event_name: z.literal("execution_terminal_state"),
    payload: executionTerminalStatePayloadSchema,
  }),
  eventEnvelopeSchema.extend({
    event_name: z.literal("position_reconciled"),
    payload: positionReconciledPayloadSchema,
  }),
  eventEnvelopeSchema.extend({
    event_name: z.literal("circuit_breaker_triggered"),
    payload: circuitBreakerTriggeredPayloadSchema,
  }),
]);

export type EventName = z.infer<typeof eventNameSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
