import test from "node:test";
import assert from "node:assert/strict";

import { RiskEngine } from "../../../services/risk-engine/src/index.js";

test("risk engine approves trade when hard limits are respected", () => {
  const engine = new RiskEngine();
  const result = engine.evaluatePreTrade({
    tradeNotionalUsd: 2_500,
    projectedMarketExposureUsd: 10_000,
    projectedVenueExposureUsd: 20_000,
    projectedDailyNotionalUsd: 50_000,
    projectedDailyLossUsd: 2_000,
    projectedPendingExecutions: 3
  });

  assert.equal(result.approved, true);
  assert.deepEqual(result.hardLimitResult.reasons, []);
  assert.deepEqual(result.hardLimitResult.breaches, []);
});

test("risk engine blocks trade when any hard limit is exceeded", () => {
  const engine = new RiskEngine();
  const result = engine.evaluatePreTrade({
    tradeNotionalUsd: 20_000,
    projectedMarketExposureUsd: 10_000,
    projectedVenueExposureUsd: 20_000,
    projectedDailyNotionalUsd: 50_000,
    projectedDailyLossUsd: 2_000,
    projectedPendingExecutions: 3
  });

  assert.equal(result.approved, false);
  assert.ok(result.hardLimitResult.reasons.includes("single_trade_notional_limit_exceeded"));
  assert.ok(result.hardLimitResult.breaches.some((breach) => breach.metric === "tradeNotionalUsd"));
});

test("risk engine blocks exposure, loss, and pending breaches", () => {
  const engine = new RiskEngine();
  const result = engine.evaluatePreTrade({
    tradeNotionalUsd: 1_000,
    projectedMarketExposureUsd: 60_000,
    projectedVenueExposureUsd: 120_000,
    projectedDailyNotionalUsd: 120_000,
    projectedDailyLossUsd: 16_000,
    projectedPendingExecutions: 30
  });

  assert.equal(result.approved, false);
  assert.ok(result.hardLimitResult.reasons.includes("market_exposure_limit_exceeded"));
  assert.ok(result.hardLimitResult.reasons.includes("venue_exposure_limit_exceeded"));
  assert.ok(result.hardLimitResult.reasons.includes("daily_loss_limit_exceeded"));
  assert.ok(result.hardLimitResult.reasons.includes("pending_execution_limit_exceeded"));
});

test("risk engine computes projections when only current values are provided", () => {
  const engine = new RiskEngine();
  const result = engine.evaluatePreTrade({
    tradeNotionalUsd: 2_500,
    currentMarketExposureUsd: 10_000,
    currentVenueExposureUsd: 20_000,
    currentDailyNotionalUsd: 50_000,
    currentDailyLossUsd: 2_000,
    projectedTradeLossUsd: 200,
    currentPendingExecutions: 3
  });

  assert.equal(result.approved, true);
  assert.deepEqual(result.hardLimitResult.reasons, []);
});

test("risk engine rejects invalid hard-limit input values", () => {
  const engine = new RiskEngine();
  const result = engine.evaluatePreTrade({
    tradeNotionalUsd: "2500",
    projectedMarketExposureUsd: 10_000,
    projectedVenueExposureUsd: 20_000,
    projectedDailyNotionalUsd: 50_000,
    projectedDailyLossUsd: 2_000,
    projectedPendingExecutions: 3
  });

  assert.equal(result.approved, false);
  assert.ok(result.hardLimitResult.reasons.includes("invalid_risk_input"));
});

test("risk engine runtime signals trigger breaker halt on stale feeds", () => {
  const engine = new RiskEngine();
  const runtimeDecision = engine.evaluateRuntime({
    killSwitchActive: false,
    consecutiveExecutionFailures: 0,
    feedStalenessMs: 4_000,
    slippageOutlierBreaches: 0,
    reconciliationMismatches: 0,
    providerDegradationMs: 0
  });

  assert.equal(runtimeDecision.triggered, true);
  assert.equal(runtimeDecision.reason, "critical_feed_staleness");
  assert.equal(runtimeDecision.shouldHalt, true);
  assert.equal(runtimeDecision.killSwitch.engage, true);
  assert.equal(runtimeDecision.killSwitch.mode, "automatic");
  assert.equal(runtimeDecision.killSwitch.resumeRequiresApproval, true);
});

test("risk engine runtime keeps kill-switch inactive when no breaker is breached", () => {
  const engine = new RiskEngine();
  const runtimeDecision = engine.evaluateRuntime({
    killSwitchActive: false,
    consecutiveExecutionFailures: 1,
    feedStalenessMs: 500,
    slippageOutlierBreaches: 1,
    reconciliationMismatches: 0,
    reconciliationUnresolvedMs: 120_000,
    providerDegradationMs: 2_000
  });

  assert.equal(runtimeDecision.triggered, false);
  assert.equal(runtimeDecision.reason, "none");
  assert.deepEqual(runtimeDecision.reasons, []);
  assert.equal(runtimeDecision.shouldHalt, false);
  assert.equal(runtimeDecision.killSwitch.mode, "inactive");
});

test("risk engine runtime triggers halt on unresolved reconciliation drift timeout", () => {
  const engine = new RiskEngine();
  const runtimeDecision = engine.evaluateRuntime({
    killSwitchActive: false,
    consecutiveExecutionFailures: 0,
    feedStalenessMs: 100,
    slippageOutlierBreaches: 0,
    reconciliationMismatches: 0,
    reconciliationUnresolvedMs: 300_000,
    providerDegradationMs: 0
  });

  assert.equal(runtimeDecision.triggered, true);
  assert.equal(runtimeDecision.reason, "reconciliation_unresolved_drift_timeout");
  assert.ok(runtimeDecision.reasons.includes("reconciliation_unresolved_drift_timeout"));
  assert.equal(runtimeDecision.shouldHalt, true);
  assert.equal(runtimeDecision.killSwitch.engage, true);
});

test("manual kill-switch takes priority and still captures additional breakers", () => {
  const engine = new RiskEngine();
  const runtimeDecision = engine.evaluateRuntime({
    killSwitchActive: true,
    consecutiveExecutionFailures: 7,
    feedStalenessMs: 4_500,
    slippageOutlierBreaches: 3,
    reconciliationMismatches: 2,
    reconciliationUnresolvedMs: 360_000,
    providerDegradationMs: 40_000
  });

  assert.equal(runtimeDecision.triggered, true);
  assert.equal(runtimeDecision.reason, "manual_kill_switch_active");
  assert.ok(runtimeDecision.reasons.includes("manual_kill_switch_active"));
  assert.ok(runtimeDecision.reasons.includes("consecutive_execution_failures"));
  assert.ok(runtimeDecision.reasons.includes("critical_feed_staleness"));
  assert.ok(runtimeDecision.reasons.includes("reconciliation_unresolved_drift_timeout"));
  assert.equal(runtimeDecision.killSwitch.mode, "manual");
  assert.equal(runtimeDecision.criticalBreachClassifier.classification, "critical_breach");
  assert.equal(runtimeDecision.criticalBreachClassifier.topCause.reason, "consecutive_execution_failures");
  assert.equal(runtimeDecision.criticalBreachClassifier.topCategory.category, "reconciliation_integrity");
  assert.deepEqual(
    runtimeDecision.criticalBreachClassifier.categoryRollup.map((entry) => entry.category),
    [
      "reconciliation_integrity",
      "execution_quality",
      "execution_reliability",
      "market_data_integrity",
      "operator_control",
      "provider_health"
    ]
  );
  assert.equal(runtimeDecision.operationalEvidenceSnapshot.signal.killSwitchActive, true);
  assert.equal(runtimeDecision.operationalEvidenceSnapshot.thresholds.maxProviderDegradationMs, 30_000);
});

test("paper arbitrage risk controls approve safe intents and emit deterministic logs", () => {
  const engine = new RiskEngine();
  const result = engine.evaluatePaperArbitrageOutputs({
    nowMs: 44_000,
    currentState: {
      aggregateOpenExposureUsd: 1_000,
      projectedDailyPaperLossUsd: 100,
      exposureByMarket: { "mkt-a": 300 },
      exposureByVenue: { dflow: 700, gemini: 800 }
    },
    intents: [
      {
        intentId: "intent-b",
        traceId: "trace-2",
        canonicalMarketId: "mkt-b",
        buyVenue: "dflow",
        sellVenue: "gemini",
        tradeNotionalUsd: 400,
        expectedValueUsd: 10,
        executionMode: "paper_only",
        noNakedExposure: { required: true, passed: true }
      },
      {
        intentId: "intent-a",
        traceId: "trace-1",
        canonicalMarketId: "mkt-a",
        buyVenue: "gemini",
        sellVenue: "dflow",
        tradeNotionalUsd: 500,
        expectedValueUsd: 12,
        executionMode: "paper_only",
        noNakedExposure: { required: true, passed: true }
      }
    ],
    decisionLogs: []
  });

  assert.equal(result.acceptedIntents.length, 2);
  assert.equal(result.rejectedIntents.length, 0);
  assert.deepEqual(
    result.accountingLogs.map((entry) => entry.intentId),
    ["intent-a", "intent-b"]
  );
  assert.equal(result.accountingLogs[0].sequence, 1);
  assert.equal(result.accountingLogs[1].sequence, 2);
  assert.equal(result.exposureSnapshot.aggregateOpenExposureUsd, 1_900);
  assert.equal(result.riskBreakerSimulation.triggered, false);
});

test("paper arbitrage risk controls enforce no-naked-exposure and conservative limits", () => {
  const engine = new RiskEngine({
    paperArbPolicy: {
      maxIntentNotionalUsd: 1_000,
      maxAggregateOpenExposureUsd: 2_000,
      maxMarketOpenExposureUsd: 1_500,
      maxVenueOpenExposureUsd: 1_500,
      maxProjectedPaperLossUsd: 200
    }
  });

  const result = engine.evaluatePaperArbitrageOutputs({
    nowMs: 55_000,
    currentState: {
      aggregateOpenExposureUsd: 1_200,
      projectedDailyPaperLossUsd: 50,
      exposureByMarket: { "mkt-a": 1_100 },
      exposureByVenue: { dflow: 1_200, gemini: 100 }
    },
    intents: [
      {
        intentId: "intent-risk",
        traceId: "trace-risk",
        canonicalMarketId: "mkt-a",
        buyVenue: "dflow",
        sellVenue: "gemini",
        tradeNotionalUsd: 1_100,
        expectedValueUsd: -250,
        executionMode: "paper_only",
        noNakedExposure: { required: true, passed: false }
      }
    ],
    decisionLogs: []
  });

  assert.equal(result.acceptedIntents.length, 0);
  assert.equal(result.rejectedIntents.length, 1);
  assert.ok(result.rejectedIntents[0].reasons.includes("no_naked_exposure_required"));
  assert.ok(result.rejectedIntents[0].reasons.includes("paper_intent_notional_limit_exceeded"));
  assert.ok(result.rejectedIntents[0].reasons.includes("aggregate_open_exposure_limit_exceeded"));
  assert.ok(result.rejectedIntents[0].reasons.includes("market_open_exposure_limit_exceeded"));
  assert.ok(result.rejectedIntents[0].reasons.includes("projected_paper_loss_limit_exceeded"));
  assert.equal(result.accountingLogs[0].decision, "rejected");
  assert.deepEqual(result.rejectionCauseRollup, [
    { rank: 1, reason: "aggregate_open_exposure_limit_exceeded", count: 1 },
    { rank: 2, reason: "market_open_exposure_limit_exceeded", count: 1 },
    { rank: 3, reason: "no_naked_exposure_required", count: 1 },
    { rank: 4, reason: "paper_intent_notional_limit_exceeded", count: 1 },
    { rank: 5, reason: "projected_paper_loss_limit_exceeded", count: 1 },
    { rank: 6, reason: "venue_open_exposure_limit_exceeded", count: 1 }
  ]);
  assert.equal(result.riskBreakerSimulation.triggered, true);
  assert.equal(result.riskBreakerSimulation.reason, "critical_rule_breach");
  assert.equal(result.riskBreakerSimulation.criticalBreachClassifier.topCause.reason, "critical_rule_breach");
  assert.equal(result.operationalEvidenceSnapshot.riskBreakerSimulation.criticalBreachClassifier.classification, "critical_breach");
});
