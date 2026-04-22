export type ApprovalDecision = "approved" | "rejected" | "pending";

export interface ConfigChangeRequest {
  changeId: string;
  configArea: "risk" | "strategy" | "execution" | "commerce";
  requestedBy: string;
  reason: string;
  requestedAtMs: number;
  proposedVersion: string;
}

export interface ConfigApproval {
  changeId: string;
  reviewerWallet: string;
  decision: ApprovalDecision;
  decidedAtMs: number;
  note?: string;
}

export interface ConfigAuditEvent {
  eventId: string;
  changeId: string;
  actor: string;
  action: "request_created" | "approval_recorded" | "config_activated";
  recordedAtMs: number;
  details: string;
}

export interface ConfigApprovalTimeline {
  changeId: string;
  status: ApprovalDecision;
  approvalsRequired: number;
  approvalsReceived: number;
  approvalsRemaining: number;
  events: ConfigAuditEvent[];
}

export function buildConfigApprovalTimeline(input: {
  request: ConfigChangeRequest;
  approvals: ConfigApproval[];
  events: ConfigAuditEvent[];
  approvalsRequired?: number;
}): ConfigApprovalTimeline {
  const approvalsRequired = input.approvalsRequired ?? 2;
  const approvalsReceived = input.approvals.filter((approval) => approval.decision === "approved").length;
  const hasRejection = input.approvals.some((approval) => approval.decision === "rejected");
  const status: ApprovalDecision = hasRejection
    ? "rejected"
    : approvalsReceived >= approvalsRequired
      ? "approved"
      : "pending";

  return {
    changeId: input.request.changeId,
    status,
    approvalsRequired,
    approvalsReceived,
    approvalsRemaining: Math.max(0, approvalsRequired - approvalsReceived),
    events: [...input.events].sort((a, b) => a.recordedAtMs - b.recordedAtMs)
  };
}
