export type DataProvider = "coingecko" | "pyth-hermes" | "helius";

export interface ConnectorHealth {
  provider: DataProvider;
  isHealthy: boolean;
  checkedAtMs: number;
  detail?: string;
}

export interface Connector {
  provider: DataProvider;
  initialize(): Promise<void>;
  healthcheck(): Promise<ConnectorHealth>;
}

export interface RetryPolicy {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export interface RateLimitPolicy {
  apiKey?: string;
  keyHeaderName?: string;
}
