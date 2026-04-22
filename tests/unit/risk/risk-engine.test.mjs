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
});
