/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function toFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Expected ${field} to be a finite number.`);
  }

  return value;
}

/**
 * Computes the PRD v1 edge_net score using explicit cost/penalty components:
 * edge_net = gross_edge - fee_cost - slippage_cost - confidence_penalty - staleness_penalty - latency_penalty
 *
 * @param {import("./types.js").EdgeNetInput} input
 * @returns {import("./types.js").EdgeNetBreakdown}
 */
export function calculateEdgeNet(input) {
  const grossEdge = toFiniteNumber(input.grossEdge, "grossEdge");
  const feeCost = toFiniteNumber(input.feeCost, "feeCost");
  const slippageCost = toFiniteNumber(input.slippageCost, "slippageCost");
  const confidencePenalty = toFiniteNumber(input.confidencePenalty, "confidencePenalty");
  const stalenessPenalty = toFiniteNumber(input.stalenessPenalty, "stalenessPenalty");
  const latencyPenalty = toFiniteNumber(input.latencyPenalty, "latencyPenalty");

  const edgeNet =
    grossEdge -
    feeCost -
    slippageCost -
    confidencePenalty -
    stalenessPenalty -
    latencyPenalty;

  return {
    grossEdge,
    feeCost,
    slippageCost,
    confidencePenalty,
    stalenessPenalty,
    latencyPenalty,
    edgeNet,
  };
}
