export interface ReplayCoinGeckoTick {
  source: "coingecko";
  tokenAddress: string;
  symbol: string;
  priceUsd: string;
  decimals: number;
  observedAt: string;
  externalEventId: string;
}

export interface ReplayPythTick {
  source: "pyth-hermes";
  feedId: string;
  symbol: string;
  price: string;
  confidence: string;
  publishTimeSec: number;
  observedAt: string;
  externalEventId: string;
}

export interface ReplayHeliusTick {
  source: "helius";
  symbol: string;
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
      tokenAddress: "So11111111111111111111111111111111111111112",
      symbol: "SOL/USD",
      priceUsd: "133.25",
      decimals: 2,
      observedAt: "2026-04-21T16:00:00.000Z",
      externalEventId: "coingecko:sol:tick-001"
    },
    {
      source: "pyth-hermes",
      feedId: "0xef0d8b6fda2ceba41f64aaf3f35f8f62a2f5f5d708f8f7a6f5d8b67745f7b1d1",
      symbol: "SOL/USD",
      price: "13327",
      confidence: "31",
      publishTimeSec: 1_776_787_202,
      observedAt: "2026-04-21T16:00:04.000Z",
      externalEventId: "pyth:sol:tick-001"
    },
    {
      source: "helius",
      symbol: "SOL/USD",
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
