export interface OpportunityView {
  intentId: string;
  market: string;
  venue: "dflow" | "pnp";
  edgeNetBps: number;
  expectedValueUsd: number;
  direction: "long" | "short";
  status: "new" | "watching" | "executing";
  updatedAtMs: number;
}

export interface PositionView {
  positionId: string;
  market: string;
  venue: "dflow" | "pnp";
  side: "buy" | "sell";
  notionalUsd: number;
  unrealizedPnlUsd: number;
  status: "open" | "hedged" | "closing";
  updatedAtMs: number;
}

export interface RiskSignalView {
  signalId: string;
  category: "exposure" | "drawdown" | "feed_health" | "execution_failures";
  severity: "info" | "warning" | "critical";
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

export interface LiveDashboardResponse {
  ok: true;
  snapshot: DashboardSnapshot;
}

export function getLiveDashboardResponse(snapshot: DashboardSnapshot): LiveDashboardResponse {
  return {
    ok: true,
    snapshot
  };
}
