import { z } from "zod";

export const executionStateSchema = z.enum([
  "detected",
  "scored",
  "risk_approved",
  "queued",
  "dispatched",
  "sent",
  "landed",
  "failed",
  "expired",
  "reconciled",
]);

export const executionAttemptSchema = z.object({
  intent_id: z.uuid(),
  attempt_id: z.uuid(),
  venue: z.enum(["dflow", "pnp"]),
  operation: z.string().min(1),
  state: executionStateSchema,
  signature: z.string().min(1).optional(),
  error_code: z.string().min(1).optional(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;
