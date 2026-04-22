import test from "node:test";
import assert from "node:assert/strict";

import { RiskEngine } from "../../../services/risk-engine/src/index.js";
import {
  evaluateReconciliation,
  evaluateReconciliationDrift
} from "../../../services/position-settlement-service/reconciliation/src/index.js";

test("hard-limit rejection is surfaced before runtime breaker flow", () => {
  const engine = new RiskEngine();
  const preTrade = engine.evaluatePreTrade({
    tradeNotionalUsd: 8_000,
    currentMarketExposureUsd: 45_000,
    currentVenueExposureUsd: 95_000,
    currentDailyNotionalUsd: 245_000,
    currentDailyLossUsd: 14_900,
    projectedTradeLossUsd: 200,
    currentPendingExecutions: 25
  });

  assert.equal(preTrade.approved, false);
  assert.ok(preTrade.hardLimitResult.reasons.includes("market_exposure_limit_exceeded"));
  assert.ok(preTrade.hardLimitResult.reasons.includes("venue_exposure_limit_exceeded"));
  assert.ok(preTrade.hardLimitResult.reasons.includes("daily_notional_limit_exceeded"));
  assert.ok(preTrade.hardLimitResult.reasons.includes("daily_loss_limit_exceeded"));
  assert.ok(preTrade.hardLimitResult.reasons.includes("pending_execution_limit_exceeded"));
});

test("reconciliation mismatch can be escalated into risk circuit breaker signal", () => {
  const engine = new RiskEngine();

  const reconciliation = evaluateReconciliation(
    { quantity: 100, notionalUsd: 10_000 },
    { quantity: 95, notionalUsd: 9_100 }
  );

  assert.equal(reconciliation.matched, false);
  assert.ok(reconciliation.mismatches.length > 0);

  const runtimeDecision = engine.evaluateRuntime({
    killSwitchActive: false,
    consecutiveExecutionFailures: 0,
    feedStalenessMs: 1_000,
    slippageOutlierBreaches: 0,
    reconciliationMismatches: reconciliation.mismatches.length,
    providerDegradationMs: 0
  });

  assert.equal(runtimeDecision.triggered, true);
  assert.equal(runtimeDecision.reason, "reconciliation_mismatch_threshold");
  assert.equal(runtimeDecision.killSwitch.engage, true);
  assert.equal(runtimeDecision.killSwitch.resumeRequiresApproval, true);
});

test("unresolved reconciliation drift timeout escalates into automatic halt", () => {
  const engine = new RiskEngine();
  const firstPass = evaluateReconciliationDrift({
    expected: { quantity: 100, notionalUsd: 10_000 },
    observed: { quantity: 97, notionalUsd: 9_700 },
    nowMs: 1_000
  });

  const secondPass = evaluateReconciliationDrift({
    expected: { quantity: 100, notionalUsd: 10_000 },
    observed: { quantity: 96, notionalUsd: 9_500 },
    previousState: firstPass.driftState,
    nowMs: 301_500
  });

  assert.equal(secondPass.matched, false);
  assert.equal(secondPass.haltPolicy.shouldHalt, true);
  assert.ok(secondPass.haltPolicy.reasons.includes("reconciliation_unresolved_drift_timeout"));
  assert.equal(secondPass.unresolvedDurationMs, 300_500);

  const runtimeDecision = engine.evaluateRuntime({
    killSwitchActive: false,
    consecutiveExecutionFailures: 0,
    feedStalenessMs: 500,
    slippageOutlierBreaches: 0,
    reconciliationMismatches: secondPass.consecutiveMismatchCount,
    reconciliationUnresolvedMs: secondPass.unresolvedDurationMs,
    providerDegradationMs: 0
  });

  assert.equal(runtimeDecision.triggered, true);
  assert.equal(runtimeDecision.reason, "reconciliation_mismatch_threshold");
  assert.ok(runtimeDecision.reasons.includes("reconciliation_unresolved_drift_timeout"));
  assert.equal(runtimeDecision.killSwitch.engage, true);
});
