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

/**
 * @typedef {Object} CanonicalQuoteInput
 * @property {string} traceId
 * @property {string} canonicalEventId
 * @property {string} canonicalMarketId
 * @property {string} venue
 * @property {string} venueMarketId
 * @property {number} yesBidPrice
 * @property {number} yesAskPrice
 * @property {number} observedAtMs
 * @property {"realtime" | "fresh" | "stale" | "expired"} freshnessTier
 * @property {"ok" | "crossed_book" | "outlier" | "stale_rejected" | "insufficient_depth" | "venue_unavailable"} integrityStatus
 * @property {number} [spreadBps]
 */

/**
 * @typedef {Object} SpreadToIntentArtifact
 * @property {string} intentId
 * @property {string} traceId
 * @property {string} canonicalEventId
 * @property {string} canonicalMarketId
 * @property {string} buyVenue
 * @property {string} buyVenueMarketId
 * @property {number} buyYesAsk
 * @property {string} sellVenue
 * @property {string} sellVenueMarketId
 * @property {number} sellYesBid
 * @property {number} spread
 * @property {number} spreadBps
 * @property {number} expectedValueUsd
 * @property {number} tradeNotionalUsd
 * @property {"paper_only"} executionMode
 * @property {{ required: true, passed: true, reason: string }} noNakedExposure
 * @property {number} createdAtMs
 */

/**
 * @typedef {Object} PaperDecisionLog
 * @property {string} traceId
 * @property {string} canonicalMarketId
 * @property {"accepted" | "rejected"} decision
 * @property {string[]} reasons
 * @property {number} createdAtMs
 * @property {{ required: true, passed: boolean, reason: string }} noNakedExposure
 * @property {number | null} expectedNetUsd
 */

/**
 * @typedef {Object} ExpectedNetDistribution
 * @property {number} count
 * @property {number | null} min
 * @property {number | null} max
 * @property {number | null} avg
 * @property {Record<string, number>} buckets
 */

/**
 * @typedef {Object} OpportunityQualityTelemetry
 * @property {{ accepted: number, skipped: number, total: number }} totals
 * @property {Record<string, number>} acceptedByReason
 * @property {Record<string, number>} skippedByReason
 * @property {{ accepted: ExpectedNetDistribution, skipped: ExpectedNetDistribution }} expectedNetDistributions
 */

/**
 * @typedef {Object} OperationalSnapshot
 * @property {number} generatedAtMs
 * @property {number} minSpreadToTrade
 * @property {number} tradeNotionalUsd
 * @property {"paper_only" | "live"} requestedExecutionMode
 * @property {OpportunityQualityTelemetry} telemetry
 * @property {PaperDecisionLog[]} decisions
 */

export {};
