import { z } from "zod";

export const marketSnapshotSchema = z.object({
  venue: z.enum(["dflow", "pnp"]),
  market_id: z.string().min(1),
  base_symbol: z.string().min(1),
  quote_symbol: z.string().min(1),
  bid_price: z.number().finite().optional(),
  ask_price: z.number().finite().optional(),
  mid_price: z.number().finite(),
  confidence_ratio: z.number().nonnegative().optional(),
  updated_at_ms: z.number().int().nonnegative(),
});

export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
