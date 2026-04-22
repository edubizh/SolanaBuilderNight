import test from "node:test";
import assert from "node:assert/strict";

import { HeliusStreamConnector } from "../../../services/ingestion-gateway/src/connectors/helius-stream-connector.ts";
import { toCanonicalHeliusEvent } from "../../../services/state-normalizer/src/helius-parser-adapter.ts";

test("helius stream connector parses transaction envelope", () => {
  const connector = new HeliusStreamConnector({
    endpoint: "wss://example.helius.local",
    apiKey: "helius-key"
  });

  assert.equal(
    connector.buildStreamUrl(),
    "wss://example.helius.local?api-key=helius-key"
  );

  const parsed = connector.parseStreamEvent(
    JSON.stringify({
      params: {
        result: {
          value: {
            signature: "sig-1",
            slot: 321,
            timestamp: 1_700_000_000,
            transaction: {
              message: {
                accountKeys: ["acc-1", "acc-2"],
                instructions: [{}, {}]
              }
            }
          }
        }
      }
    })
  );

  assert.ok(parsed);
  assert.equal(parsed.signature, "sig-1");
  assert.equal(parsed.instructionCount, 2);

  const canonical = toCanonicalHeliusEvent(parsed);
  assert.equal(canonical.source, "helius");
  assert.equal(canonical.payload.slot, 321);
  assert.equal(canonical.eventId, "helius:sig-1|321");
});
