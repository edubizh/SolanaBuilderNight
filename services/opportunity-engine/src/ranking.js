/**
 * Deterministic ranking comparator used by all strategy modes.
 * Order: edge_net desc, expected_value desc, fill_probability desc,
 * liquidity desc, created_at asc, intent_id asc.
 *
 * @param {import("./types.js").OpportunityCandidate} a
 * @param {import("./types.js").OpportunityCandidate} b
 * @returns {number}
 */
export function compareCandidates(a, b) {
  if (a.edgeNet !== b.edgeNet) {
    return b.edgeNet - a.edgeNet;
  }

  if (a.expectedValueUsd !== b.expectedValueUsd) {
    return b.expectedValueUsd - a.expectedValueUsd;
  }

  const aFillProbability = a.fillProbability ?? 0;
  const bFillProbability = b.fillProbability ?? 0;
  if (aFillProbability !== bFillProbability) {
    return bFillProbability - aFillProbability;
  }

  const aLiquidityUsd = a.liquidityUsd ?? 0;
  const bLiquidityUsd = b.liquidityUsd ?? 0;
  if (aLiquidityUsd !== bLiquidityUsd) {
    return bLiquidityUsd - aLiquidityUsd;
  }

  if (a.createdAtMs !== b.createdAtMs) {
    return a.createdAtMs - b.createdAtMs;
  }

  return a.intentId.localeCompare(b.intentId);
}

/**
 * Rank opportunities deterministically. This is scaffold behavior for A5-S0-01.
 *
 * @param {ReadonlyArray<import("./types.js").OpportunityCandidate>} candidates
 * @returns {import("./types.js").RankedOpportunity[]}
 */
export function rankCandidates(candidates) {
  return [...candidates]
    .sort(compareCandidates)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}
