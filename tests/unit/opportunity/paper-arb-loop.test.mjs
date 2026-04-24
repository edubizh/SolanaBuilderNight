import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOperationalSnapshot,
  runPaperArbitrageLoop,
  serializeOperationalSnapshot,
} from "../../../services/opportunity-engine/src/index.js";

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
  assert.equal(first.decisionLogs[0].expectedNetUsd, 10);
  assert.deepEqual(first.decisionLogs[0].reasons, ["spread_actionable_and_paper_safe"]);
  assert.deepEqual(first.telemetry, {
    totals: { accepted: 1, skipped: 0, total: 1 },
    acceptedByReason: { spread_actionable_and_paper_safe: 1 },
    skippedByReason: {},
    expectedNetDistributions: {
      accepted: {
        count: 1,
        min: 10,
        max: 10,
        avg: 10,
        buckets: {
          negative: 0,
          low: 0,
          medium: 0,
          high: 0,
          very_high: 1,
        },
      },
      skipped: {
        count: 0,
        min: null,
        max: null,
        avg: null,
        buckets: {
          negative: 0,
          low: 0,
          medium: 0,
          high: 0,
          very_high: 0,
        },
      },
    },
  });
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
  assert.equal(result.decisionLogs[0].expectedNetUsd, null);
  assert.deepEqual(result.decisionLogs[0].reasons, [
    "insufficient_integrity_valid_quotes",
    "no_cross_venue_two_sided_legs",
    "spread_below_threshold",
  ]);
  assert.deepEqual(result.telemetry, {
    totals: { accepted: 0, skipped: 1, total: 1 },
    acceptedByReason: {},
    skippedByReason: {
      insufficient_integrity_valid_quotes: 1,
      no_cross_venue_two_sided_legs: 1,
      spread_below_threshold: 1,
    },
    expectedNetDistributions: {
      accepted: {
        count: 0,
        min: null,
        max: null,
        avg: null,
        buckets: {
          negative: 0,
          low: 0,
          medium: 0,
          high: 0,
          very_high: 0,
        },
      },
      skipped: {
        count: 0,
        min: null,
        max: null,
        avg: null,
        buckets: {
          negative: 0,
          low: 0,
          medium: 0,
          high: 0,
          very_high: 0,
        },
      },
    },
  });
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

test("operational snapshot serialization is deterministic and telemetry-backed", () => {
  const result = runPaperArbitrageLoop(
    [
      {
        traceId: "trace-4",
        canonicalEventId: "pm_evt_v1_d",
        canonicalMarketId: "pm_mkt_v1_d",
        venue: "dflow",
        venueMarketId: "df-4",
        yesBidPrice: 0.59,
        yesAskPrice: 0.61,
        observedAtMs: 4000,
        freshnessTier: "fresh",
        integrityStatus: "ok",
      },
      {
        traceId: "trace-4",
        canonicalEventId: "pm_evt_v1_d",
        canonicalMarketId: "pm_mkt_v1_d",
        venue: "gemini",
        venueMarketId: "gm-4",
        yesBidPrice: 0.68,
        yesAskPrice: 0.7,
        observedAtMs: 4001,
        freshnessTier: "fresh",
        integrityStatus: "ok",
      },
    ],
    { minSpreadToTrade: 0.03, tradeNotionalUsd: 250, nowMs: 789_000 },
  );
  const snapshot = buildOperationalSnapshot(result, {
    minSpreadToTrade: 0.03,
    tradeNotionalUsd: 250,
    executionMode: "paper_only",
    nowMs: 789_123,
  });

  const serializedA = serializeOperationalSnapshot(snapshot);
  const serializedB = serializeOperationalSnapshot(snapshot);
  const parsed = JSON.parse(serializedA);

  assert.equal(serializedA, serializedB);
  assert.equal(parsed.generatedAtMs, 789_123);
  assert.equal(parsed.telemetry.totals.accepted, 1);
  assert.equal(parsed.telemetry.expectedNetDistributions.accepted.buckets.very_high, 1);
});
