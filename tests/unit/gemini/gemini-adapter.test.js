import test from "node:test";
import assert from "node:assert/strict";
import { GeminiPredictionAdapter } from "../../../services/execution-orchestrator/adapters/gemini/index.js";

test("GeminiPredictionAdapter normalizes markets deterministically", async () => {
  const adapter = new GeminiPredictionAdapter({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          markets: [
            {
              id: "mkt-b",
              symbol: "B",
              status: "OPEN",
              outcomes: [
                { id: "yes", name: "Yes" },
                { id: "no", name: "No" },
              ],
            },
            {
              id: "mkt-a",
              symbol: "A",
              status: "OPEN",
              outcomes: [
                { id: "no", name: "No" },
                { id: "yes", name: "Yes" },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  const markets = await adapter.getMarkets();
  assert.deepEqual(
    markets.map((market) => market.marketId),
    ["mkt-a", "mkt-b"],
  );
  assert.deepEqual(
    markets[0].outcomes.map((outcome) => outcome.outcomeId),
    ["no", "yes"],
  );
});

test("GeminiPredictionAdapter quote normalization enforces bid/ask integrity", () => {
  const adapter = new GeminiPredictionAdapter();
  assert.throws(
    () => adapter.normalizeQuote({ marketId: "mkt-1", bid: 0.62, ask: 0.61 }),
    /bid\/ask invalid/,
  );
});

test("GeminiPredictionAdapter quote normalization hooks are deterministic", () => {
  const adapter = new GeminiPredictionAdapter({
    now: () => 1_710_000_000_000,
    normalizeQuoteHook: (normalized) => ({
      ...normalized,
      spread: Number((normalized.ask - normalized.bid).toFixed(8)),
    }),
  });

  const normalized = adapter.normalizeQuote({ market_id: "mkt-hook", bid: "0.4", ask: "0.6" });
  assert.equal(normalized.marketId, "mkt-hook");
  assert.equal(normalized.mid, 0.5);
  assert.equal(normalized.spread, 0.2);
  assert.equal(normalized.timestampMs, 1_710_000_000_000);
});

test("GeminiPredictionAdapter auth-surface stub exposes headers without signing", () => {
  const adapter = new GeminiPredictionAdapter();
  const auth = adapter.buildAuthSurface({
    apiKey: "key-1",
    apiSecret: "secret-1",
    passphrase: "passphrase-1",
    accountId: "acct-9",
  });

  assert.equal(auth.hasCredentials, true);
  assert.equal(auth.signed, false);
  assert.equal(auth.passphraseProvided, true);
  assert.equal(auth.headers["x-gemini-api-key"], "key-1");
  assert.equal(auth.headers["x-gemini-account"], "acct-9");
});

test("GeminiPredictionAdapter blocks live execution path in Stage A", async () => {
  const adapter = new GeminiPredictionAdapter();
  await assert.rejects(() => adapter.submitOrder(), /does not support live execution/);
});
