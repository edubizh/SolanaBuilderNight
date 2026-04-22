import test from "node:test";
import assert from "node:assert/strict";
import { DFlowAdapter } from "../../../services/execution-orchestrator/adapters/dflow/index.js";

function createFetchStub() {
  const calls = [];
  /**
   * @param {URL} url
   * @param {RequestInit} init
   */
  async function fetchStub(url, init = {}) {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, path: new URL(url).pathname }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return { calls, fetchStub };
}

test("DFlowAdapter serializes query params for GET /order", async () => {
  const { calls, fetchStub } = createFetchStub();
  const adapter = new DFlowAdapter({ fetchImpl: fetchStub, tradingBaseUrl: "https://example.dflow" });

  await adapter.getOrder({ market: "abc", side: "buy", includeRoutePlan: true });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/order\?/);
  assert.match(calls[0].url, /market=abc/);
  assert.match(calls[0].url, /side=buy/);
  assert.match(calls[0].url, /includeRoutePlan=true/);
  assert.equal(calls[0].init.method, "GET");
});

test("DFlowAdapter sends JSON payload for POST /swap", async () => {
  const { calls, fetchStub } = createFetchStub();
  const adapter = new DFlowAdapter({ fetchImpl: fetchStub, tradingBaseUrl: "https://example.dflow" });
  const payload = { quoteId: "q1", intentId: "intent-1", amountIn: "1000" };

  const result = await adapter.postSwap(payload);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify(payload));
  assert.deepEqual(result, { ok: true, path: "/swap" });
});

test("DFlowAdapter parses transaction payloads from GET /order response", async () => {
  const serializedA = Buffer.from("tx-a").toString("base64");
  const serializedB = Buffer.from("tx-b").toString("base64");
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://example.dflow",
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/order");
      return new Response(
        JSON.stringify({
          orderId: "ord-1",
          transactions: [
            {
              tx: serializedA,
              routePlan: [{ pool: "pool-1", percent: 100 }],
              expectedOutAmount: 12345,
            },
          ],
          cleanupTransaction: serializedB,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await adapter.getOrderWithParsedTransactions({ market: "mkt-1" });

  assert.equal(result.parsedTransactions.length, 2);
  assert.equal(result.parsedTransactions[0].encoding, "base64");
  assert.equal(result.parsedTransactions[0].byteLength, 4);
  assert.equal(result.parsedTransactions[0].expectedOutAmount, "12345");
  assert.equal(result.parsedTransactions[1].sourceField, "cleanupTransaction");
});

test("DFlowAdapter executeImperativeSwap composes quote into swap payload", async () => {
  const calls = [];
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://example.dflow",
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method, body: init.body });

      if (path === "/quote") {
        return new Response(JSON.stringify({ quoteId: "q-123", amountOut: "900" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ swapId: "swap-1", status: "submitted" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await adapter.executeImperativeSwap(
    { market: "mkt-1", side: "buy", amountIn: "1000" },
    { intentId: "intent-1" },
  );

  assert.deepEqual(calls.map((entry) => [entry.path, entry.method]), [
    ["/quote", "GET"],
    ["/swap", "POST"],
  ]);
  assert.equal(calls[1].body, JSON.stringify({ intentId: "intent-1", quoteId: "q-123" }));
  assert.equal(result.quote.quoteId, "q-123");
  assert.equal(result.swap.swapId, "swap-1");
});

test("DFlowAdapter tracks async order status until terminal state", async () => {
  const states = ["pending", "routing", "filled"];
  let callCount = 0;

  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://example.dflow",
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/order-status");
      const state = states[Math.min(callCount, states.length - 1)];
      callCount += 1;
      return new Response(JSON.stringify({ orderId: "ord-1", status: state }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const lifecycle = await adapter.trackOrderStatusLifecycle(
    { orderId: "ord-1" },
    { pollIntervalMs: 0, maxAttempts: 6 },
  );

  assert.equal(lifecycle.terminal, true);
  assert.equal(lifecycle.timedOut, false);
  assert.equal(lifecycle.maxAttemptsReached, false);
  assert.equal(lifecycle.attempts, 3);
  assert.equal(lifecycle.finalState, "filled");
  assert.equal(lifecycle.history.length, 3);
});

test("DFlowAdapter reports timeout when async status never reaches terminal", async () => {
  let currentTimeMs = 0;
  const originalNow = Date.now;
  Date.now = () => currentTimeMs;

  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://example.dflow",
    sleepImpl: async (ms) => {
      currentTimeMs += ms;
    },
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/order-status");
      currentTimeMs += 40;
      return new Response(JSON.stringify({ state: "pending_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  try {
    const lifecycle = await adapter.trackOrderStatusLifecycle(
      { orderId: "ord-timeout" },
      { timeoutMs: 110, pollIntervalMs: 20, maxAttempts: 10 },
    );

    assert.equal(lifecycle.terminal, false);
    assert.equal(lifecycle.timedOut, true);
    assert.equal(lifecycle.maxAttemptsReached, false);
    assert.equal(lifecycle.finalState, "pending_review");
    assert.equal(lifecycle.history.length, 3);
  } finally {
    Date.now = originalNow;
  }
});

test("DFlowAdapter deduplicates duplicate idempotent swap submissions", async () => {
  let swapCalls = 0;
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://example.dflow",
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/swap");
      swapCalls += 1;
      return new Response(JSON.stringify({ swapId: "swap-1", status: "submitted" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const payload = { intentId: "intent-dedupe-1", quoteId: "quote-1" };
  const [first, second] = await Promise.all([
    adapter.postSwapIdempotent(payload),
    adapter.postSwapIdempotent(payload),
  ]);

  assert.equal(swapCalls, 1);
  assert.equal(first.idempotencyKey, "intent-dedupe-1");
  assert.equal(first.deduplicated, false);
  assert.equal(second.idempotencyKey, "intent-dedupe-1");
  assert.equal(second.deduplicated, true);
  assert.equal(second.swap.swapId, "swap-1");
});

test("DFlowAdapter persists terminal lifecycle state by intent and order identifiers", async () => {
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://example.dflow",
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/order-status");
      return new Response(JSON.stringify({ orderId: "ord-77", intentId: "intent-77", status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const lifecycle = await adapter.trackOrderStatusLifecycle(
    { orderId: "ord-77", intentId: "intent-77" },
    { pollIntervalMs: 0, maxAttempts: 2 },
  );

  assert.equal(lifecycle.terminal, true);
  const byIntent = adapter.getPersistedTerminalState("intent-77");
  const byOrder = adapter.getPersistedTerminalState("ord-77");
  assert.ok(byIntent);
  assert.ok(byOrder);
  assert.equal(byIntent.finalState, "completed");
  assert.equal(byOrder.finalResponse.orderId, "ord-77");
});
