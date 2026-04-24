import test from "node:test";
import assert from "node:assert/strict";

import { INGESTION_REPLAY_DATASET } from "../../../services/ingestion-gateway/src/replay-dataset.ts";

test("ingestion replay dataset includes all required provider frames", () => {
  assert.equal(INGESTION_REPLAY_DATASET.datasetId, "ingestion-baseline-2026-04-21");
  assert.equal(INGESTION_REPLAY_DATASET.version, "1.0.0");
  assert.equal(INGESTION_REPLAY_DATASET.frames.length, 3);

  const providers = INGESTION_REPLAY_DATASET.frames.map((frame) => frame.source).sort();
  assert.deepEqual(providers, ["coingecko", "helius", "pyth-hermes"]);

  for (const frame of INGESTION_REPLAY_DATASET.frames) {
    assert.ok(frame.venueEventId.length > 0);
    assert.ok(frame.venueMarketId.length > 0);
    assert.ok(frame.venueOutcomeId.length > 0);
    assert.ok(frame.eventTitle.length > 0);
    assert.ok(frame.eventStartAt.length > 0);
    assert.ok(frame.marketQuestion.length > 0);
    assert.ok(frame.outcomeLabel.length > 0);
  }
});
