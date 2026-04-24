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
  assert.equal(coingecko.venue, "dflow");
  assert.equal(coingecko.payload.tokenAddress, "So11111111111111111111111111111111111111112");
  assert.equal(coingecko.payload.price, "133.25");
  assert.equal(coingecko.payload.canonicalMapping.id_version, "v1");
  assert.match(coingecko.payload.canonicalMapping.canonical_event_id, /^pm_evt_v1_[a-z0-9]{24}$/);
  assert.match(coingecko.payload.canonicalMapping.canonical_market_id, /^pm_mkt_v1_[a-z0-9]{24}$/);
  assert.match(coingecko.payload.canonicalMapping.canonical_outcome_id, /^pm_out_v1_[a-z0-9]{24}$/);
  assert.equal(coingecko.payload.quoteQuality.integrity_status, "ok");
  assert.equal(coingecko.payload.quoteQuality.freshness_tier, "realtime");

  const pyth = bySource.get("pyth-hermes");
  assert.ok(pyth);
  assert.equal(pyth.eventId, "pyth-hermes:pyth:sol:tick-001");
  assert.equal(pyth.observedAtMs, 1_776_787_202_000);
  assert.equal(pyth.venue, "gemini");
  assert.equal(pyth.payload.feedId, "0xef0d8b6fda2ceba41f64aaf3f35f8f62a2f5f5d708f8f7a6f5d8b67745f7b1d1");
  assert.equal(pyth.payload.confidence, "31");
  assert.equal(pyth.payload.publishTimeSec, 1_776_787_202);
  assert.equal(pyth.payload.price, "133.27");
  assert.equal(pyth.payload.quoteQuality.integrity_status, "ok");
  assert.equal(pyth.payload.quoteQuality.freshness_tier, "realtime");

  const helius = bySource.get("helius");
  assert.ok(helius);
  assert.equal(helius.eventId, "helius:4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM|321654987");
  assert.equal(helius.observedAtMs, 1_776_787_207_000);
  assert.equal(helius.traceId, "helius:sol:tx-001");
  assert.equal(helius.venue, "pnp");
  assert.equal(helius.payload.signature, "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM");
  assert.equal(helius.payload.slot, 321_654_987);
  assert.deepEqual(helius.payload.accountKeys, [
    "So11111111111111111111111111111111111111112",
    "9xQeWvG816bUx9EPf5f8G9R8vMELx2wV6zvY1mQfD9z"
  ]);
  assert.equal(helius.payload.instructionCount, 3);
  assert.equal(helius.payload.quoteQuality.integrity_status, "ok");
  assert.equal(helius.payload.quoteQuality.freshness_tier, "realtime");

  const canonicalEventIds = new Set(
    frames.map((frame) => frame.payload.canonicalMapping.canonical_event_id)
  );
  const canonicalMarketIds = new Set(
    frames.map((frame) => frame.payload.canonicalMapping.canonical_market_id)
  );
  const canonicalOutcomeIds = new Set(
    frames.map((frame) => frame.payload.canonicalMapping.canonical_outcome_id)
  );
  assert.equal(canonicalEventIds.size, 1);
  assert.equal(canonicalMarketIds.size, 1);
  assert.equal(canonicalOutcomeIds.size, 1);
});
