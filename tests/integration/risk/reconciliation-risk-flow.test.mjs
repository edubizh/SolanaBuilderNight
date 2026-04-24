import test from "node:test";
import assert from "node:assert/strict";

import { RiskEngine } from "../../../services/risk-engine/src/index.js";
import {
  buildReconciliationOperationalEvidenceSnapshot,
  buildDeterministicReconciliationLedger,
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

test("paper arbitrage outputs produce deterministic accounting and reconciliation logs", () => {
  const engine = new RiskEngine();
  const paperRiskResult = engine.evaluatePaperArbitrageOutputs({
    nowMs: 77_000,
    currentState: {
      aggregateOpenExposureUsd: 500,
      projectedDailyPaperLossUsd: 0,
      exposureByMarket: {},
      exposureByVenue: {}
    },
    intents: [
      {
        intentId: "intent-2",
        traceId: "trace-2",
        canonicalMarketId: "market-b",
        buyVenue: "dflow",
        sellVenue: "gemini",
        tradeNotionalUsd: 600,
        expectedValueUsd: 15,
        executionMode: "paper_only",
        noNakedExposure: { required: true, passed: true }
      },
      {
        intentId: "intent-1",
        traceId: "trace-1",
        canonicalMarketId: "market-a",
        buyVenue: "dflow",
        sellVenue: "gemini",
        tradeNotionalUsd: 800,
        expectedValueUsd: -30,
        executionMode: "paper_only",
        noNakedExposure: { required: true, passed: true }
      }
    ],
    decisionLogs: []
  });

  const reconciliationLedger = buildDeterministicReconciliationLedger([
    {
      intentId: "intent-2",
      traceId: "trace-2",
      canonicalMarketId: "market-b",
      matched: true,
      quantityDriftPct: 0,
      valueDriftUsd: 0,
      mismatches: [],
      recordedAtMs: 77_010
    },
    {
      intentId: "intent-1",
      traceId: "trace-1",
      canonicalMarketId: "market-a",
      matched: false,
      quantityDriftPct: 0.015,
      valueDriftUsd: 11,
      mismatches: ["quantity_drift_exceeded", "value_drift_exceeded"],
      recordedAtMs: 77_020
    }
  ]);

  assert.equal(paperRiskResult.acceptedIntents.length, 2);
  assert.equal(paperRiskResult.accountingLogs[0].intentId, "intent-1");
  assert.equal(paperRiskResult.accountingLogs[1].intentId, "intent-2");
  assert.equal(paperRiskResult.accountingLogs[0].sequence, 1);
  assert.deepEqual(paperRiskResult.rejectionCauseRollup, []);
  assert.equal(paperRiskResult.operationalEvidenceSnapshot.accountingLogs[0].intentId, "intent-1");
  assert.equal(reconciliationLedger[0].intentId, "intent-1");
  assert.equal(reconciliationLedger[1].intentId, "intent-2");

  const reconciliationEvidence = buildReconciliationOperationalEvidenceSnapshot(reconciliationLedger);
  assert.equal(reconciliationEvidence.totals.ledgerEntries, 2);
  assert.equal(reconciliationEvidence.totals.mismatchedEntries, 1);
  assert.deepEqual(reconciliationEvidence.mismatchRollup, [
    { rank: 1, reason: "quantity_drift_exceeded", count: 1 },
    { rank: 2, reason: "value_drift_exceeded", count: 1 }
  ]);
});
