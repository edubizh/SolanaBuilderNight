import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPredictionQuoteTraceId,
  normalizePredictionQuotes
} from "../../../services/state-normalizer/src/normalize-prediction-quotes.ts";

const base = {
  canonicalEventId: "pm_evt_v1_e",
  canonicalMarketId: "pm_mkt_v1_e",
  venueMarketId: "vm-1"
};

test("normalizePredictionQuotes: ok quote yields integrity ok and expected traceId", () => {
  const observedAtMs = 1_700_000_000_000;
  const out = normalizePredictionQuotes({
    nowMs: observedAtMs + 2_000,
    rawQuotesByVenue: {
      dflow: [
        {
          ...base,
          venue: "dflow",
          yesBidPrice: 0.45,
          yesAskPrice: 0.48,
          observedAtMs
        }
      ]
    }
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].integrityStatus, "ok");
  assert.equal(out[0].freshnessTier, "realtime");
  assert.equal(
    out[0].traceId,
    buildPredictionQuoteTraceId("pm_mkt_v1_e", "dflow", observedAtMs)
  );
  assert.equal(out[0].traceId, "trace_pm_mkt_v1_e_dflow_1700000000000");
});

test("normalizePredictionQuotes: crossed book", () => {
  const observedAtMs = 1_700_000_000_000;
  const out = normalizePredictionQuotes({
    nowMs: observedAtMs + 1_000,
    rawQuotesByVenue: {
      dflow: [
        {
          ...base,
          venue: "dflow",
          yesBidPrice: 0.62,
          yesAskPrice: 0.59,
          observedAtMs
        }
      ]
    }
  });
  assert.equal(out[0].integrityStatus, "crossed_book");
  assert.equal(out[0].freshnessTier, "realtime");
});

test("normalizePredictionQuotes: very old quote → stale_rejected and expired tier", () => {
  const observedAtMs = 1_700_000_000_000;
  const out = normalizePredictionQuotes({
    nowMs: observedAtMs + 400_000,
    rawQuotesByVenue: {
      gemini: [
        {
          ...base,
          venue: "gemini",
          yesBidPrice: 0.4,
          yesAskPrice: 0.41,
          observedAtMs
        }
      ]
    }
  });
  assert.equal(out[0].integrityStatus, "stale_rejected");
  assert.equal(out[0].freshnessTier, "expired");
});
