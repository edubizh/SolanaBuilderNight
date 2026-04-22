import test from "node:test";
import assert from "node:assert/strict";

import { RiskEngine } from "../../../services/risk-engine/src/index.js";

function snapshotSignal(overrides = {}) {
  return {
    killSwitchActive: false,
    criticalRuleBreach: false,
    consecutiveExecutionFailures: 0,
    feedStalenessMs: 0,
    slippageOutlierBreaches: 0,
    reconciliationMismatches: 0,
    providerDegradationMs: 0,
    ...overrides
  };
}

test("risk replay failure storm triggers kill-switch at first breached checkpoint", () => {
  const engine = new RiskEngine();
  const replayTimeline = [
    snapshotSignal({ consecutiveExecutionFailures: 1, providerDegradationMs: 5_000 }),
    snapshotSignal({ consecutiveExecutionFailures: 2, providerDegradationMs: 10_000 }),
    snapshotSignal({ consecutiveExecutionFailures: 3, providerDegradationMs: 15_000, slippageOutlierBreaches: 1 }),
    snapshotSignal({ consecutiveExecutionFailures: 4, providerDegradationMs: 20_000, slippageOutlierBreaches: 2 }),
    snapshotSignal({ consecutiveExecutionFailures: 5, providerDegradationMs: 25_000, slippageOutlierBreaches: 2 }),
    snapshotSignal({ consecutiveExecutionFailures: 6, providerDegradationMs: 35_000, slippageOutlierBreaches: 3 })
  ];

  const replayResults = replayTimeline.map((signal) => engine.evaluateRuntime(signal));

  assert.equal(replayResults[0].triggered, false);
  assert.equal(replayResults[1].triggered, false);
  assert.equal(replayResults[2].triggered, false);
  assert.equal(replayResults[3].triggered, false);

  assert.equal(replayResults[4].triggered, true);
  assert.equal(replayResults[4].reason, "consecutive_execution_failures");
  assert.equal(replayResults[4].killSwitch.engage, true);
  assert.equal(replayResults[4].killSwitch.mode, "automatic");
  assert.equal(replayResults[4].killSwitch.resumeProtocol, "explicit_operator_approval_event_required");

  assert.equal(replayResults[5].triggered, true);
  assert.ok(replayResults[5].reasons.includes("consecutive_execution_failures"));
  assert.ok(replayResults[5].reasons.includes("provider_degradation_window_breached"));
  assert.ok(replayResults[5].reasons.includes("slippage_outlier_breaches"));
});

test("risk replay storm captures multi-vector failures in deterministic reason order", () => {
  const engine = new RiskEngine();
  const failureStormSignal = snapshotSignal({
    criticalRuleBreach: true,
    consecutiveExecutionFailures: 8,
    feedStalenessMs: 5_500,
    slippageOutlierBreaches: 4,
    reconciliationMismatches: 3,
    providerDegradationMs: 45_000
  });

  const runtimeDecision = engine.evaluateRuntime(failureStormSignal);

  assert.equal(runtimeDecision.triggered, true);
  assert.equal(runtimeDecision.reason, "critical_rule_breach");
  assert.deepEqual(runtimeDecision.reasons, [
    "critical_rule_breach",
    "consecutive_execution_failures",
    "critical_feed_staleness",
    "slippage_outlier_breaches",
    "reconciliation_mismatch_threshold",
    "provider_degradation_window_breached"
  ]);
  assert.equal(runtimeDecision.killSwitch.engage, true);
  assert.equal(runtimeDecision.killSwitch.mode, "automatic");
  assert.equal(runtimeDecision.killSwitch.resumeRequiresApproval, true);
});
