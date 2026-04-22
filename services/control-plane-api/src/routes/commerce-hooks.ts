export type CommercePlan = "operator_basic" | "operator_pro" | "operator_enterprise";
export type SettlementStatus = "pending" | "confirmed" | "failed";

export interface CommerceVerificationResponse {
  ok: true;
  paymentReference: string;
  billingWallet: string;
  plan: CommercePlan;
  settlementStatus: SettlementStatus;
  entitlementActive: boolean;
}

export function getCommerceVerificationResponse(input: Omit<CommerceVerificationResponse, "ok">): CommerceVerificationResponse {
  return {
    ok: true,
    ...input
  };
}
