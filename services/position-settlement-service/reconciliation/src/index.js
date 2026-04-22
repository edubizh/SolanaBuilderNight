export const DEFAULT_RECONCILIATION_POLICY = Object.freeze({
  maxQuantityDriftPct: 0.001,
  maxValueDriftUsd: 5,
  maxConsecutiveMismatches: 2,
  maxUnresolvedDriftMs: 300_000
});

function toAbsolutePercentDrift(expected, actual) {
  if (expected === 0) {
    return actual === 0 ? 0 : 1;
  }
  return Math.abs((actual - expected) / expected);
}

export function evaluateReconciliation(expected, observed, policy = DEFAULT_RECONCILIATION_POLICY) {
  const quantityDriftPct = toAbsolutePercentDrift(expected.quantity, observed.quantity);
  const valueDriftUsd = Math.abs(expected.notionalUsd - observed.notionalUsd);

  const mismatches = [];
  if (quantityDriftPct > policy.maxQuantityDriftPct) {
    mismatches.push("quantity_drift_exceeded");
  }
  if (valueDriftUsd > policy.maxValueDriftUsd) {
    mismatches.push("value_drift_exceeded");
  }

  return {
    matched: mismatches.length === 0,
    quantityDriftPct,
    valueDriftUsd,
    mismatches
  };
}

function toFiniteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function evaluateReconciliationDrift(input, policy = DEFAULT_RECONCILIATION_POLICY) {
  const reconciliation = evaluateReconciliation(input.expected, input.observed, policy);
  const nowMs = toFiniteNumber(input.nowMs, Date.now());
  const previousState = input.previousState ?? {};

  const previousConsecutiveMismatchCount = toFiniteNumber(previousState.consecutiveMismatchCount, 0);
  const previousFirstDetectedAtMs = toFiniteNumber(previousState.firstDetectedAtMs, null);
  const consecutiveMismatchCount = reconciliation.matched ? 0 : previousConsecutiveMismatchCount + 1;
  const firstDetectedAtMs = reconciliation.matched ? null : previousFirstDetectedAtMs ?? nowMs;
  const unresolvedDurationMs =
    reconciliation.matched || firstDetectedAtMs === null ? 0 : Math.max(0, nowMs - firstDetectedAtMs);

  const haltReasons = [];
  if (consecutiveMismatchCount >= policy.maxConsecutiveMismatches) {
    haltReasons.push("reconciliation_mismatch_threshold");
  }
  if (unresolvedDurationMs >= policy.maxUnresolvedDriftMs) {
    haltReasons.push("reconciliation_unresolved_drift_timeout");
  }

  return {
    ...reconciliation,
    consecutiveMismatchCount,
    firstDetectedAtMs,
    unresolvedDurationMs,
    driftState: {
      consecutiveMismatchCount,
      firstDetectedAtMs,
      unresolvedDurationMs
    },
    haltPolicy: {
      shouldHalt: haltReasons.length > 0,
      reasons: haltReasons,
      resumeRequiresApproval: haltReasons.length > 0
    }
  };
}
