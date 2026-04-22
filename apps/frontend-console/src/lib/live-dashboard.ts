export type OpportunityDirection = "long" | "short";
export type OpportunityStatus = "new" | "watching" | "executing";
export type PositionSide = "buy" | "sell";
export type PositionStatus = "open" | "hedged" | "closing";
export type RiskSeverity = "info" | "warning" | "critical";

export interface OpportunityView {
  intentId: string;
  market: string;
  venue: "dflow" | "pnp";
  edgeNetBps: number;
  expectedValueUsd: number;
  direction: OpportunityDirection;
  status: OpportunityStatus;
  updatedAtMs: number;
}

export interface PositionView {
  positionId: string;
  market: string;
  venue: "dflow" | "pnp";
  side: PositionSide;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  status: PositionStatus;
  updatedAtMs: number;
}

export interface RiskSignalView {
  signalId: string;
  category: "exposure" | "drawdown" | "feed_health" | "execution_failures";
  severity: RiskSeverity;
  message: string;
  triggeredAtMs: number;
}

export interface DashboardSnapshot {
  generatedAtMs: number;
  opportunities: OpportunityView[];
  positions: PositionView[];
  riskSignals: RiskSignalView[];
  totals: {
    openPositions: number;
    grossExposureUsd: number;
    netUnrealizedPnlUsd: number;
    criticalRiskSignals: number;
  };
}

function toFixed2(value: number): number {
  return Number(value.toFixed(2));
}

export function createDashboardSnapshot(input: {
  generatedAtMs?: number;
  opportunities: OpportunityView[];
  positions: PositionView[];
  riskSignals: RiskSignalView[];
}): DashboardSnapshot {
  const generatedAtMs = input.generatedAtMs ?? Date.now();
  const openPositions = input.positions.filter((position) => position.status !== "closing").length;
  const grossExposureUsd = input.positions.reduce((sum, position) => sum + Math.abs(position.notionalUsd), 0);
  const netUnrealizedPnlUsd = input.positions.reduce((sum, position) => sum + position.unrealizedPnlUsd, 0);
  const criticalRiskSignals = input.riskSignals.filter((signal) => signal.severity === "critical").length;

  return {
    generatedAtMs,
    opportunities: [...input.opportunities].sort((a, b) => b.edgeNetBps - a.edgeNetBps),
    positions: [...input.positions].sort((a, b) => b.updatedAtMs - a.updatedAtMs),
    riskSignals: [...input.riskSignals].sort((a, b) => b.triggeredAtMs - a.triggeredAtMs),
    totals: {
      openPositions,
      grossExposureUsd: toFixed2(grossExposureUsd),
      netUnrealizedPnlUsd: toFixed2(netUnrealizedPnlUsd),
      criticalRiskSignals
    }
  };
}
