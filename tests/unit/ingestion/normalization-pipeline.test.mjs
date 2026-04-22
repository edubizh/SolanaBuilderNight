import test from "node:test";
import assert from "node:assert/strict";

import {
  createEventIdentity,
  normalizeDecimal,
  normalizeSnapshot,
  normalizeTimestampMs
} from "../../../services/state-normalizer/src/index.ts";

test("normalizeDecimal preserves sign and pads fractional precision", () => {
  assert.equal(normalizeDecimal(12345n, 2), "123.45");
  assert.equal(normalizeDecimal(-12345n, 3), "-12.345");
});

test("normalizeTimestampMs handles seconds epoch, milliseconds epoch, and iso strings", () => {
  assert.equal(normalizeTimestampMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeTimestampMs(1_700_000_000_456), 1_700_000_000_456);
  assert.equal(normalizeTimestampMs("2024-01-01T00:00:00Z"), 1_704_067_200_000);
});

test("normalizeSnapshot emits deterministic identity and canonical observedAtMs", () => {
  const snapshot = normalizeSnapshot(
    {
      source: "pyth-hermes",
      symbol: "SOL/USD",
      priceAtomic: 9_876_543n,
      decimals: 6,
      observedAt: 1_700_000_000
    },
    1_700_000_005_000
  );

  assert.equal(snapshot.observedAtMs, 1_700_000_000_000);
  assert.equal(snapshot.price, "9.876543");
  assert.equal(snapshot.eventId, "pyth-hermes:SOL/USD|9876543|6");
  assert.equal(snapshot.traceId, "pyth-hermes:SOL/USD|9876543|6");
  assert.equal(snapshot.normalizedAtMs, 1_700_000_005_000);
});

test("createEventIdentity favors explicit external ids", () => {
  const identity = createEventIdentity({
    source: "coingecko",
    externalEventId: "coingecko-event-123",
    observedAtMs: 1_700_000_000_000,
    identityComponents: ["ignored"]
  });

  assert.equal(identity.eventId, "coingecko:coingecko-event-123");
  assert.equal(identity.traceId, "coingecko:coingecko-event-123");
});
