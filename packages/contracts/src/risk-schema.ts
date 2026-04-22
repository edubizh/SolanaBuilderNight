import { z } from "zod";

export const riskDecisionSchema = z.object({
  intent_id: z.uuid(),
  trace_id: z.string().min(1),
  decision: z.enum(["approved", "rejected", "downsized"]),
  reason_codes: z.array(z.string().min(1)),
  max_notional_usd: z.number().nonnegative(),
  max_exposure_market_usd: z.number().nonnegative(),
  max_exposure_venue_usd: z.number().nonnegative(),
  created_at_ms: z.number().int().nonnegative(),
});

export const circuitBreakerStateSchema = z.object({
  breaker_code: z.string().min(1),
  active: z.boolean(),
  severity: z.enum(["warning", "critical"]),
  trigger_count: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export type RiskDecision = z.infer<typeof riskDecisionSchema>;
export type CircuitBreakerState = z.infer<typeof circuitBreakerStateSchema>;
