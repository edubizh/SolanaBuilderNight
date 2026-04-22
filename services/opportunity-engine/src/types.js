/**
 * @typedef {Object} OpportunityCandidate
 * @property {string} intentId
 * @property {string} traceId
 * @property {string} sourceMarketId
 * @property {string} targetMarketId
 * @property {number} edgeNet
 * @property {number} expectedValueUsd
 * @property {number} [liquidityUsd]
 * @property {number} [fillProbability]
 * @property {number} createdAtMs
 */

/**
 * @typedef {Object} RankedOpportunity
 * @property {string} intentId
 * @property {string} traceId
 * @property {string} sourceMarketId
 * @property {string} targetMarketId
 * @property {number} edgeNet
 * @property {number} expectedValueUsd
 * @property {number} [liquidityUsd]
 * @property {number} [fillProbability]
 * @property {number} createdAtMs
 * @property {number} rank
 */

/**
 * @typedef {Object} EdgeNetInput
 * @property {number} grossEdge
 * @property {number} feeCost
 * @property {number} slippageCost
 * @property {number} confidencePenalty
 * @property {number} stalenessPenalty
 * @property {number} latencyPenalty
 */

/**
 * @typedef {Object} EdgeNetBreakdown
 * @property {number} grossEdge
 * @property {number} feeCost
 * @property {number} slippageCost
 * @property {number} confidencePenalty
 * @property {number} stalenessPenalty
 * @property {number} latencyPenalty
 * @property {number} edgeNet
 */

/**
 * @typedef {"conservative" | "balanced" | "aggressive"} StrategyMode
 */

/**
 * @typedef {Object} StrategyModeConfig
 * @property {StrategyMode} mode
 * @property {number} minEdgeThreshold
 * @property {number} minExpectedValueUsd
 * @property {number} minLiquidityUsd
 * @property {number} minFillProbability
 */

/**
 * @typedef {Object} EligibilityEvaluation
 * @property {boolean} isEligible
 * @property {string[]} reasons
 */

export {};
