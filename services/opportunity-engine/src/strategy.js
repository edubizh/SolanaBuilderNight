/** @type {Readonly<Record<import("./types.js").StrategyMode, import("./types.js").StrategyModeConfig>>} */
const STRATEGY_MODE_CONFIGS = Object.freeze({
  conservative: Object.freeze({
    mode: "conservative",
    minEdgeThreshold: 0.3,
    minExpectedValueUsd: 1.5,
    minLiquidityUsd: 10_000,
    minFillProbability: 0.8,
  }),
  balanced: Object.freeze({
    mode: "balanced",
    minEdgeThreshold: 0.2,
    minExpectedValueUsd: 1.0,
    minLiquidityUsd: 7_500,
    minFillProbability: 0.65,
  }),
  aggressive: Object.freeze({
    mode: "aggressive",
    minEdgeThreshold: 0.1,
    minExpectedValueUsd: 0.5,
    minLiquidityUsd: 5_000,
    minFillProbability: 0.5,
  }),
});

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function asFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Expected ${field} to be a finite number.`);
  }

  return value;
}

/**
 * @param {import("./types.js").StrategyMode} mode
 * @returns {import("./types.js").StrategyModeConfig}
 */
export function getStrategyModeConfig(mode) {
  const config = STRATEGY_MODE_CONFIGS[mode];

  if (!config) {
    throw new RangeError(`Unsupported strategy mode: ${mode}`);
  }

  return config;
}

/**
 * @param {import("./types.js").OpportunityCandidate} candidate
 * @param {import("./types.js").StrategyMode} mode
 * @returns {import("./types.js").EligibilityEvaluation}
 */
export function evaluateCandidateEligibility(candidate, mode) {
  const config = getStrategyModeConfig(mode);
  const edgeNet = asFiniteNumber(candidate.edgeNet, "edgeNet");
  const expectedValueUsd = asFiniteNumber(candidate.expectedValueUsd, "expectedValueUsd");
  const liquidityUsd = asFiniteNumber(candidate.liquidityUsd ?? 0, "liquidityUsd");
  const fillProbability = asFiniteNumber(candidate.fillProbability ?? 0, "fillProbability");
  const reasons = [];

  if (edgeNet < config.minEdgeThreshold) {
    reasons.push("edge_net_below_threshold");
  }

  if (expectedValueUsd < config.minExpectedValueUsd) {
    reasons.push("ev_usd_below_threshold");
  }

  if (liquidityUsd < config.minLiquidityUsd) {
    reasons.push("liquidity_below_threshold");
  }

  if (fillProbability < config.minFillProbability) {
    reasons.push("fill_probability_below_threshold");
  }

  return {
    isEligible: reasons.length === 0,
    reasons,
  };
}

/**
 * @param {ReadonlyArray<import("./types.js").OpportunityCandidate>} candidates
 * @param {import("./types.js").StrategyMode} mode
 * @returns {import("./types.js").OpportunityCandidate[]}
 */
export function filterEligibleCandidates(candidates, mode) {
  return candidates.filter((candidate) => evaluateCandidateEligibility(candidate, mode).isEligible);
}
