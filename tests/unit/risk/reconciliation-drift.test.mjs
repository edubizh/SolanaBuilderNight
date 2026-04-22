import test from "node:test";
import assert from "node:assert/strict";

import {
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
