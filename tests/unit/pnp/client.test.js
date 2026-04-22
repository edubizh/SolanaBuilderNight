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
    fetchedAtMs: 1713700000000,
  });
});

test("submitOrder validates buy/sell request and returns accepted payload", async () => {
  const client = new PnpClient({ now: () => 1713700000000 });

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
    orderId: "pnp-i2",
    status: "accepted",
    acceptedAtMs: 1713700000000,
  });
});
