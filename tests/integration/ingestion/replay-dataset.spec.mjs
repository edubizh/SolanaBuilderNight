import test from "node:test";
import assert from "node:assert/strict";

import { INGESTION_REPLAY_DATASET } from "../../../services/ingestion-gateway/src/replay-dataset.ts";
import { replayDatasetToNormalizedFrames } from "../../../services/state-normalizer/src/replay-dataset.ts";

test("replay dataset normalizes into deterministic canonical ingestion frames", () => {
  const frames = replayDatasetToNormalizedFrames(INGESTION_REPLAY_DATASET);
  assert.equal(frames.length, 3);

  const bySource = new Map(frames.map((frame) => [frame.source, frame]));

  const coingecko = bySource.get("coingecko");
  assert.ok(coingecko);
  assert.equal(coingecko.eventId, "coingecko:coingecko:sol:tick-001");
  assert.equal(coingecko.observedAtMs, 1_776_787_200_000);
  assert.deepEqual(coingecko.payload, {
    tokenAddress: "So11111111111111111111111111111111111111112",
    price: "133.25"
  });

  const pyth = bySource.get("pyth-hermes");
  assert.ok(pyth);
  assert.equal(pyth.eventId, "pyth-hermes:pyth:sol:tick-001");
  assert.equal(pyth.observedAtMs, 1_776_787_202_000);
  assert.deepEqual(pyth.payload, {
    feedId: "0xef0d8b6fda2ceba41f64aaf3f35f8f62a2f5f5d708f8f7a6f5d8b67745f7b1d1",
    confidence: "31",
    publishTimeSec: 1_776_787_202,
    price: "133.27"
  });

  const helius = bySource.get("helius");
  assert.ok(helius);
  assert.equal(helius.eventId, "helius:4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM|321654987");
  assert.equal(helius.observedAtMs, 1_776_787_207_000);
  assert.equal(helius.traceId, "helius:sol:tx-001");
  assert.deepEqual(helius.payload, {
    signature: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
    slot: 321_654_987,
    accountKeys: [
      "So11111111111111111111111111111111111111112",
      "9xQeWvG816bUx9EPf5f8G9R8vMELx2wV6zvY1mQfD9z"
    ],
    instructionCount: 3
  });
});
