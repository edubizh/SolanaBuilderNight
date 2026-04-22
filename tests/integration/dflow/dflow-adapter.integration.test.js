import test from "node:test";
import assert from "node:assert/strict";
import { DFlowAdapter } from "../../../services/execution-orchestrator/adapters/dflow/index.js";

test("DFlowAdapter exposes scaffolded DFlow execution surface", async () => {
  const requestedPaths = [];
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://quote-api.dflow.net",
    metadataBaseUrl: "https://api.prod.dflow.net",
    fetchImpl: async (url, init = {}) => {
      requestedPaths.push({ path: new URL(url).pathname, method: init.method });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await adapter.getOrder({ market: "market-1" });
  await adapter.getOrderStatus({ orderId: "ord-1" });
  await adapter.getQuote({ market: "market-1", side: "buy" });
  await adapter.postSwap({ quoteId: "quote-1" });

  assert.deepEqual(requestedPaths, [
    { path: "/order", method: "GET" },
    { path: "/order-status", method: "GET" },
    { path: "/quote", method: "GET" },
    { path: "/swap", method: "POST" },
  ]);
});

test("DFlowAdapter imperative quote->swap path uses quote identifier", async () => {
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://quote-api.dflow.net",
    fetchImpl: async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/quote") {
        return new Response(JSON.stringify({ id: "quote-fallback-id" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      assert.equal(pathname, "/swap");
      assert.equal(init.method, "POST");
      assert.equal(init.body, JSON.stringify({ intentId: "intent-42", quoteId: "quote-fallback-id" }));
      return new Response(JSON.stringify({ success: true, swapId: "swap-42" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const response = await adapter.executeImperativeSwap(
    { market: "market-1", side: "buy", amountIn: "1000" },
    { intentId: "intent-42" },
  );

  assert.equal(response.swap.swapId, "swap-42");
  assert.equal(response.quote.id, "quote-fallback-id");
});

test("DFlowAdapter async lifecycle tracker exits on default terminal statuses", async () => {
  const servedStates = ["queued", "executing", "confirmed"];
  let callIndex = 0;
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://quote-api.dflow.net",
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname !== "/order-status") {
        return new Response(JSON.stringify({ ignored: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      const status = servedStates[Math.min(callIndex, servedStates.length - 1)];
      callIndex += 1;
      return new Response(JSON.stringify({ orderId: "ord-99", orderStatus: status }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const lifecycle = await adapter.trackOrderStatusLifecycle(
    { orderId: "ord-99" },
    { maxAttempts: 5, pollIntervalMs: 0 },
  );

  assert.equal(lifecycle.terminal, true);
  assert.equal(lifecycle.finalState, "confirmed");
  assert.equal(lifecycle.history.length, 3);
});

test("DFlowAdapter imperative swap path is idempotent for repeated intent submissions", async () => {
  let quoteCalls = 0;
  let swapCalls = 0;
  const adapter = new DFlowAdapter({
    tradingBaseUrl: "https://quote-api.dflow.net",
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/quote") {
        quoteCalls += 1;
        return new Response(JSON.stringify({ quoteId: "quote-idem-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      assert.equal(pathname, "/swap");
      swapCalls += 1;
      return new Response(JSON.stringify({ success: true, swapId: "swap-idem-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const first = await adapter.executeImperativeSwap(
    { market: "market-1", side: "buy", amountIn: "2500" },
    { intentId: "intent-idem-1" },
  );
  const second = await adapter.executeImperativeSwap(
    { market: "market-1", side: "buy", amountIn: "2500" },
    { intentId: "intent-idem-1" },
  );

  assert.equal(quoteCalls, 2);
  assert.equal(swapCalls, 1);
  assert.equal(first.idempotencyKey, "intent-idem-1");
  assert.equal(first.deduplicated, false);
  assert.equal(second.idempotencyKey, "intent-idem-1");
  assert.equal(second.deduplicated, true);
  assert.equal(second.swap.swapId, "swap-idem-1");
});
