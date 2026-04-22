export type CommercePlan = "operator_basic" | "operator_pro" | "operator_enterprise";
export type SettlementStatus = "pending" | "confirmed" | "failed";

export interface CommerceHookPayload {
  paymentReference: string;
  billingWallet: string;
  plan: CommercePlan;
  amountUsd: number;
  initiatedAtMs: number;
}

export interface SettlementVerification {
  paymentReference: string;
  transactionSignature: string;
  verifiedAtMs: number;
  status: SettlementStatus;
}

export interface EntitlementState {
  wallet: string;
  plan: CommercePlan | null;
  active: boolean;
  activatedAtMs?: number;
  reason?: "awaiting_settlement" | "settlement_failed";
}

export function resolveEntitlementState(input: {
  hook: CommerceHookPayload;
  verification: SettlementVerification;
}): EntitlementState {
  if (input.verification.status === "confirmed") {
    return {
      wallet: input.hook.billingWallet,
      plan: input.hook.plan,
      active: true,
      activatedAtMs: input.verification.verifiedAtMs
    };
  }

  return {
    wallet: input.hook.billingWallet,
    plan: null,
    active: false,
    reason: input.verification.status === "failed" ? "settlement_failed" : "awaiting_settlement"
  };
}
