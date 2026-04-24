import test from "node:test";
import assert from "node:assert/strict";
import { GeminiPredictionAdapter } from "../../../services/execution-orchestrator/adapters/gemini/index.js";

test("GeminiPredictionAdapter scaffolds market/quote request paths", async () => {
  const calls = [];
  const adapter = new GeminiPredictionAdapter({
    baseUrl: "https://example.gemini",
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      calls.push({ path: parsed.pathname, search: parsed.search, method: init.method, headers: init.headers });

      if (parsed.pathname === "/v1/prediction/markets") {
        return new Response(
          JSON.stringify({
            markets: [{ id: "mkt-1", symbol: "BTC_UP", status: "OPEN", outcomes: [{ id: "yes", name: "Yes" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          marketId: "mkt-1",
          bid: "0.44",
          ask: "0.48",
          timestamp_ms: "1710000000010",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const markets = await adapter.getMarkets({ venue: "prediction" });
  const quote = await adapter.getQuote(
    { marketId: "mkt-1", side: "buy" },
    { auth: { apiKey: "test-key", apiSecret: "test-secret", accountId: "acct-1" } },
  );

  assert.equal(markets.length, 1);
  assert.equal(markets[0].marketId, "mkt-1");
  assert.equal(quote.marketId, "mkt-1");
  assert.equal(quote.bid, 0.44);
  assert.equal(quote.ask, 0.48);
  assert.equal(quote.timestampMs, 1710000000010);

  assert.deepEqual(
    calls.map((call) => [call.path, call.method]),
    [
      ["/v1/prediction/markets", "GET"],
      ["/v1/prediction/quote", "GET"],
    ],
  );
  assert.match(calls[0].search, /venue=prediction/);
  assert.match(calls[1].search, /marketId=mkt-1/);
  assert.equal(calls[1].headers["x-gemini-api-key"], "test-key");
  assert.equal(calls[1].headers["x-gemini-account"], "acct-1");
});

test("GeminiPredictionAdapter can require auth surface for quote", async () => {
  const adapter = new GeminiPredictionAdapter({
    requireAuthForQuote: true,
    fetchImpl: async () =>
      new Response(JSON.stringify({ marketId: "mkt-1", bid: "0.1", ask: "0.2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    () => adapter.getQuote({ marketId: "mkt-1" }, { auth: { apiKey: "only-key" } }),
    /requires auth credentials/,
  );
});
