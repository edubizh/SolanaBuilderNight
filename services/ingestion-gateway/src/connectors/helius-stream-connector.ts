import type { Connector, ConnectorHealth } from "./types.js";

export interface HeliusStreamEnvelope {
  type: string;
  slot: number;
  signature: string;
  timestampMs: number;
  accountKeys: string[];
}

export interface HeliusParsedTransaction {
  signature: string;
  slot: number;
  timestampMs: number;
  accountKeys: string[];
  instructionCount: number;
}

export interface HeliusStreamConnectorConfig {
  apiKey?: string;
  endpoint: string;
}

export class HeliusStreamConnector implements Connector {
  readonly provider = "helius" as const;
  private readonly config: HeliusStreamConnectorConfig;

  constructor(overrides: Partial<HeliusStreamConnectorConfig> = {}) {
    this.config = {
      apiKey: overrides.apiKey,
      endpoint: overrides.endpoint ?? "wss://atlas-mainnet.helius-rpc.com"
    };
  }

  async initialize(): Promise<void> {
    await this.healthcheck();
  }

  async healthcheck(): Promise<ConnectorHealth> {
    return {
      provider: this.provider,
      isHealthy: Boolean(this.config.endpoint),
      checkedAtMs: Date.now(),
      detail: this.config.endpoint
    };
  }

  buildStreamUrl(): string {
    if (!this.config.apiKey) {
      return this.config.endpoint;
    }

    const separator = this.config.endpoint.includes("?") ? "&" : "?";
    return `${this.config.endpoint}${separator}api-key=${encodeURIComponent(this.config.apiKey)}`;
  }

  parseStreamEvent(message: string): HeliusParsedTransaction | null {
    const parsed = JSON.parse(message) as {
      params?: { result?: { value?: { signature?: string; slot?: number; timestamp?: number; transaction?: { message?: { accountKeys?: string[]; instructions?: unknown[] } } } } };
    };

    const value = parsed.params?.result?.value;
    if (!value?.signature || value.slot === undefined || value.timestamp === undefined) {
      return null;
    }

    const accountKeys = value.transaction?.message?.accountKeys ?? [];
    const instructions = value.transaction?.message?.instructions ?? [];
    return {
      signature: value.signature,
      slot: value.slot,
      timestampMs: value.timestamp * 1_000,
      accountKeys,
      instructionCount: instructions.length
    };
  }
}
