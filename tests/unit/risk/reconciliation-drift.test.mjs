import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicReconciliationLedger,
  evaluateReconciliationDrift
} from "../../../services/position-settlement-service/reconciliation/src/index.js";

test("reconciliation drift tracks unresolved duration across mismatches", () => {
  const initialDrift = evaluateReconciliationDrift({
    expected: { quantity: 10, notionalUsd: 1_000 },
    observed: { quantity: 9.7, notionalUsd: 950 },
    nowMs: 10_000
  });

  const followUpDrift = evaluateReconciliationDrift({
    expected: { quantity: 10, notionalUsd: 1_000 },
    observed: { quantity: 9.6, notionalUsd: 940 },
    previousState: initialDrift.driftState,
    nowMs: 20_500
  });

  assert.equal(initialDrift.consecutiveMismatchCount, 1);
  assert.equal(initialDrift.firstDetectedAtMs, 10_000);
  assert.equal(followUpDrift.consecutiveMismatchCount, 2);
  assert.equal(followUpDrift.unresolvedDurationMs, 10_500);
  assert.equal(followUpDrift.haltPolicy.shouldHalt, true);
  assert.ok(followUpDrift.haltPolicy.reasons.includes("reconciliation_mismatch_threshold"));
});

test("reconciliation drift resets state once reconciliation matches", () => {
  const mismatchState = evaluateReconciliationDrift({
    expected: { quantity: 50, notionalUsd: 4_000 },
    observed: { quantity: 49, notionalUsd: 3_920 },
    nowMs: 1_000
  });

  const recovered = evaluateReconciliationDrift({
    expected: { quantity: 50, notionalUsd: 4_000 },
    observed: { quantity: 50, notionalUsd: 4_000 },
    previousState: mismatchState.driftState,
    nowMs: 2_000
  });

  assert.equal(recovered.matched, true);
  assert.equal(recovered.consecutiveMismatchCount, 0);
  assert.equal(recovered.firstDetectedAtMs, null);
  assert.equal(recovered.unresolvedDurationMs, 0);
  assert.equal(recovered.haltPolicy.shouldHalt, false);
  assert.deepEqual(recovered.haltPolicy.reasons, []);
});

test("deterministic reconciliation ledger sorts and sequences accounting entries", () => {
  const ledger = buildDeterministicReconciliationLedger([
    {
      intentId: "intent-z",
      traceId: "trace-2",
      canonicalMarketId: "market-b",
      matched: false,
      quantityDriftPct: 0.02,
      valueDriftUsd: 12,
      mismatches: ["value_drift_exceeded", "quantity_drift_exceeded"],
      recordedAtMs: 300
    },
    {
      intentId: "intent-a",
      traceId: "trace-1",
      canonicalMarketId: "market-a",
      matched: true,
      quantityDriftPct: 0,
      valueDriftUsd: 0,
      mismatches: [],
      recordedAtMs: 100
    }
  ]);

  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].sequence, 1);
  assert.equal(ledger[1].sequence, 2);
  assert.equal(ledger[0].intentId, "intent-a");
  assert.equal(ledger[1].intentId, "intent-z");
});
