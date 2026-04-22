import test from "node:test";
import assert from "node:assert/strict";

import { PythHermesConnector } from "../../../services/ingestion-gateway/src/connectors/pyth-hermes-connector.ts";

test("pyth hermes connector extracts staleness and confidence ratio", async () => {
  const connector = new PythHermesConnector({
    baseUrl: "https://example.hermes.local",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          parsed: [
            {
              id: "feed-1",
              price: {
                price: "100",
                conf: "2",
                publish_time: 1_700_000_000
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
  });

  const snapshot = await connector.fetchLatestPrice("feed-1", 1_700_000_004_000);
  assert.equal(snapshot.feedId, "feed-1");
  assert.equal(snapshot.stalenessMs, 4_000);
  assert.equal(snapshot.confidenceRatio, 0.02);
});
