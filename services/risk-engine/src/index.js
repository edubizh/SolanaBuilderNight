import { evaluateHardLimits, DEFAULT_HARD_LIMITS } from "./limits.js";
import { evaluateCircuitBreakers, DEFAULT_BREAKER_THRESHOLDS } from "./circuit-breaker.js";

export const DEFAULT_PAPER_ARB_POLICY = Object.freeze({
  maxIntentNotionalUsd: 2_000,
  maxAggregateOpenExposureUsd: 20_000,
  maxMarketOpenExposureUsd: 7_500,
  maxVenueOpenExposureUsd: 12_500,
  maxProjectedPaperLossUsd: 2_500
});

export class RiskEngine {
  constructor(config = {}) {
    this.hardLimits = config.hardLimits ?? DEFAULT_HARD_LIMITS;
    this.breakerThresholds = config.breakerThresholds ?? DEFAULT_BREAKER_THRESHOLDS;
    this.paperArbPolicy = config.paperArbPolicy ?? DEFAULT_PAPER_ARB_POLICY;
  }

  evaluatePreTrade(input) {
    const hardLimitResult = evaluateHardLimits(input, this.hardLimits);
    return {
      approved: hardLimitResult.passed,
      hardLimitResult
    };
  }

  evaluateRuntime(signal) {
    return evaluateCircuitBreakers(signal, this.breakerThresholds);
  }

  evaluatePaperArbitrageOutputs(payload = {}) {
    const intents = Array.isArray(payload.intents) ? payload.intents : [];
    const decisionLogs = Array.isArray(payload.decisionLogs) ? payload.decisionLogs : [];
    const nowMs = toFiniteNumber(payload.nowMs) ?? Date.now();
    const currentState = payload.currentState ?? {};

    const aggregateOpenExposureUsd = toFiniteNumber(currentState.aggregateOpenExposureUsd) ?? 0;
    const projectedDailyPaperLossUsd = toFiniteNumber(currentState.projectedDailyPaperLossUsd) ?? 0;
    const exposureByMarket = normalizeExposureMap(currentState.exposureByMarket);
    const exposureByVenue = normalizeExposureMap(currentState.exposureByVenue);

    const acceptedIntents = [];
    const rejectedIntents = [];
    const accountingLogs = [];
    const rejectionDecisionLogs = [];

    const orderedIntents = [...intents].sort((a, b) => String(a.intentId).localeCompare(String(b.intentId)));
    let runningAggregateExposure = aggregateOpenExposureUsd;
    let runningProjectedLoss = projectedDailyPaperLossUsd;
    const runningMarketExposure = new Map(exposureByMarket);
    const runningVenueExposure = new Map(exposureByVenue);

    for (const intent of orderedIntents) {
      const riskDecision = evaluatePaperIntent({
        intent,
        policy: this.paperArbPolicy,
        runningAggregateExposure,
        runningProjectedLoss,
        runningMarketExposure,
        runningVenueExposure
      });

      const exposureDeltaUsd = riskDecision.approved ? riskDecision.tradeNotionalUsd : 0;
      const projectedPnlDeltaUsd = riskDecision.approved ? riskDecision.projectedWorstCaseLossUsd : 0;

      accountingLogs.push({
        sequence: accountingLogs.length + 1,
        intentId: String(intent?.intentId ?? "intent-missing"),
        traceId: String(intent?.traceId ?? "trace-missing"),
        decision: riskDecision.approved ? "approved" : "rejected",
        reasons: [...riskDecision.reasons],
        createdAtMs: nowMs,
        inputs: {
          tradeNotionalUsd: riskDecision.tradeNotionalUsd,
          expectedValueUsd: riskDecision.expectedValueUsd
        },
        deltas: {
          exposureDeltaUsd,
          projectedPnlDeltaUsd
        },
        projectedTotals: {
          aggregateOpenExposureUsd: Number((runningAggregateExposure + exposureDeltaUsd).toFixed(6)),
          projectedDailyPaperLossUsd: Number((runningProjectedLoss + projectedPnlDeltaUsd).toFixed(6))
        }
      });

      if (riskDecision.approved) {
        acceptedIntents.push(intent);
        runningAggregateExposure = Number((runningAggregateExposure + exposureDeltaUsd).toFixed(6));
        runningProjectedLoss = Number((runningProjectedLoss + projectedPnlDeltaUsd).toFixed(6));
        incrementExposure(runningMarketExposure, intent.canonicalMarketId, riskDecision.tradeNotionalUsd);
        incrementExposure(runningVenueExposure, intent.buyVenue, riskDecision.tradeNotionalUsd);
        incrementExposure(runningVenueExposure, intent.sellVenue, riskDecision.tradeNotionalUsd);
      } else {
        rejectedIntents.push({
          intent,
          reasons: riskDecision.reasons
        });
        rejectionDecisionLogs.push({
          traceId: String(intent?.traceId ?? "trace-missing"),
          canonicalMarketId: String(intent?.canonicalMarketId ?? "market-missing"),
          decision: "rejected",
          reasons: [...riskDecision.reasons].sort(),
          createdAtMs: nowMs,
          noNakedExposure: {
            required: true,
            passed: false,
            reason: "risk_enforced_no_naked_exposure_or_limit_breach"
          }
        });
      }
    }

    const combinedDecisionLogs = [...decisionLogs, ...rejectionDecisionLogs].sort((a, b) =>
      `${a.canonicalMarketId}|${a.traceId}`.localeCompare(`${b.canonicalMarketId}|${b.traceId}`)
    );
    const riskBreakerSimulation = this.evaluateRuntime({
      killSwitchActive: false,
      criticalRuleBreach: rejectedIntents.some((entry) => entry.reasons.includes("no_naked_exposure_required")),
      consecutiveExecutionFailures: 0,
      feedStalenessMs: 0,
      slippageOutlierBreaches: 0,
      reconciliationMismatches: rejectedIntents.length,
      reconciliationUnresolvedMs: 0,
      providerDegradationMs: 0
    });
    const rejectionCauseRollup = buildDeterministicReasonRollup(rejectedIntents);

    return {
      acceptedIntents,
      rejectedIntents,
      accountingLogs,
      decisionLogs: combinedDecisionLogs,
      rejectionCauseRollup,
      exposureSnapshot: {
        aggregateOpenExposureUsd: runningAggregateExposure,
        byMarket: Object.fromEntries([...runningMarketExposure.entries()].sort(([a], [b]) => a.localeCompare(b))),
        byVenue: Object.fromEntries([...runningVenueExposure.entries()].sort(([a], [b]) => a.localeCompare(b)))
      },
      pnlSnapshot: {
        projectedDailyPaperLossUsd: runningProjectedLoss
      },
      riskBreakerSimulation,
      operationalEvidenceSnapshot: {
        accountingLogs: accountingLogs.map((entry) => ({
          sequence: entry.sequence,
          intentId: entry.intentId,
          traceId: entry.traceId,
          decision: entry.decision,
          reasons: [...entry.reasons]
        })),
        rejectionCauseRollup,
        riskBreakerSimulation: riskBreakerSimulation.operationalEvidenceSnapshot
      }
    };
  }
}

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeExposureMap(input) {
  const map = new Map();
  if (!input || typeof input !== "object") {
    return map;
  }
  for (const [key, value] of Object.entries(input)) {
    const normalizedValue = toFiniteNumber(value);
    if (normalizedValue === null) {
      continue;
    }
    map.set(String(key), normalizedValue);
  }
  return map;
}

function incrementExposure(targetMap, key, delta) {
  const normalizedKey = String(key ?? "unknown");
  const currentValue = targetMap.get(normalizedKey) ?? 0;
  targetMap.set(normalizedKey, Number((currentValue + delta).toFixed(6)));
}

function evaluatePaperIntent({
  intent,
  policy,
  runningAggregateExposure,
  runningProjectedLoss,
  runningMarketExposure,
  runningVenueExposure
}) {
  const reasons = [];
  const tradeNotionalUsd = toFiniteNumber(intent?.tradeNotionalUsd);
  const expectedValueUsd = toFiniteNumber(intent?.expectedValueUsd);
  const projectedWorstCaseLossUsd = Math.max(0, Number((-(expectedValueUsd ?? 0)).toFixed(6)));

  if (intent?.executionMode !== "paper_only") {
    reasons.push("paper_only_execution_required");
  }

  if (!intent?.noNakedExposure || intent.noNakedExposure.required !== true || intent.noNakedExposure.passed !== true) {
    reasons.push("no_naked_exposure_required");
  }

  if (!intent?.buyVenue || !intent?.sellVenue || intent.buyVenue === intent.sellVenue) {
    reasons.push("cross_venue_pairing_required");
  }

  if (tradeNotionalUsd === null || tradeNotionalUsd <= 0) {
    reasons.push("invalid_trade_notional");
  }

  if (expectedValueUsd === null) {
    reasons.push("invalid_expected_value");
  }

  if (tradeNotionalUsd !== null) {
    const projectedAggregate = runningAggregateExposure + tradeNotionalUsd;
    if (projectedAggregate > policy.maxAggregateOpenExposureUsd) {
      reasons.push("aggregate_open_exposure_limit_exceeded");
    }
    if (tradeNotionalUsd > policy.maxIntentNotionalUsd) {
      reasons.push("paper_intent_notional_limit_exceeded");
    }

    const marketKey = String(intent?.canonicalMarketId ?? "market-missing");
    const marketExposure = (runningMarketExposure.get(marketKey) ?? 0) + tradeNotionalUsd;
    if (marketExposure > policy.maxMarketOpenExposureUsd) {
      reasons.push("market_open_exposure_limit_exceeded");
    }

    const buyVenueKey = String(intent?.buyVenue ?? "venue-missing");
    const sellVenueKey = String(intent?.sellVenue ?? "venue-missing");
    const buyVenueExposure = (runningVenueExposure.get(buyVenueKey) ?? 0) + tradeNotionalUsd;
    const sellVenueExposure = (runningVenueExposure.get(sellVenueKey) ?? 0) + tradeNotionalUsd;
    if (buyVenueExposure > policy.maxVenueOpenExposureUsd || sellVenueExposure > policy.maxVenueOpenExposureUsd) {
      reasons.push("venue_open_exposure_limit_exceeded");
    }

    const projectedLoss = runningProjectedLoss + projectedWorstCaseLossUsd;
    if (projectedLoss > policy.maxProjectedPaperLossUsd) {
      reasons.push("projected_paper_loss_limit_exceeded");
    }
  }

  return {
    approved: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    tradeNotionalUsd: tradeNotionalUsd ?? 0,
    expectedValueUsd: expectedValueUsd ?? 0,
    projectedWorstCaseLossUsd
  };
}

function buildDeterministicReasonRollup(rejectedIntents) {
  const reasonCounts = new Map();

  for (const rejectedEntry of rejectedIntents) {
    for (const reason of rejectedEntry.reasons ?? []) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.reason.localeCompare(b.reason);
    })
    .map((entry, index) => ({
      rank: index + 1,
      ...entry
    }));
}

export { evaluateHardLimits, evaluateCircuitBreakers, DEFAULT_HARD_LIMITS, DEFAULT_BREAKER_THRESHOLDS };
