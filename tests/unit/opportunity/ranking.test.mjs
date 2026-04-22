import test from "node:test";
import assert from "node:assert/strict";

import { compareCandidates, rankCandidates } from "../../../services/opportunity-engine/src/index.js";

test("compareCandidates applies deterministic tie-break order", () => {
  const older = {
    intentId: "intent-b",
    traceId: "trace-1",
    sourceMarketId: "m1",
    targetMarketId: "m2",
    edgeNet: 10,
    expectedValueUsd: 5,
    fillProbability: 0.8,
    liquidityUsd: 12_000,
    createdAtMs: 10,
  };

  const newer = { ...older, createdAtMs: 20 };
  const largerEdge = { ...older, edgeNet: 11 };
  const higherFillProbability = { ...older, fillProbability: 0.9 };
  const higherLiquidity = { ...older, liquidityUsd: 20_000 };

  assert.equal(compareCandidates(largerEdge, older) < 0, true);
  assert.equal(compareCandidates(higherFillProbability, older) < 0, true);
  assert.equal(compareCandidates(higherLiquidity, older) < 0, true);
  assert.equal(compareCandidates(older, newer) < 0, true);
  assert.equal(compareCandidates(older, { ...older, intentId: "intent-z" }) < 0, true);
});

test("rankCandidates returns stable, ranked output", () => {
  const candidates = [
    {
      intentId: "intent-c",
      traceId: "trace-3",
      sourceMarketId: "m1",
      targetMarketId: "m2",
      edgeNet: 10,
      expectedValueUsd: 4,
      fillProbability: 0.75,
      liquidityUsd: 12_000,
      createdAtMs: 15,
    },
    {
      intentId: "intent-a",
      traceId: "trace-1",
      sourceMarketId: "m1",
      targetMarketId: "m2",
      edgeNet: 11,
      expectedValueUsd: 2,
      fillProbability: 0.7,
      liquidityUsd: 10_000,
      createdAtMs: 20,
    },
    {
      intentId: "intent-b",
      traceId: "trace-2",
      sourceMarketId: "m1",
      targetMarketId: "m2",
      edgeNet: 10,
      expectedValueUsd: 4,
      fillProbability: 0.9,
      liquidityUsd: 9_000,
      createdAtMs: 10,
    },
  ];

  const ranked = rankCandidates(candidates);
  assert.deepEqual(
    ranked.map((item) => item.intentId),
    ["intent-a", "intent-b", "intent-c"],
  );
  assert.deepEqual(
    ranked.map((item) => item.rank),
    [1, 2, 3],
  );
});
