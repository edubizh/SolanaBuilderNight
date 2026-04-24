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

test("GeminiPredictionAdapter fails closed when guarded-live submission errors", async () => {
  const adapter = new GeminiPredictionAdapter({
    executionMode: "guarded_live",
    allowLiveExecution: true,
    now: () => 1_710_000_000_000,
    executeOrderHook: async () => {
      throw new Error("provider unavailable");
    },
  });
  const { approvalId } = adapter.createApproval({
    intentId: "intent-1",
    approvedBy: "operator",
    approvedNotionalUsd: 50,
    ttlMs: 120_000,
  });

  const result = await adapter.executeGuardedOrder({
    intentId: "intent-1",
    estimatedNotionalUsd: 25,
    currentNetExposureUsd: 10,
    projectedNetExposureUsd: 0,
    hedgedExposureUsd: 0,
    slippageBps: 10,
    quote: { bid: 0.4, ask: 0.5 },
    live: true,
    approvalId,
    swapPayload: { marketId: "mkt-1", side: "buy", quantity: "1" },
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.artifact.liveExecuted, false);
  assert.equal(result.artifact.submission.executed, false);
  assert.equal(result.artifact.submission.simulated, true);
  assert.match(result.artifact.submission.error, /provider unavailable/);
  assert.ok(result.artifact.assessment.violations.includes("LIVE_SUBMISSION_FAILED"));
});

test("GeminiPredictionAdapter forwards deterministic idempotency key on live order", async () => {
  const headersByPath = [];
  const adapter = new GeminiPredictionAdapter({
    baseUrl: "https://example.gemini",
    executionMode: "guarded_live",
    allowLiveExecution: true,
    requestRetries: 0,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/v1/prediction/orders") {
        headersByPath.push(init.headers ?? {});
        return new Response(JSON.stringify({ providerOrderId: "ord-1", attempts: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });
  const { approvalId } = adapter.createApproval({
    intentId: "intent-2",
    approvedBy: "operator",
    approvedNotionalUsd: 50,
    ttlMs: 120_000,
  });

  const result = await adapter.executeGuardedOrder({
    intentId: "intent-2",
    estimatedNotionalUsd: 20,
    currentNetExposureUsd: 10,
    projectedNetExposureUsd: 0,
    hedgedExposureUsd: 0,
    slippageBps: 5,
    quote: { bid: 0.1, ask: 0.2 },
    live: true,
    approvalId,
    swapPayload: { marketId: "mkt-2", side: "buy", quantity: "1" },
  });

  assert.equal(result.status, "executed");
  assert.equal(headersByPath.length, 1);
  assert.equal(headersByPath[0]["x-idempotency-key"], "gmn-intent-2");
});
