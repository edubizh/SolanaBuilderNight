import test from "node:test";
import assert from "node:assert/strict";

import { runPaperArbitrageLoop } from "../../../services/opportunity-engine/src/index.js";

test("runPaperArbitrageLoop emits deterministic spread-to-intent artifacts", () => {
  const inputs = [
    {
      traceId: "trace-1",
      canonicalEventId: "pm_evt_v1_a",
      canonicalMarketId: "pm_mkt_v1_a",
      venue: "dflow",
      venueMarketId: "df-1",
      yesBidPrice: 0.61,
      yesAskPrice: 0.63,
      observedAtMs: 1000,
      freshnessTier: "fresh",
      integrityStatus: "ok",
    },
    {
      traceId: "trace-1",
      canonicalEventId: "pm_evt_v1_a",
      canonicalMarketId: "pm_mkt_v1_a",
      venue: "gemini",
      venueMarketId: "gm-1",
      yesBidPrice: 0.68,
      yesAskPrice: 0.7,
      observedAtMs: 1001,
      freshnessTier: "realtime",
      integrityStatus: "ok",
    },
  ];

  const first = runPaperArbitrageLoop(inputs, {
    minSpreadToTrade: 0.02,
    tradeNotionalUsd: 200,
    nowMs: 123_456,
  });
  const second = runPaperArbitrageLoop(inputs, {
    minSpreadToTrade: 0.02,
    tradeNotionalUsd: 200,
    nowMs: 123_456,
  });

  assert.deepEqual(first, second);
  assert.equal(first.intents.length, 1);
  assert.equal(first.intents[0].executionMode, "paper_only");
  assert.equal(first.intents[0].noNakedExposure.passed, true);
  assert.equal(first.intents[0].expectedValueUsd, 10);
  assert.deepEqual(first.decisionLogs[0].reasons, ["spread_actionable_and_paper_safe"]);
});

test("runPaperArbitrageLoop rejects opportunities without two-sided cross-venue legs", () => {
  const result = runPaperArbitrageLoop(
    [
      {
        traceId: "trace-2",
        canonicalEventId: "pm_evt_v1_b",
        canonicalMarketId: "pm_mkt_v1_b",
        venue: "dflow",
        venueMarketId: "df-2",
        yesBidPrice: 0.5,
        yesAskPrice: 0.51,
        observedAtMs: 2000,
        freshnessTier: "fresh",
        integrityStatus: "ok",
      },
    ],
    { minSpreadToTrade: 0.01, nowMs: 321_000 },
  );

  assert.equal(result.intents.length, 0);
  assert.equal(result.decisionLogs.length, 1);
  assert.equal(result.decisionLogs[0].decision, "rejected");
  assert.equal(result.decisionLogs[0].noNakedExposure.passed, false);
  assert.deepEqual(result.decisionLogs[0].reasons, [
    "insufficient_integrity_valid_quotes",
    "no_cross_venue_two_sided_legs",
    "spread_below_threshold",
  ]);
});

test("runPaperArbitrageLoop hard-gates non-paper execution modes", () => {
  const result = runPaperArbitrageLoop(
    [
      {
        traceId: "trace-3",
        canonicalEventId: "pm_evt_v1_c",
        canonicalMarketId: "pm_mkt_v1_c",
        venue: "dflow",
        venueMarketId: "df-3",
        yesBidPrice: 0.58,
        yesAskPrice: 0.6,
        observedAtMs: 3000,
        freshnessTier: "fresh",
        integrityStatus: "ok",
      },
      {
        traceId: "trace-3",
        canonicalEventId: "pm_evt_v1_c",
        canonicalMarketId: "pm_mkt_v1_c",
        venue: "gemini",
        venueMarketId: "gm-3",
        yesBidPrice: 0.63,
        yesAskPrice: 0.65,
        observedAtMs: 3001,
        freshnessTier: "fresh",
        integrityStatus: "ok",
      },
    ],
    {
      executionMode: "live",
      minSpreadToTrade: 0.01,
      nowMs: 456_000,
    },
  );

  assert.equal(result.intents.length, 0);
  assert.deepEqual(result.decisionLogs[0].reasons, ["execution_mode_not_paper_only"]);
});
