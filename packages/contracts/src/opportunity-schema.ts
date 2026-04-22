import { z } from "zod";

export const opportunityIntentSchema = z.object({
  intent_id: z.uuid(),
  trace_id: z.string().min(1),
  strategy_mode: z.enum(["conservative", "balanced", "aggressive"]),
  source_market_id: z.string().min(1),
  target_market_id: z.string().min(1),
  gross_edge: z.number().finite(),
  fee_cost: z.number().finite(),
  slippage_cost: z.number().finite(),
  confidence_penalty: z.number().finite(),
  staleness_penalty: z.number().finite(),
  latency_penalty: z.number().finite(),
  edge_net: z.number().finite(),
  expected_value_usd: z.number().finite(),
  created_at_ms: z.number().int().nonnegative(),
});

export type OpportunityIntent = z.infer<typeof opportunityIntentSchema>;
