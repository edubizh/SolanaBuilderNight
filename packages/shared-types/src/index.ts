export type EventName =
  | "market_data_updated"
  | "opportunity_computed"
  | "risk_decision_emitted"
  | "execution_intent_dispatched"
  | "execution_terminal_state"
  | "position_reconciled"
  | "circuit_breaker_triggered";

export type EventEnvelope = {
  event_id: string;
  intent_id?: string;
  trace_id: string;
  source_service: string;
  created_at_ms: number;
  event_name: EventName;
  version: string;
};

export type MarketSnapshot = {
  venue: "dflow" | "pnp";
  market_id: string;
  base_symbol: string;
  quote_symbol: string;
  bid_price?: number;
  ask_price?: number;
  mid_price: number;
  confidence_ratio?: number;
  updated_at_ms: number;
};

export type StrategyMode = "conservative" | "balanced" | "aggressive";

export type OpportunityIntent = {
  intent_id: string;
  trace_id: string;
  strategy_mode: StrategyMode;
  source_market_id: string;
  target_market_id: string;
  gross_edge: number;
  fee_cost: number;
  slippage_cost: number;
  confidence_penalty: number;
  staleness_penalty: number;
  latency_penalty: number;
  edge_net: number;
  expected_value_usd: number;
  created_at_ms: number;
};

export type ExecutionVenue = "dflow" | "pnp";

export type ExecutionState =
  | "detected"
  | "scored"
  | "risk_approved"
  | "queued"
  | "dispatched"
  | "sent"
  | "landed"
  | "failed"
  | "expired"
  | "reconciled";

export type ExecutionAttempt = {
  intent_id: string;
  attempt_id: string;
  venue: ExecutionVenue;
  operation: string;
  state: ExecutionState;
  signature?: string;
  error_code?: string;
  created_at_ms: number;
  updated_at_ms: number;
};

export type RiskOutcome = "approved" | "rejected" | "downsized";

export type RiskDecision = {
  intent_id: string;
  trace_id: string;
  decision: RiskOutcome;
  reason_codes: string[];
  max_notional_usd: number;
  max_exposure_market_usd: number;
  max_exposure_venue_usd: number;
  created_at_ms: number;
};

export type CircuitBreakerState = {
  breaker_code: string;
  active: boolean;
  severity: "warning" | "critical";
  trigger_count: number;
  updated_at_ms: number;
};

export type CanonicalEvent =
  | (EventEnvelope & {
      event_name: "market_data_updated";
      payload: {
        venue: string;
        market_symbol: string;
        quote_timestamp_ms: number;
        oracle_timestamp_ms?: number;
        bid_price?: number;
        ask_price?: number;
        mid_price?: number;
        confidence_ratio?: number;
        staleness_ms: number;
      };
    })
  | (EventEnvelope & {
      event_name: "opportunity_computed";
      payload: {
        strategy_mode: StrategyMode;
        edge_net: number;
        expected_value_usd: number;
        rank: number;
      };
    })
  | (EventEnvelope & {
      event_name: "risk_decision_emitted";
      payload: {
        decision: RiskOutcome;
        reason_codes: string[];
        max_notional_usd: number;
      };
    })
  | (EventEnvelope & {
      event_name: "execution_intent_dispatched";
      payload: {
        venue: ExecutionVenue;
        operation: string;
        requested_notional_usd: number;
        idempotency_key: string;
      };
    })
  | (EventEnvelope & {
      event_name: "execution_terminal_state";
      payload: {
        terminal_state: "landed" | "failed" | "expired" | "cancelled";
        signature?: string;
        failure_category?: string;
        finalized_at_ms: number;
      };
    })
  | (EventEnvelope & {
      event_name: "position_reconciled";
      payload: {
        position_id: string;
        reconciliation_state: "matched" | "drift_detected" | "resolved";
        drift_usd: number;
        resolved_at_ms?: number;
      };
    })
  | (EventEnvelope & {
      event_name: "circuit_breaker_triggered";
      payload: {
        breaker_code: string;
        severity: "warning" | "critical";
        trigger_reason: string;
        halt_trading: boolean;
      };
    });
