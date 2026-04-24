import test from "node:test";
import assert from "node:assert/strict";

import {
  assessPredictionQuoteIntegrity,
  buildPredictionCanonicalMapping
} from "../../../services/state-normalizer/src/prediction-canonicalization.ts";

test("buildPredictionCanonicalMapping is deterministic across venues", () => {
  const commonInput = {
    eventTitle: "SOL daily close",
    marketQuestion: "Will SOL close above $135 on 2026-05-01?",
    outcomeLabel: "Yes",
    eventStartMs: 1_776_787_200_000
  };

  const dflow = buildPredictionCanonicalMapping({
    venue: "dflow",
    venueEventId: "df_evt_1",
    venueMarketId: "df_mkt_1",
    venueOutcomeId: "df_out_1",
    ...commonInput
  });
  const gemini = buildPredictionCanonicalMapping({
    venue: "gemini",
    venueEventId: "gm_evt_1",
    venueMarketId: "gm_mkt_1",
    venueOutcomeId: "gm_out_1",
    ...commonInput
  });

  assert.equal(dflow.canonical_event_id, gemini.canonical_event_id);
  assert.equal(dflow.canonical_market_id, gemini.canonical_market_id);
  assert.equal(dflow.canonical_outcome_id, gemini.canonical_outcome_id);
  assert.notEqual(dflow.venue_event_id, gemini.venue_event_id);
});

test("assessPredictionQuoteIntegrity classifies crossed and stale quotes", () => {
  const crossed = assessPredictionQuoteIntegrity({
    observedAtMs: 1_776_787_200_000,
    nowMs: 1_776_787_201_000,
    bidPrice: 0.61,
    askPrice: 0.59,
    confidenceRatio: 0.02,
    depthScore: 0.8
  });
  assert.equal(crossed.integrity_status, "crossed_book");
  assert.equal(crossed.freshness_tier, "realtime");

  const stillOkButTierStale = assessPredictionQuoteIntegrity({
    observedAtMs: 1_776_787_200_000,
    nowMs: 1_776_787_200_000 + 70_500,
    bidPrice: 0.4,
    askPrice: 0.45,
    confidenceRatio: 0.05,
    depthScore: 0.8
  });
  assert.equal(stillOkButTierStale.integrity_status, "ok");
  assert.equal(stillOkButTierStale.freshness_tier, "stale");

  const rejectedOld = assessPredictionQuoteIntegrity({
    observedAtMs: 1_776_787_200_000,
    nowMs: 1_776_787_200_000 + 300_001,
    bidPrice: 0.4,
    askPrice: 0.45,
    confidenceRatio: 0.05,
    depthScore: 0.8
  });
  assert.equal(rejectedOld.integrity_status, "stale_rejected");
  assert.equal(rejectedOld.freshness_tier, "expired");
});
