import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateEdgeNet,
  filterEligibleCandidates,
  rankCandidates,
  runPaperArbitrageLoop,
} from "../../../services/opportunity-engine/src/index.js";

test("engine scaffold supports deterministic replay semantics", () => {
  const snapshot = [
    {
      intentId: "intent-2",
      traceId: "trace-2",
      sourceMarketId: "dflow-a",
      targetMarketId: "pnp-a",
      edgeNet: 2.4,
      expectedValueUsd: 1.2,
      createdAtMs: 2000,
    },
    {
      intentId: "intent-1",
      traceId: "trace-1",
      sourceMarketId: "dflow-a",
      targetMarketId: "pnp-a",
      edgeNet: 2.4,
      expectedValueUsd: 1.2,
      createdAtMs: 1000,
    },
  ];

  const first = rankCandidates(snapshot);
  const second = rankCandidates(snapshot);

  assert.deepEqual(first, second);
  assert.equal(first[0].intentId, "intent-1");
  assert.equal(first[0].rank, 1);
});

test("scoring output composes with deterministic ranking", () => {
  const snapshot = [
    {
      intentId: "intent-2",
      traceId: "trace-2",
      sourceMarketId: "dflow-b",
      targetMarketId: "pnp-b",
      expectedValueUsd: 5.5,
      createdAtMs: 2000,
      ...calculateEdgeNet({
        grossEdge: 1.05,
        feeCost: 0.1,
        slippageCost: 0.1,
        confidencePenalty: 0.05,
        stalenessPenalty: 0.03,
        latencyPenalty: 0.02,
      }),
    },
    {
      intentId: "intent-1",
      traceId: "trace-1",
      sourceMarketId: "dflow-a",
      targetMarketId: "pnp-a",
      expectedValueUsd: 4.5,
      createdAtMs: 1000,
      ...calculateEdgeNet({
        grossEdge: 1.2,
        feeCost: 0.15,
        slippageCost: 0.12,
        confidencePenalty: 0.05,
        stalenessPenalty: 0.03,
        latencyPenalty: 0.02,
      }),
    },
  ];

  const ranked = rankCandidates(snapshot);
  assert.equal(ranked[0].intentId, "intent-1");
  assert.equal(ranked[0].edgeNet > ranked[1].edgeNet, true);
  assert.equal(ranked[0].rank, 1);
});

test("eligibility filtering composes with deterministic ranking by strategy mode", () => {
  const snapshot = [
    {
      intentId: "intent-3",
      traceId: "trace-3",
      sourceMarketId: "dflow-c",
      targetMarketId: "pnp-c",
      expectedValueUsd: 0.7,
      liquidityUsd: 6_000,
      fillProbability: 0.58,
      createdAtMs: 3_000,
      ...calculateEdgeNet({
        grossEdge: 0.35,
        feeCost: 0.1,
        slippageCost: 0.05,
        confidencePenalty: 0.03,
        stalenessPenalty: 0.02,
        latencyPenalty: 0.01,
      }),
    },
    {
      intentId: "intent-2",
      traceId: "trace-2",
      sourceMarketId: "dflow-b",
      targetMarketId: "pnp-b",
      expectedValueUsd: 1.4,
      liquidityUsd: 9_000,
      fillProbability: 0.72,
      createdAtMs: 2_000,
      ...calculateEdgeNet({
        grossEdge: 0.52,
        feeCost: 0.1,
        slippageCost: 0.1,
        confidencePenalty: 0.05,
        stalenessPenalty: 0.03,
        latencyPenalty: 0.02,
      }),
    },
    {
      intentId: "intent-1",
      traceId: "trace-1",
      sourceMarketId: "dflow-a",
      targetMarketId: "pnp-a",
      expectedValueUsd: 2.4,
      liquidityUsd: 16_000,
      fillProbability: 0.9,
      createdAtMs: 1_000,
      ...calculateEdgeNet({
        grossEdge: 0.75,
        feeCost: 0.1,
        slippageCost: 0.1,
        confidencePenalty: 0.05,
        stalenessPenalty: 0.03,
        latencyPenalty: 0.02,
      }),
    },
  ];

  const aggressiveRanked = rankCandidates(filterEligibleCandidates(snapshot, "aggressive"));
  const conservativeRanked = rankCandidates(filterEligibleCandidates(snapshot, "conservative"));

  assert.deepEqual(
    aggressiveRanked.map((candidate) => candidate.intentId),
    ["intent-1", "intent-2", "intent-3"],
  );
  assert.deepEqual(
    conservativeRanked.map((candidate) => candidate.intentId),
    ["intent-1"],
  );
});

test("paper arbitrage loop generates deterministic decision logs and artifacts", () => {
  const marketQuotes = [
    {
      traceId: "trace-z",
      canonicalEventId: "pm_evt_v1_z",
      canonicalMarketId: "pm_mkt_v1_b",
      venue: "pnp",
      venueMarketId: "pnp-1",
      yesBidPrice: 0.68,
      yesAskPrice: 0.7,
      observedAtMs: 4000,
      freshnessTier: "fresh",
      integrityStatus: "ok",
    },
    {
      traceId: "trace-z",
      canonicalEventId: "pm_evt_v1_z",
      canonicalMarketId: "pm_mkt_v1_b",
      venue: "dflow",
      venueMarketId: "df-1",
      yesBidPrice: 0.59,
      yesAskPrice: 0.61,
      observedAtMs: 4000,
      freshnessTier: "fresh",
      integrityStatus: "ok",
    },
    {
      traceId: "trace-z",
      canonicalEventId: "pm_evt_v1_z",
      canonicalMarketId: "pm_mkt_v1_a",
      venue: "gemini",
      venueMarketId: "gm-2",
      yesBidPrice: 0.5,
      yesAskPrice: 0.53,
      observedAtMs: 4000,
      freshnessTier: "fresh",
      integrityStatus: "ok",
    },
  ];

  const result = runPaperArbitrageLoop(marketQuotes, {
    minSpreadToTrade: 0.03,
    tradeNotionalUsd: 100,
    nowMs: 777_000,
  });

  assert.deepEqual(result.intents.map((intent) => intent.canonicalMarketId), ["pm_mkt_v1_b"]);
  assert.equal(result.intents[0].executionMode, "paper_only");
  assert.equal(result.intents[0].noNakedExposure.passed, true);
  assert.deepEqual(
    result.decisionLogs.map((log) => `${log.canonicalMarketId}:${log.decision}`),
    ["pm_mkt_v1_a:rejected", "pm_mkt_v1_b:accepted"],
  );
});
