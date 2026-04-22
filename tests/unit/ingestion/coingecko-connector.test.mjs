import test from "node:test";
import assert from "node:assert/strict";

import { CoinGeckoConnector } from "../../../services/ingestion-gateway/src/connectors/coingecko-connector.ts";

test("coingecko connector applies api key header policy", async () => {
  const capturedHeaders = [];
  const connector = new CoinGeckoConnector({
    baseUrl: "https://example.coingecko.local",
    rateLimitPolicy: {
      apiKey: "demo-key",
      keyHeaderName: "x-cg-pro-api-key"
    },
    fetchImpl: async (_url, init) => {
      capturedHeaders.push(init?.headers);
      return new Response(JSON.stringify({ data: { attributes: { price_usd: "1.25" } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await connector.fetchTokenPriceContext("solana", "So11111111111111111111111111111111111111112");
  assert.deepEqual(capturedHeaders[0], { "x-cg-pro-api-key": "demo-key" });
});

test("coingecko connector retries with exponential backoff on rate limits", async () => {
  const sleepCalls = [];
  let attempts = 0;
  const connector = new CoinGeckoConnector({
    baseUrl: "https://example.coingecko.local",
    retryPolicy: {
      maxRetries: 2,
      initialBackoffMs: 25,
      maxBackoffMs: 100
    },
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(null, { status: 429 });
      }

      return new Response(JSON.stringify({ data: { attributes: { price_usd: "2.1" } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const context = await connector.fetchTokenPriceContext("solana", "token-address");
  assert.equal(context.priceUsd, 2.1);
  assert.equal(attempts, 3);
  assert.deepEqual(sleepCalls, [25, 50]);
});
