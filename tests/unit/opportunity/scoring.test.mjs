import test from "node:test";
import assert from "node:assert/strict";

import { calculateEdgeNet } from "../../../services/opportunity-engine/src/index.js";

test("calculateEdgeNet applies PRD edge_net formula with explicit components", () => {
  const result = calculateEdgeNet({
    grossEdge: 1.2,
    feeCost: 0.1,
    slippageCost: 0.2,
    confidencePenalty: 0.05,
    stalenessPenalty: 0.03,
    latencyPenalty: 0.02,
  });

  assert.deepEqual(
    {
      ...result,
      edgeNet: Number(result.edgeNet.toFixed(10)),
    },
    {
    grossEdge: 1.2,
    feeCost: 0.1,
    slippageCost: 0.2,
    confidencePenalty: 0.05,
    stalenessPenalty: 0.03,
    latencyPenalty: 0.02,
    edgeNet: 0.8,
    },
  );
});

test("calculateEdgeNet supports negative edge outcomes when penalties dominate", () => {
  const result = calculateEdgeNet({
    grossEdge: 0.4,
    feeCost: 0.2,
    slippageCost: 0.15,
    confidencePenalty: 0.1,
    stalenessPenalty: 0.03,
    latencyPenalty: 0.04,
  });

  assert.equal(result.edgeNet, -0.12);
});

test("calculateEdgeNet rejects non-finite component values", () => {
  assert.throws(
    () =>
      calculateEdgeNet({
        grossEdge: 1,
        feeCost: Number.NaN,
        slippageCost: 0,
        confidencePenalty: 0,
        stalenessPenalty: 0,
        latencyPenalty: 0,
      }),
    /feeCost/,
  );
});
