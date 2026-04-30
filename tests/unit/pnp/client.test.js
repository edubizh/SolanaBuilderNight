import test from "node:test";
import assert from "node:assert/strict";
import { PnpClient } from "../../../services/execution-orchestrator/adapters/pnp/client.js";

test("discoverMarkets normalizes response payload from object wrapper", async () => {
  const client = new PnpClient({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          markets: [
            {
              id: "pnp-btc-usdc-v2",
              version: "V2",
              baseAssetSymbol: "BTC",
              quoteAssetSymbol: "USDC",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  const markets = await client.discoverMarkets();
  assert.deepEqual(markets, [
    {
      marketId: "pnp-btc-usdc-v2",
      version: "v2",
      baseSymbol: "BTC",
      quoteSymbol: "USDC",
    },
  ]);
});

test("getQuote validates size and returns normalized quote", async () => {
  const client = new PnpClient({
    now: () => 1713700000000,
    fetchImpl: async () =>
      new Response(JSON.stringify({ price: "23.456" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(() => client.getQuote({ marketId: "pnp-sol-usdc-v2", size: 0 }), /positive number/);

  const quote = await client.getQuote({ marketId: "pnp-sol-usdc-v2", size: 5 });
  assert.deepEqual(quote, {
    marketId: "pnp-sol-usdc-v2",
    price: 23.456,
    size: 5,
    sourceTimestampMs: 1713700000000,
    fetchedAtMs: 1713700000000,
  });
});

test("getQuote rejects mismatched market/size and invalid timestamp", async () => {
  const now = 1713700000000;
  const marketMismatchClient = new PnpClient({
    now: () => now,
    fetchImpl: async () =>
      new Response(JSON.stringify({ marketId: "other-market", price: 10 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => marketMismatchClient.getQuote({ marketId: "pnp-sol-usdc-v2", size: 2 }),
    /marketId mismatch/,
  );

  const sizeMismatchClient = new PnpClient({
    now: () => now,
    fetchImpl: async () =>
      new Response(JSON.stringify({ marketId: "pnp-sol-usdc-v2", price: 10, size: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => sizeMismatchClient.getQuote({ marketId: "pnp-sol-usdc-v2", size: 2 }),
    /size mismatch/,
  );

  const invalidTimestampClient = new PnpClient({
    now: () => now,
    fetchImpl: async () =>
      new Response(JSON.stringify({ marketId: "pnp-sol-usdc-v2", price: 10, quotedAtMs: "bad" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => invalidTimestampClient.getQuote({ marketId: "pnp-sol-usdc-v2", size: 2 }),
    /invalid timestamp/,
  );
});

test("submitOrder validates buy/sell request and POSTs /orders", async () => {
  const now = 1713700000000;
  let lastInit;
  const client = new PnpClient({
    now: () => now,
    baseUrl: "https://pnp.test",
    fetchImpl: async (url, init) => {
      lastInit = init;
      const u = new URL(url);
      assert.equal(u.pathname, "/orders");
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.intentId, "i2");
      assert.equal(body.maxSlippageBps, 75);
      return new Response(
        JSON.stringify({ orderId: "ord-42", status: "submitted", submittedAtMs: now }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    () => client.submitOrder({ intentId: "i1", marketId: "m1", side: "hold", size: 1 }),
    /buy or sell/,
  );
  await assert.rejects(
    () => client.submitOrder({ intentId: "i1", marketId: "m1", side: "buy", size: -1 }),
    /positive number/,
  );

  const result = await client.submitOrder({
    intentId: "i2",
    marketId: "m2",
    side: "sell",
    size: 3,
    maxSlippageBps: 75,
  });

  assert.deepEqual(result, {
    intentId: "i2",
    marketId: "m2",
    side: "sell",
    size: 3,
    maxSlippageBps: 75,
    orderId: "ord-42",
    status: "submitted",
    acceptedAtMs: now,
  });
  assert.equal(lastInit.method, "POST");
});

test("getOrderStatus passes orderId and intentId as query params", async () => {
  const seen = [];
  const client = new PnpClient({
    baseUrl: "https://pnp.test",
    fetchImpl: async (url) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({
          status: "open",
          orderId: "o1",
          updatedAtMs: 1000,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await client.getOrderStatus({ orderId: "o1", intentId: "in-1" });
  const u = new URL(seen[0]);
  assert.equal(u.searchParams.get("orderId"), "o1");
  assert.equal(u.searchParams.get("intentId"), "in-1");
  assert.equal(u.pathname, "/orders/status");
});

test("getQuote retries once on 500 then succeeds", async () => {
  const now = 1713700000000;
  let calls = 0;
  const sleeps = [];
  const client = new PnpClient({
    now: () => now,
    baseUrl: "https://pnp.test",
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    fetchImpl: async (url) => {
      const u = new URL(url);
      assert.equal(u.pathname, "/quote");
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "retry" }), { status: 500 });
      }
      return new Response(
        JSON.stringify({ price: 10, marketId: "pnp-sol-usdc-v2", size: 2, quotedAtMs: now }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const quote = await client.getQuote({ marketId: "pnp-sol-usdc-v2", size: 2 });
  assert.equal(quote.price, 10);
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 100);
});
