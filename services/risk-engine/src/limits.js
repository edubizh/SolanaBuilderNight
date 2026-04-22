export const DEFAULT_HARD_LIMITS = Object.freeze({
  maxSingleTradeNotionalUsd: 10_000,
  maxExposurePerMarketUsd: 50_000,
  maxExposurePerVenueUsd: 100_000,
  maxDailyNotionalUsd: 250_000,
  maxDailyLossUsd: 15_000,
  maxPendingExecutions: 25
});

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveProjectedValue({ projectedValue, currentValue, delta = 0 }) {
  const projected = asFiniteNumber(projectedValue);
  if (projected !== null) {
    return projected;
  }

  const current = asFiniteNumber(currentValue);
  return current === null ? null : current + delta;
}

function evaluateBound({ metric, projectedValue, limitValue, reason }) {
  if (projectedValue === null || limitValue === null) {
    return {
      passed: false,
      reason: "invalid_risk_input",
      breach: { metric, projectedValue, limitValue, reason: "invalid_risk_input" }
    };
  }

  if (projectedValue <= limitValue) {
    return { passed: true, reason: null, breach: null };
  }

  return {
    passed: false,
    reason,
    breach: { metric, projectedValue, limitValue, reason }
  };
}

export function evaluateHardLimits(input, limits = DEFAULT_HARD_LIMITS) {
  const reasons = [];
  const breaches = [];

  const tradeNotionalUsd = asFiniteNumber(input.tradeNotionalUsd);
  const projectedMarketExposureUsd = resolveProjectedValue({
    projectedValue: input.projectedMarketExposureUsd,
    currentValue: input.currentMarketExposureUsd,
    delta: tradeNotionalUsd ?? 0
  });
  const projectedVenueExposureUsd = resolveProjectedValue({
    projectedValue: input.projectedVenueExposureUsd,
    currentValue: input.currentVenueExposureUsd,
    delta: tradeNotionalUsd ?? 0
  });
  const projectedDailyNotionalUsd = resolveProjectedValue({
    projectedValue: input.projectedDailyNotionalUsd,
    currentValue: input.currentDailyNotionalUsd,
    delta: tradeNotionalUsd ?? 0
  });
  const projectedDailyLossUsd = resolveProjectedValue({
    projectedValue: input.projectedDailyLossUsd,
    currentValue: input.currentDailyLossUsd,
    delta: asFiniteNumber(input.projectedTradeLossUsd) ?? 0
  });
  const projectedPendingExecutions = resolveProjectedValue({
    projectedValue: input.projectedPendingExecutions,
    currentValue: input.currentPendingExecutions,
    delta: 1
  });

  const singleTradeEvaluation = evaluateBound({
    metric: "tradeNotionalUsd",
    projectedValue: tradeNotionalUsd,
    limitValue: asFiniteNumber(limits.maxSingleTradeNotionalUsd),
    reason: "single_trade_notional_limit_exceeded"
  });
  if (!singleTradeEvaluation.passed) {
    reasons.push(singleTradeEvaluation.reason);
    breaches.push(singleTradeEvaluation.breach);
  }

  const marketExposureEvaluation = evaluateBound({
    metric: "projectedMarketExposureUsd",
    projectedValue: projectedMarketExposureUsd,
    limitValue: asFiniteNumber(limits.maxExposurePerMarketUsd),
    reason: "market_exposure_limit_exceeded"
  });
  if (!marketExposureEvaluation.passed) {
    reasons.push(marketExposureEvaluation.reason);
    breaches.push(marketExposureEvaluation.breach);
  }

  const venueExposureEvaluation = evaluateBound({
    metric: "projectedVenueExposureUsd",
    projectedValue: projectedVenueExposureUsd,
    limitValue: asFiniteNumber(limits.maxExposurePerVenueUsd),
    reason: "venue_exposure_limit_exceeded"
  });
  if (!venueExposureEvaluation.passed) {
    reasons.push(venueExposureEvaluation.reason);
    breaches.push(venueExposureEvaluation.breach);
  }

  const dailyNotionalEvaluation = evaluateBound({
    metric: "projectedDailyNotionalUsd",
    projectedValue: projectedDailyNotionalUsd,
    limitValue: asFiniteNumber(limits.maxDailyNotionalUsd),
    reason: "daily_notional_limit_exceeded"
  });
  if (!dailyNotionalEvaluation.passed) {
    reasons.push(dailyNotionalEvaluation.reason);
    breaches.push(dailyNotionalEvaluation.breach);
  }

  const dailyLossEvaluation = evaluateBound({
    metric: "projectedDailyLossUsd",
    projectedValue: projectedDailyLossUsd,
    limitValue: asFiniteNumber(limits.maxDailyLossUsd),
    reason: "daily_loss_limit_exceeded"
  });
  if (!dailyLossEvaluation.passed) {
    reasons.push(dailyLossEvaluation.reason);
    breaches.push(dailyLossEvaluation.breach);
  }

  const pendingEvaluation = evaluateBound({
    metric: "projectedPendingExecutions",
    projectedValue: projectedPendingExecutions,
    limitValue: asFiniteNumber(limits.maxPendingExecutions),
    reason: "pending_execution_limit_exceeded"
  });
  if (!pendingEvaluation.passed) {
    reasons.push(pendingEvaluation.reason);
    breaches.push(pendingEvaluation.breach);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    breaches
  };
}
