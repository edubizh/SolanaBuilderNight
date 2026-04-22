import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCandidateEligibility,
  filterEligibleCandidates,
  getStrategyModeConfig,
} from "../../../services/opportunity-engine/src/index.js";

test("getStrategyModeConfig returns deterministic thresholds by mode", () => {
  const conservative = getStrategyModeConfig("conservative");
  const balanced = getStrategyModeConfig("balanced");
  const aggressive = getStrategyModeConfig("aggressive");

  assert.equal(conservative.minEdgeThreshold > balanced.minEdgeThreshold, true);
  assert.equal(balanced.minEdgeThreshold > aggressive.minEdgeThreshold, true);
  assert.equal(conservative.minFillProbability > balanced.minFillProbability, true);
  assert.equal(balanced.minFillProbability > aggressive.minFillProbability, true);
});

test("evaluateCandidateEligibility enforces EV, liquidity, and fill probability filters", () => {
  const candidate = {
    intentId: "intent-1",
    traceId: "trace-1",
    sourceMarketId: "dflow-a",
    targetMarketId: "pnp-a",
    edgeNet: 0.15,
    expectedValueUsd: 0.8,
    liquidityUsd: 5_200,
    fillProbability: 0.55,
    createdAtMs: 1_000,
  };

  const conservative = evaluateCandidateEligibility(candidate, "conservative");
  const balanced = evaluateCandidateEligibility(candidate, "balanced");
  const aggressive = evaluateCandidateEligibility(candidate, "aggressive");

  assert.equal(conservative.isEligible, false);
  assert.deepEqual(conservative.reasons.sort(), [
    "edge_net_below_threshold",
    "ev_usd_below_threshold",
    "fill_probability_below_threshold",
    "liquidity_below_threshold",
  ]);

  assert.equal(balanced.isEligible, false);
  assert.deepEqual(balanced.reasons.sort(), [
    "edge_net_below_threshold",
    "ev_usd_below_threshold",
    "fill_probability_below_threshold",
    "liquidity_below_threshold",
  ]);

  assert.equal(aggressive.isEligible, true);
  assert.deepEqual(aggressive.reasons, []);
});

test("filterEligibleCandidates returns only candidates passing selected mode thresholds", () => {
  const candidates = [
    {
      intentId: "intent-1",
      traceId: "trace-1",
      sourceMarketId: "dflow-a",
      targetMarketId: "pnp-a",
      edgeNet: 0.25,
      expectedValueUsd: 1.2,
      liquidityUsd: 9_000,
      fillProbability: 0.7,
      createdAtMs: 1_000,
    },
    {
      intentId: "intent-2",
      traceId: "trace-2",
      sourceMarketId: "dflow-b",
      targetMarketId: "pnp-b",
      edgeNet: 0.5,
      expectedValueUsd: 2.2,
      liquidityUsd: 20_000,
      fillProbability: 0.92,
      createdAtMs: 2_000,
    },
  ];

  const conservative = filterEligibleCandidates(candidates, "conservative");
  const balanced = filterEligibleCandidates(candidates, "balanced");

  assert.deepEqual(conservative.map((candidate) => candidate.intentId), ["intent-2"]);
  assert.deepEqual(balanced.map((candidate) => candidate.intentId), ["intent-1", "intent-2"]);
});
