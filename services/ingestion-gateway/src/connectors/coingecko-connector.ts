import type { Connector, ConnectorHealth, RateLimitPolicy, RetryPolicy } from "./types.js";

export interface CoinGeckoConnectorConfig {
  baseUrl: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  rateLimitPolicy: RateLimitPolicy;
  sleep: (ms: number) => Promise<void>;
  fetchImpl: typeof fetch;
}

export interface CoinGeckoTokenPriceContext {
  tokenAddress: string;
  priceUsd: number;
  marketCapUsd?: number;
  volume24hUsd?: number;
  observedAtMs: number;
}

const DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3/onchain";

export class CoinGeckoConnector implements Connector {
  readonly provider = "coingecko" as const;
  private readonly config: CoinGeckoConnectorConfig;

  constructor(overrides: Partial<CoinGeckoConnectorConfig> = {}) {
    this.config = {
      baseUrl: overrides.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: overrides.timeoutMs ?? 2_000,
      retryPolicy: overrides.retryPolicy ?? {
        maxRetries: 3,
        initialBackoffMs: 100,
        maxBackoffMs: 1_000
      },
      rateLimitPolicy: overrides.rateLimitPolicy ?? {
        apiKey: undefined,
        keyHeaderName: "x-cg-pro-api-key"
      },
      sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      fetchImpl: overrides.fetchImpl ?? fetch
    };
  }

  async initialize(): Promise<void> {
    await this.healthcheck();
  }

  async healthcheck(): Promise<ConnectorHealth> {
    const checkedAtMs = Date.now();

    try {
      const response = await this.request("/ping");
      return {
        provider: this.provider,
        isHealthy: response.ok,
        checkedAtMs,
        detail: response.ok ? "ok" : `status:${response.status}`
      };
    } catch (error) {
      return {
        provider: this.provider,
        isHealthy: false,
        checkedAtMs,
        detail: error instanceof Error ? error.message : "unknown healthcheck error"
      };
    }
  }

  async fetchTokenPriceContext(network: "solana", tokenAddress: string): Promise<CoinGeckoTokenPriceContext> {
    const response = await this.request(`/networks/${network}/tokens/${tokenAddress}`);
    if (!response.ok) {
      throw new Error(`coingecko request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: { attributes?: { price_usd?: string; market_cap_usd?: string; volume_usd?: { h24?: string } } };
    };
    const attributes = payload.data?.attributes;
    const priceUsd = Number(attributes?.price_usd ?? "NaN");

    if (!Number.isFinite(priceUsd)) {
      throw new Error("coingecko response missing price_usd");
    }

    return {
      tokenAddress,
      priceUsd,
      marketCapUsd: parseMaybeNumber(attributes?.market_cap_usd),
      volume24hUsd: parseMaybeNumber(attributes?.volume_usd?.h24),
      observedAtMs: Date.now()
    };
  }

  private async request(pathname: string): Promise<Response> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.config.retryPolicy.maxRetries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const response = await this.config.fetchImpl(`${this.config.baseUrl}${pathname}`, {
          signal: controller.signal,
          headers: this.buildHeaders()
        });
        clearTimeout(timeout);

        if (response.status === 429) {
          throw new Error("rate limited by coingecko");
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= this.config.retryPolicy.maxRetries) {
          break;
        }

        const delayMs = Math.min(
          this.config.retryPolicy.maxBackoffMs,
          this.config.retryPolicy.initialBackoffMs * 2 ** attempt
        );
        await this.config.sleep(delayMs);
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("coingecko request failed");
  }

  private buildHeaders(): HeadersInit {
    const apiKey = this.config.rateLimitPolicy.apiKey;
    const keyHeaderName = this.config.rateLimitPolicy.keyHeaderName ?? "x-cg-pro-api-key";
    if (!apiKey) {
      return {};
    }

    return { [keyHeaderName]: apiKey };
  }
}

function parseMaybeNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
