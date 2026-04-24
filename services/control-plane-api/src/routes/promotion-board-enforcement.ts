import type { PromotionGateResult } from "./promotion-gate.ts";

const PM_D_001_ROW_PREFIX = "| PM-D-001 |";
const PROMOTION_GATE_BLOCKER = "`PROMOTION-GATE`";

export interface PromotionBoardEnforcementInput {
  boardMarkdown: string;
  evaluatorResult: PromotionGateResult;
  evidencePath?: string;
}

export interface PromotionBoardEnforcementResult {
  updatedBoardMarkdown: string;
  pmD001Status: "READY" | "BLOCKED";
  pmD001Notes: string;
}

function buildBlockedNotes(failedCriteria: string[]): string {
  const failedCriteriaLiteral = failedCriteria.join(", ");
  return `Hard gate: evaluator overall_pass=false. Failed criteria: ${failedCriteriaLiteral}. BLOCKED on ${PROMOTION_GATE_BLOCKER}.`;
}

function buildReadyNotes(evidencePath: string | undefined): string {
  const normalizedEvidencePath = evidencePath?.trim() || "missing_evidence_path";
  return `Promotion gate passed by evaluator (overall_pass=true). Evidence: \`${normalizedEvidencePath}\`.`;
}

function buildPmD001Row(status: "READY" | "BLOCKED", notes: string): string {
  return `| PM-D-001 | Worker 5 (PNP Execution Hardening) | PM-C-001, PM-C-002, PROMOTION-GATE | \`services/execution-orchestrator/adapters/pnp/**\`, \`services/position-settlement-service/adapters/pnp/**\`, \`infra/**\`, \`docs/runbooks/**\` | Stage D | Promotion-gate evidence bundle (7d paper, 3d live, positive realized PnL, zero critical breaches) | ${status} | ${notes} |`;
}

export function enforcePromotionBoardState(input: PromotionBoardEnforcementInput): PromotionBoardEnforcementResult {
  const pmD001Status = input.evaluatorResult.overall_pass ? "READY" : "BLOCKED";
  const pmD001Notes = input.evaluatorResult.overall_pass
    ? buildReadyNotes(input.evidencePath)
    : buildBlockedNotes(input.evaluatorResult.failed_criteria);

  const rowPattern = /^(\| PM-D-001 \|.*)$/m;
  if (!rowPattern.test(input.boardMarkdown)) {
    throw new Error("PM-D-001 row not found in board markdown");
  }

  const updatedBoardMarkdown = input.boardMarkdown.replace(rowPattern, buildPmD001Row(pmD001Status, pmD001Notes));
  if (!updatedBoardMarkdown.includes(PM_D_001_ROW_PREFIX)) {
    throw new Error("PM-D-001 row replacement failed");
  }

  return {
    updatedBoardMarkdown,
    pmD001Status,
    pmD001Notes
  };
}
