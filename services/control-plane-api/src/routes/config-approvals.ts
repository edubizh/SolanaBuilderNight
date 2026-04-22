export type ApprovalDecision = "approved" | "rejected" | "pending";

export interface ConfigApprovalSummary {
  changeId: string;
  status: ApprovalDecision;
  approvalsRequired: number;
  approvalsReceived: number;
  approvalsRemaining: number;
}

export interface ConfigApprovalResponse {
  ok: true;
  timeline: ConfigApprovalSummary;
}

export function getConfigApprovalResponse(timeline: ConfigApprovalSummary): ConfigApprovalResponse {
  return {
    ok: true,
    timeline
  };
}
