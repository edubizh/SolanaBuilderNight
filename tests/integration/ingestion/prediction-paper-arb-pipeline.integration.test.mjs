import test from "node:test";
import assert from "node:assert/strict";

import { runPaperArbitrageLoop } from "../../../services/opportunity-engine/src/index.js";
import { normalizePredictionQuotes } from "../../../services/state-normalizer/src/normalize-prediction-quotes.ts";
import {
  mapDflowQuoteToPreCanonical,
  mapGeminiQuoteToPreCanonical
} from "../../../services/ingestion-gateway/src/prediction-quote-mappers.ts";

const FIXTURE = {
  canonicalEventId: "pm_evt_integ",
  canonicalMarketId: "pm_mkt_integ",
  nowMs: 1_800_000_000_000,
  observedAtMs: 1_800_000_000_000
};

test("two venues same canonicalMarketId → runPaperArbitrageLoop finds opportunity (fixtures)", () => {
  const dflow = mapDflowQuoteToPreCanonical({
    canonicalEventId: FIXTURE.canonicalEventId,
    canonicalMarketId: FIXTURE.canonicalMarketId,
    marketTicker: "DFLOW-DEMO-1",
    yesBid: 0.4,
    yesAsk: 0.46,
    observedAtMs: FIXTURE.observedAtMs
  });
  const gemini = mapGeminiQuoteToPreCanonical({
    canonicalEventId: FIXTURE.canonicalEventId,
    canonicalMarketId: FIXTURE.canonicalMarketId,
    instrumentSymbol: "GEMI-DEMO-1",
    yesBid: 0.58,
    yesAsk: 0.6,
    observedAtMs: FIXTURE.observedAtMs + 1
  });

  const quotes = normalizePredictionQuotes({
    nowMs: FIXTURE.nowMs,
    rawQuotesByVenue: {
      dflow: [dflow],
      gemini: [gemini]
    }
  });

  const result = runPaperArbitrageLoop(quotes, {
    minSpreadToTrade: 0.02,
    tradeNotionalUsd: 100,
    nowMs: FIXTURE.nowMs
  });

  assert.equal(result.intents.length, 1);
  assert.equal(result.intents[0].canonicalMarketId, FIXTURE.canonicalMarketId);
  assert.equal(result.intents[0].buyVenue, "dflow");
  assert.equal(result.intents[0].sellVenue, "gemini");
  assert.ok(result.intents[0].spread >= 0.02);
  assert.equal(result.decisionLogs.filter((d) => d.decision === "accepted").length, 1);
});
