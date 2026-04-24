export interface ReplayCoinGeckoTick {
  source: "coingecko";
  venue: "dflow" | "gemini" | "pnp";
  tokenAddress: string;
  symbol: string;
  venueEventId: string;
  venueMarketId: string;
  venueOutcomeId: string;
  eventTitle: string;
  eventStartAt: string;
  marketQuestion: string;
  outcomeLabel: string;
  priceUsd: string;
  decimals: number;
  observedAt: string;
  externalEventId: string;
}

export interface ReplayPythTick {
  source: "pyth-hermes";
  venue: "dflow" | "gemini" | "pnp";
  feedId: string;
  symbol: string;
  venueEventId: string;
  venueMarketId: string;
  venueOutcomeId: string;
  eventTitle: string;
  eventStartAt: string;
  marketQuestion: string;
  outcomeLabel: string;
  price: string;
  bidPrice: string;
  askPrice: string;
  confidence: string;
  publishTimeSec: number;
  observedAt: string;
  externalEventId: string;
}

export interface ReplayHeliusTick {
  source: "helius";
  venue: "dflow" | "gemini" | "pnp";
  symbol: string;
  venueEventId: string;
  venueMarketId: string;
  venueOutcomeId: string;
  eventTitle: string;
  eventStartAt: string;
  marketQuestion: string;
  outcomeLabel: string;
  observedAt: string;
  streamMessage: string;
  externalEventId: string;
}

export interface IngestionReplayDataset {
  datasetId: string;
  version: string;
  capturedAt: string;
  frames: Array<ReplayCoinGeckoTick | ReplayPythTick | ReplayHeliusTick>;
}

export const INGESTION_REPLAY_DATASET: IngestionReplayDataset = {
  datasetId: "ingestion-baseline-2026-04-21",
  version: "1.0.0",
  capturedAt: "2026-04-21T16:00:07.000Z",
  frames: [
    {
      source: "coingecko",
      venue: "dflow",
      tokenAddress: "So11111111111111111111111111111111111111112",
      symbol: "SOL/USD",
      venueEventId: "df_evt_sol_2026_05_01",
      venueMarketId: "df_mkt_sol_above_135",
      venueOutcomeId: "df_out_yes",
      eventTitle: "SOL daily close",
      eventStartAt: "2026-05-01T00:00:00.000Z",
      marketQuestion: "Will SOL close above $135 on 2026-05-01?",
      outcomeLabel: "Yes",
      priceUsd: "133.25",
      decimals: 2,
      observedAt: "2026-04-21T16:00:00.000Z",
      externalEventId: "coingecko:sol:tick-001"
    },
    {
      source: "pyth-hermes",
      venue: "gemini",
      feedId: "0xef0d8b6fda2ceba41f64aaf3f35f8f62a2f5f5d708f8f7a6f5d8b67745f7b1d1",
      symbol: "SOL/USD",
      venueEventId: "gm_evt_sol_2026_05_01",
      venueMarketId: "gm_mkt_sol_above_135",
      venueOutcomeId: "gm_out_yes",
      eventTitle: "SOL daily close",
      eventStartAt: "2026-05-01T00:00:00.000Z",
      marketQuestion: "Will SOL close above $135 on 2026-05-01?",
      outcomeLabel: "Yes",
      price: "13327",
      bidPrice: "0.56",
      askPrice: "0.58",
      confidence: "31",
      publishTimeSec: 1_776_787_202,
      observedAt: "2026-04-21T16:00:04.000Z",
      externalEventId: "pyth:sol:tick-001"
    },
    {
      source: "helius",
      venue: "pnp",
      symbol: "SOL/USD",
      venueEventId: "pnp_evt_sol_2026_05_01",
      venueMarketId: "pnp_mkt_sol_above_135",
      venueOutcomeId: "pnp_out_yes",
      eventTitle: "SOL daily close",
      eventStartAt: "2026-05-01T00:00:00.000Z",
      marketQuestion: "Will SOL close above $135 on 2026-05-01?",
      outcomeLabel: "Yes",
      observedAt: "2026-04-21T16:00:07.000Z",
      externalEventId: "helius:sol:tx-001",
      streamMessage: JSON.stringify({
        params: {
          result: {
            value: {
              signature: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
              slot: 321_654_987,
              timestamp: 1_776_787_207,
              transaction: {
                message: {
                  accountKeys: [
                    "So11111111111111111111111111111111111111112",
                    "9xQeWvG816bUx9EPf5f8G9R8vMELx2wV6zvY1mQfD9z"
                  ],
                  instructions: [{}, {}, {}]
                }
              }
            }
          }
        }
      })
    }
  ]
};
