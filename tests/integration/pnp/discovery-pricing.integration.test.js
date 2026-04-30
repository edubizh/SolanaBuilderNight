import test from "node:test";
import assert from "node:assert/strict";
import { PnpExecutionAdapter } from "../../../services/execution-orchestrator/adapters/pnp/executionAdapter.js";
import { PnpClient } from "../../../services/execution-orchestrator/adapters/pnp/client.js";
import { PnpGuardedAdapter } from "../../../services/execution-orchestrator/adapters/pnp/guardedAdapter.js";

const BASE_NOW = 1_713_700_000_000;

function createPnpMockFetch() {
  return async (url, init) => {
    const parsedUrl = new URL(url);
    const method = init?.method ?? "GET";

    if (parsedUrl.pathname === "/markets") {
      return new Response(
        JSON.stringify([
          { marketId: "pnp-sol-usdc-v2", version: "v2", baseSymbol: "SOL", quoteSymbol: "USDC" },
          { marketId: "pnp-sol-usdc-v3", version: "v3", baseSymbol: "SOL", quoteSymbol: "USDC" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (parsedUrl.pathname === "/quote") {
      const marketId = parsedUrl.searchParams.get("marketId");
      const size = Number(parsedUrl.searchParams.get("size"));
      return new Response(
        JSON.stringify({
          price: 151.22,
          quotedAtMs: BASE_NOW,
          marketId,
          size,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (parsedUrl.pathname === "/orders" && method === "POST") {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          orderId: `ord-${body.intentId}`,
          status: "submitted",
          submittedAtMs: BASE_NOW,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  };
}

test("PNP discovery and pricing flow serializes requests correctly", async () => {
  const calls = [];
  const client = new PnpClient({
    now: () => BASE_NOW,
    fetchImpl: async (url, init) => {
      const parsedUrl = new URL(url);
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return createPnpMockFetch()(url, init);
    },
  });

  const adapter = new PnpExecutionAdapter({
    now: () => BASE_NOW,
    client,
  });
  const markets = await adapter.discoverMarkets();
  const quote = await adapter.getPrice({ marketId: markets[0].marketId, size: 3 });

  assert.equal(markets.length, 1);
  assert.equal(quote.price, 151.22);
  assert.equal(quote.sourceTimestampMs, BASE_NOW);
  assert.deepEqual(
    calls.map((entry) => new URL(entry.url).pathname),
    ["/markets", "/quote"],
  );
});

test("PNP pricing rejects stale quotes from venue", async () => {
  const client = new PnpClient({
    now: () => BASE_NOW,
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === "/quote") {
        return new Response(JSON.stringify({ price: 99.5, quotedAtMs: BASE_NOW - 10_000 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" } },
      );
    },
  });
  const adapter = new PnpExecutionAdapter({
    now: () => BASE_NOW,
    maxQuoteAgeMs: 5_000,
    client,
  });

  await assert.rejects(
    () => adapter.getPrice({ marketId: "pnp-sol-usdc-v2", size: 3 }),
    /quote is stale/,
  );
});

test("PNP buy/sell execution path enforces custom-oracle guardrail", async () => {
  const fetchImpl = createPnpMockFetch();
  const adapter = new PnpExecutionAdapter({
    now: () => BASE_NOW,
    client: new PnpClient({ now: () => BASE_NOW, fetchImpl }),
  });

  await assert.rejects(
    () =>
      adapter.executeOrder({
        intentId: "intent-guardrail-expired",
        marketId: "pnp-sol-usdc-v2",
        side: "buy",
        size: 1,
        customOracleGuardrail: {
          requiresResolvableBy: true,
          marketCreatedAtMs: BASE_NOW - 20 * 60_000,
        },
      }),
    /window exceeded 15 minutes/,
  );

  const accepted = await adapter.executeOrder({
    intentId: "intent-guardrail-ok",
    marketId: "pnp-sol-usdc-v2",
    side: "sell",
    size: 1.5,
    customOracleGuardrail: {
      requiresResolvableBy: true,
      marketCreatedAtMs: BASE_NOW - 5 * 60_000,
    },
  });
  assert.equal(accepted.status, "submitted");
  assert.equal(accepted.side, "sell");
});

test("PNP v3 execution requires explicit feature flag scaffold", async () => {
  const fetchImpl = createPnpMockFetch();
  const disabledAdapter = new PnpExecutionAdapter({
    now: () => BASE_NOW,
    client: new PnpClient({ now: () => BASE_NOW, fetchImpl }),
  });

  await assert.rejects(
    () =>
      disabledAdapter.executeOrder({
        intentId: "intent-v3-disabled",
        marketId: "pnp-sol-usdc-v3",
        marketVersion: "v3",
        side: "buy",
        size: 1,
      }),
    /requires pnpV3 feature flag/,
  );

  const enabledAdapter = new PnpExecutionAdapter({
    now: () => BASE_NOW,
    featureFlags: { pnpV3: true },
    client: new PnpClient({ now: () => BASE_NOW, fetchImpl }),
  });
  const accepted = await enabledAdapter.executeOrder({
    intentId: "intent-v3-enabled",
    marketId: "pnp-sol-usdc-v3",
    marketVersion: "v3",
    side: "sell",
    size: 1,
  });
  assert.equal(accepted.status, "submitted");
});

test("PNP guarded adapter dry-run smoke with mock execution client", async () => {
  const executionAdapter = new PnpExecutionAdapter({
    now: () => BASE_NOW,
    client: {
      async discoverMarkets() {
        return [];
      },
      async getQuote() {
        return {
          marketId: "m1",
          size: 1,
          price: 1,
          sourceTimestampMs: BASE_NOW,
          fetchedAtMs: BASE_NOW,
        };
      },
    },
  });

  const guarded = new PnpGuardedAdapter({
    executionAdapter,
    mode: "dry_run",
    guardrails: { enforceNoNakedExposure: false },
    now: () => BASE_NOW,
  });

  const assessment = guarded.assessGuardedLiveRisk({
    intentId: "smoke-intent",
    orderRequest: { marketId: "m1", side: "buy", size: 1, maxSlippageBps: 50 },
    riskContext: { estimatedNotionalUsd: 50 },
  });
  assert.equal(assessment.allowed, true);

  const artifact = await guarded.executeGuardedLiveTrade(
    {
      intentId: "smoke-intent",
      orderRequest: { marketId: "m1", side: "buy", size: 1, maxSlippageBps: 50 },
      riskContext: { estimatedNotionalUsd: 50 },
    },
    { live: false, nowMs: BASE_NOW },
  );

  assert.equal(artifact.assessment.allowed, true);
  assert.equal(artifact.liveExecuted, false);
  assert.equal(artifact.submission, null);
  assert.ok(guarded.listGuardedExecutionAuditTrail().some((e) => e.type === "guarded_dry_run"));
});
