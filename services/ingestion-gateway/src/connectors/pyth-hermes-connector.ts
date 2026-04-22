import type { Connector, ConnectorHealth } from "./types.js";

export interface PythHermesConnectorConfig {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

export interface PythHermesPriceSnapshot {
  feedId: string;
  price: string;
  confidence: string;
  publishTimeSec: number;
  observedAtMs: number;
  stalenessMs: number;
  confidenceRatio: number;
}

const DEFAULT_BASE_URL = "https://hermes.pyth.network";

export class PythHermesConnector implements Connector {
  readonly provider = "pyth-hermes" as const;
  private readonly config: PythHermesConnectorConfig;

  constructor(overrides: Partial<PythHermesConnectorConfig> = {}) {
    this.config = {
      baseUrl: overrides.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: overrides.timeoutMs ?? 2_000,
      fetchImpl: overrides.fetchImpl ?? fetch
    };
  }

  async initialize(): Promise<void> {
    await this.healthcheck();
  }

  async healthcheck(): Promise<ConnectorHealth> {
    const checkedAtMs = Date.now();
    try {
      const response = await this.request("/v2/health");
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

  async fetchLatestPrice(feedId: string, nowMs = Date.now()): Promise<PythHermesPriceSnapshot> {
    const response = await this.request(`/v2/updates/price/latest?ids[]=${encodeURIComponent(feedId)}`);
    if (!response.ok) {
      throw new Error(`pyth hermes request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      parsed?: Array<{ id?: string; price?: { price?: string; conf?: string; publish_time?: number } }>;
    };
    const first = payload.parsed?.[0];
    const priceData = first?.price;

    if (!first?.id || !priceData?.price || !priceData.conf || !priceData.publish_time) {
      throw new Error("pyth hermes response missing required price fields");
    }

    const priceValue = Math.abs(Number(priceData.price));
    const confidenceValue = Math.abs(Number(priceData.conf));
    if (!Number.isFinite(priceValue) || priceValue === 0 || !Number.isFinite(confidenceValue)) {
      throw new Error("pyth hermes response had invalid numeric fields");
    }

    const publishTimeMs = priceData.publish_time * 1_000;
    return {
      feedId: first.id,
      price: priceData.price,
      confidence: priceData.conf,
      publishTimeSec: priceData.publish_time,
      observedAtMs: nowMs,
      stalenessMs: Math.max(0, nowMs - publishTimeMs),
      confidenceRatio: confidenceValue / priceValue
    };
  }

  private async request(pathname: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await this.config.fetchImpl(`${this.config.baseUrl}${pathname}`, {
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
