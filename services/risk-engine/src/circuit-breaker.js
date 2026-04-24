export const DEFAULT_BREAKER_THRESHOLDS = Object.freeze({
  maxConsecutiveExecutionFailures: 5,
  maxSlippageOutlierBreaches: 3,
  maxFeedStalenessMs: 3_000,
  maxReconciliationMismatches: 1,
  maxReconciliationUnresolvedMs: 300_000,
  maxProviderDegradationMs: 30_000
});

const BREAKER_REASON_CATEGORY = Object.freeze({
  manual_kill_switch_active: "operator_control",
  critical_rule_breach: "policy_integrity",
  consecutive_execution_failures: "execution_reliability",
  critical_feed_staleness: "market_data_integrity",
  slippage_outlier_breaches: "execution_quality",
  reconciliation_mismatch_threshold: "reconciliation_integrity",
  reconciliation_unresolved_drift_timeout: "reconciliation_integrity",
  provider_degradation_window_breached: "provider_health"
});

function toFiniteNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isTriggerActivated(metricValue, comparator, thresholdValue) {
  switch (comparator) {
    case ">":
      return metricValue > thresholdValue;
    case ">=":
      return metricValue >= thresholdValue;
    default:
      return false;
  }
}

function toSortedRollup(entries, keyName) {
  return [...entries]
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return String(a[keyName]).localeCompare(String(b[keyName]));
    })
    .map((entry, index) => ({
      rank: index + 1,
      ...entry
    }));
}

function buildCriticalBreachClassifier(triggeredBreakers) {
  const reasonCounts = new Map();
  const categoryCounts = new Map();

  for (const breaker of triggeredBreakers) {
    const reason = String(breaker.reason ?? "unknown_reason");
    const category = BREAKER_REASON_CATEGORY[reason] ?? "uncategorized";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const causeRollup = toSortedRollup(
    [...reasonCounts.entries()].map(([reason, count]) => ({
      reason,
      category: BREAKER_REASON_CATEGORY[reason] ?? "uncategorized",
      count
    })),
    "reason"
  );
  const categoryRollup = toSortedRollup(
    [...categoryCounts.entries()].map(([category, count]) => ({ category, count })),
    "category"
  );

  const topCause = causeRollup[0] ?? {
    rank: 0,
    reason: "none",
    category: "none",
    count: 0
  };
  const topCategory = categoryRollup[0] ?? {
    rank: 0,
    category: "none",
    count: 0
  };

  return {
    breached: triggeredBreakers.length > 0,
    classification: triggeredBreakers.length > 0 ? "critical_breach" : "clear",
    topCause,
    topCategory,
    causeRollup,
    categoryRollup
  };
}

export function evaluateCircuitBreakers(signal, thresholds = DEFAULT_BREAKER_THRESHOLDS) {
  const normalizedSignal = {
    killSwitchActive: signal?.killSwitchActive === true,
    criticalRuleBreach: signal?.criticalRuleBreach === true,
    consecutiveExecutionFailures: toFiniteNumber(signal?.consecutiveExecutionFailures),
    feedStalenessMs: toFiniteNumber(signal?.feedStalenessMs),
    slippageOutlierBreaches: toFiniteNumber(signal?.slippageOutlierBreaches),
    reconciliationMismatches: toFiniteNumber(signal?.reconciliationMismatches),
    reconciliationUnresolvedMs: toFiniteNumber(signal?.reconciliationUnresolvedMs),
    providerDegradationMs: toFiniteNumber(signal?.providerDegradationMs)
  };

  const triggerDefinitions = [
    {
      id: "critical_rule_breach",
      metric: "criticalRuleBreach",
      metricValue: normalizedSignal.criticalRuleBreach ? 1 : 0,
      thresholdValue: 1,
      comparator: ">=",
      reason: "critical_rule_breach",
      active: normalizedSignal.criticalRuleBreach
    },
    {
      id: "consecutive_execution_failures",
      metric: "consecutiveExecutionFailures",
      metricValue: normalizedSignal.consecutiveExecutionFailures,
      thresholdValue: toFiniteNumber(thresholds.maxConsecutiveExecutionFailures),
      comparator: ">=",
      reason: "consecutive_execution_failures"
    },
    {
      id: "critical_feed_staleness",
      metric: "feedStalenessMs",
      metricValue: normalizedSignal.feedStalenessMs,
      thresholdValue: toFiniteNumber(thresholds.maxFeedStalenessMs),
      comparator: ">",
      reason: "critical_feed_staleness"
    },
    {
      id: "slippage_outlier_breaches",
      metric: "slippageOutlierBreaches",
      metricValue: normalizedSignal.slippageOutlierBreaches,
      thresholdValue: toFiniteNumber(thresholds.maxSlippageOutlierBreaches),
      comparator: ">=",
      reason: "slippage_outlier_breaches"
    },
    {
      id: "reconciliation_mismatch_threshold",
      metric: "reconciliationMismatches",
      metricValue: normalizedSignal.reconciliationMismatches,
      thresholdValue: toFiniteNumber(thresholds.maxReconciliationMismatches),
      comparator: ">",
      reason: "reconciliation_mismatch_threshold"
    },
    {
      id: "reconciliation_unresolved_timeout",
      metric: "reconciliationUnresolvedMs",
      metricValue: normalizedSignal.reconciliationUnresolvedMs,
      thresholdValue: toFiniteNumber(thresholds.maxReconciliationUnresolvedMs),
      comparator: ">=",
      reason: "reconciliation_unresolved_drift_timeout"
    },
    {
      id: "provider_degradation_window_breached",
      metric: "providerDegradationMs",
      metricValue: normalizedSignal.providerDegradationMs,
      thresholdValue: toFiniteNumber(thresholds.maxProviderDegradationMs),
      comparator: ">=",
      reason: "provider_degradation_window_breached"
    }
  ];

  const triggeredBreakers = [];
  if (normalizedSignal.killSwitchActive) {
    triggeredBreakers.push({
      id: "manual_kill_switch_active",
      metric: "killSwitchActive",
      comparator: "==",
      metricValue: 1,
      thresholdValue: 1,
      reason: "manual_kill_switch_active"
    });
  }

  for (const definition of triggerDefinitions) {
    const isActive =
      definition.active === true ||
      isTriggerActivated(definition.metricValue, definition.comparator, definition.thresholdValue);
    if (!isActive) {
      continue;
    }

    triggeredBreakers.push({
      id: definition.id,
      metric: definition.metric,
      comparator: definition.comparator,
      metricValue: definition.metricValue,
      thresholdValue: definition.thresholdValue,
      reason: definition.reason
    });
  }

  const triggered = triggeredBreakers.length > 0;
  const reasons = triggeredBreakers.map((breaker) => breaker.reason);
  const primaryReason = reasons[0] ?? "none";
  const killSwitchMode = normalizedSignal.killSwitchActive ? "manual" : triggered ? "automatic" : "inactive";
  const criticalBreachClassifier = buildCriticalBreachClassifier(triggeredBreakers);

  return {
    triggered,
    reason: primaryReason,
    reasons,
    shouldHalt: triggered,
    triggeredBreakers,
    criticalBreachClassifier,
    operationalEvidenceSnapshot: {
      signal: { ...normalizedSignal },
      thresholds: {
        maxConsecutiveExecutionFailures: toFiniteNumber(thresholds.maxConsecutiveExecutionFailures),
        maxSlippageOutlierBreaches: toFiniteNumber(thresholds.maxSlippageOutlierBreaches),
        maxFeedStalenessMs: toFiniteNumber(thresholds.maxFeedStalenessMs),
        maxReconciliationMismatches: toFiniteNumber(thresholds.maxReconciliationMismatches),
        maxReconciliationUnresolvedMs: toFiniteNumber(thresholds.maxReconciliationUnresolvedMs),
        maxProviderDegradationMs: toFiniteNumber(thresholds.maxProviderDegradationMs)
      },
      triggeredBreakers: triggeredBreakers.map((breaker) => ({
        id: breaker.id,
        reason: breaker.reason,
        metric: breaker.metric,
        comparator: breaker.comparator,
        metricValue: breaker.metricValue,
        thresholdValue: breaker.thresholdValue
      })),
      criticalBreachClassifier
    },
    killSwitch: {
      engage: triggered,
      mode: killSwitchMode,
      resumeRequiresApproval: triggered,
      resumeProtocol: triggered ? "explicit_operator_approval_event_required" : "not_required"
    }
  };
}
