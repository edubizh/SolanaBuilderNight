import test from "node:test";
import assert from "node:assert/strict";
import { PnpExecutionAdapter } from "../../../services/execution-orchestrator/adapters/pnp/executionAdapter.js";
import { PnpClient } from "../../../services/execution-orchestrator/adapters/pnp/client.js";

test("PNP discovery and pricing flow serializes requests correctly", async () => {
  const calls = [];
  const client = new PnpClient({
    now: () => 1713700000000,
    fetchImpl: async (url, init) => {
      const parsedUrl = new URL(url);
      calls.push({ url: String(url), method: init?.method ?? "GET" });

      if (parsedUrl.pathname === "/markets") {
        return new Response(
          JSON.stringify([
            { marketId: "pnp-sol-usdc-v2", version: "v2", baseSymbol: "SOL", quoteSymbol: "USDC" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (parsedUrl.pathname === "/quote") {
        assert.equal(parsedUrl.searchParams.get("marketId"), "pnp-sol-usdc-v2");
        assert.equal(parsedUrl.searchParams.get("size"), "3");
        return new Response(JSON.stringify({ price: 151.22 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    },
  });

  const adapter = new PnpExecutionAdapter({ client });
  const markets = await adapter.discoverMarkets();
  const quote = await adapter.getPrice({ marketId: markets[0].marketId, size: 3 });

  assert.equal(markets.length, 1);
  assert.equal(quote.price, 151.22);
  assert.deepEqual(
    calls.map((entry) => new URL(entry.url).pathname),
    ["/markets", "/quote"],
  );
});

test("PNP buy/sell execution path enforces custom-oracle guardrail", async () => {
  const adapter = new PnpExecutionAdapter({
    now: () => 1713700000000,
    client: new PnpClient({ now: () => 1713700000000 }),
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
          marketCreatedAtMs: 1713698900000,
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
      marketCreatedAtMs: 1713699500000,
    },
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.side, "sell");
});

test("PNP v3 execution requires explicit feature flag scaffold", async () => {
  const disabledAdapter = new PnpExecutionAdapter({
    now: () => 1713700000000,
    client: new PnpClient({ now: () => 1713700000000 }),
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
    now: () => 1713700000000,
    featureFlags: { pnpV3: true },
    client: new PnpClient({ now: () => 1713700000000 }),
  });
  const accepted = await enabledAdapter.executeOrder({
    intentId: "intent-v3-enabled",
    marketId: "pnp-sol-usdc-v3",
    marketVersion: "v3",
    side: "sell",
    size: 1,
  });
  assert.equal(accepted.status, "accepted");
});
