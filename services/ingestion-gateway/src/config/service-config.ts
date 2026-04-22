export interface IngestionGatewayConfig {
  serviceName: "ingestion-gateway";
  pollIntervalMs: number;
  providerTimeoutMs: number;
}

export const DEFAULT_INGESTION_GATEWAY_CONFIG: IngestionGatewayConfig = {
  serviceName: "ingestion-gateway",
  pollIntervalMs: 1_000,
  providerTimeoutMs: 2_000
};
