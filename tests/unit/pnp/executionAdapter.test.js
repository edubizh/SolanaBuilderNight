import test from "node:test";
import assert from "node:assert/strict";
import { PnpExecutionAdapter } from "../../../services/execution-orchestrator/adapters/pnp/executionAdapter.js";

test("discoverMarkets returns only v2 by default", async () => {
  const adapter = new PnpExecutionAdapter({
    client: {
      async discoverMarkets() {
        return [
          { marketId: "m3", version: "v2" },
          { marketId: "m2", version: "v3" },
          { marketId: "m1", version: "v2" },
        ];
      },
    },
  });

  const markets = await adapter.discoverMarkets();
  assert.deepEqual(markets, [
    { marketId: "m1", version: "v2" },
    { marketId: "m3", version: "v2" },
  ]);
});

test("discoverMarkets includes v3 when feature flag is enabled", async () => {
  const adapter = new PnpExecutionAdapter({
    enableV3: true,
    client: {
      async discoverMarkets() {
        return [
          { marketId: "m1", version: "v2" },
          { marketId: "m2", version: "v3" },
        ];
      },
    },
  });

  const markets = await adapter.discoverMarkets();
  assert.deepEqual(markets, [
    { marketId: "m1", version: "v2" },
    { marketId: "m2", version: "v3" },
  ]);
});

test("discoverMarkets includes v3 when pnpV3 feature flag scaffold is enabled", async () => {
  const adapter = new PnpExecutionAdapter({
    featureFlags: { pnpV3: true },
    client: {
      async discoverMarkets() {
        return [
          { marketId: "m1", version: "v2" },
          { marketId: "m2", version: "v3" },
        ];
      },
    },
  });

  const markets = await adapter.discoverMarkets();
  assert.deepEqual(markets, [
    { marketId: "m1", version: "v2" },
    { marketId: "m2", version: "v3" },
  ]);
});

test("getPrice validates marketId and delegates to client quote flow", async () => {
  const adapter = new PnpExecutionAdapter({
    now: () => 1713700001000,
    client: {
      async getQuote({ marketId, size }) {
        return {
          marketId,
          size,
          price: 123.45,
          sourceTimestampMs: 1713700000000,
          fetchedAtMs: 1713700000000,
        };
      },
    },
  });

  await assert.rejects(() => adapter.getPrice({ marketId: "", size: 1 }), /requires marketId/);

  const quote = await adapter.getPrice({ marketId: "m1", size: 2 });
  assert.equal(quote.price, 123.45);
  assert.equal(quote.marketId, "m1");
});

test("getPrice rejects stale quote and malformed quote payloads", async () => {
  const staleAdapter = new PnpExecutionAdapter({
    now: () => 1713700010000,
    maxQuoteAgeMs: 1000,
    client: {
      async getQuote() {
        return {
          marketId: "m1",
          size: 2,
          price: 123.45,
          sourceTimestampMs: 1713700000000,
          fetchedAtMs: 1713700000000,
        };
      },
    },
  });
  await assert.rejects(() => staleAdapter.getPrice({ marketId: "m1", size: 2 }), /quote is stale/);

  const malformedAdapter = new PnpExecutionAdapter({
    now: () => 1713700000000,
    client: {
      async getQuote() {
        return { marketId: "m1", size: 2, price: 0, fetchedAtMs: 1713700000000 };
      },
    },
  });
  await assert.rejects(
    () => malformedAdapter.getPrice({ marketId: "m1", size: 2 }),
    /quote price must be a positive number/,
  );

  const mismatchAdapter = new PnpExecutionAdapter({
    now: () => 1713700000000,
    client: {
      async getQuote() {
        return { marketId: "m2", size: 2, price: 10, fetchedAtMs: 1713700000000 };
      },
    },
  });
  await assert.rejects(
    () => mismatchAdapter.getPrice({ marketId: "m1", size: 2 }),
    /marketId mismatch/,
  );
});

test("executeOrder delegates to client", async () => {
  const adapter = new PnpExecutionAdapter({
    now: () => 1713700000000,
    client: {
      async submitOrder(order) {
        return { ...order, orderId: "pnp-1", status: "accepted", acceptedAtMs: 1713700000000 };
      },
    },
  });

  const result = await adapter.executeOrder({
    intentId: "intent-1",
    marketId: "m1",
    side: "buy",
    size: 1,
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.orderId, "pnp-1");
  assert.equal(result.side, "buy");
  assert.equal(result.size, 1);
});

test("executeOrder rejects invalid side and invalid size", async () => {
  const adapter = new PnpExecutionAdapter({
    client: { async submitOrder() {} },
  });

  await assert.rejects(
    () =>
      adapter.executeOrder({
        intentId: "intent-1",
        marketId: "m1",
        side: "hold",
        size: 1,
      }),
    /buy or sell/,
  );

  await assert.rejects(
    () =>
      adapter.executeOrder({
        intentId: "intent-1",
        marketId: "m1",
        side: "sell",
        size: 0,
      }),
    /positive number/,
  );
});

test("executeOrder blocks v3 markets when feature flag is disabled", async () => {
  const adapter = new PnpExecutionAdapter({
    client: { async submitOrder() {} },
  });

  await assert.rejects(
    () =>
      adapter.executeOrder({
        intentId: "intent-v3-blocked",
        marketId: "m3",
        marketVersion: "v3",
        side: "buy",
        size: 1,
      }),
    /requires pnpV3 feature flag/,
  );
});

test("executeOrder allows v3 markets when feature flag is enabled", async () => {
  const adapter = new PnpExecutionAdapter({
    featureFlags: { pnpV3: true },
    client: {
      async submitOrder(order) {
        return { ...order, orderId: "pnp-v3", status: "accepted" };
      },
    },
  });

  const result = await adapter.executeOrder({
    intentId: "intent-v3-enabled",
    marketId: "m3",
    marketVersion: "v3",
    side: "sell",
    size: 2,
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.orderId, "pnp-v3");
});

test("executeOrder enforces custom-oracle 15-minute resolvable guardrail", async () => {
  const adapter = new PnpExecutionAdapter({
    now: () => 1713700000000,
    client: {
      async submitOrder(order) {
        return { ...order, orderId: "pnp-2", status: "accepted" };
      },
    },
  });

  await assert.rejects(
    () =>
      adapter.executeOrder({
        intentId: "intent-2",
        marketId: "m2",
        side: "buy",
        size: 2,
        customOracleGuardrail: {
          requiresResolvableBy: true,
          marketCreatedAtMs: 1713699000000,
        },
      }),
    /window exceeded 15 minutes/,
  );

  const accepted = await adapter.executeOrder({
    intentId: "intent-3",
    marketId: "m3",
    side: "sell",
    size: 2,
    customOracleGuardrail: {
      requiresResolvableBy: true,
      marketCreatedAtMs: 1713699400000,
    },
  });
  assert.equal(accepted.status, "accepted");
});
