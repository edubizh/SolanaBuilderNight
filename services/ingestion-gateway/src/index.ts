import {
  DEFAULT_INGESTION_GATEWAY_CONFIG,
  type IngestionGatewayConfig
} from "./config/service-config.js";
import { ConnectorRegistry } from "./connectors/connector-registry.js";
import { CoinGeckoConnector } from "./connectors/coingecko-connector.js";
import { HeliusStreamConnector } from "./connectors/helius-stream-connector.js";
import { PythHermesConnector } from "./connectors/pyth-hermes-connector.js";
import { INGESTION_REPLAY_DATASET } from "./replay-dataset.js";

export interface IngestionGatewayService {
  config: IngestionGatewayConfig;
  registry: ConnectorRegistry;
}

export function createIngestionGatewayService(
  overrides: Partial<IngestionGatewayConfig> = {}
): IngestionGatewayService {
  return {
    config: {
      ...DEFAULT_INGESTION_GATEWAY_CONFIG,
      ...overrides
    },
    registry: new ConnectorRegistry()
  };
}

export function registerDefaultConnectors(service: IngestionGatewayService): void {
  service.registry.register(new CoinGeckoConnector());
  service.registry.register(new PythHermesConnector());
  service.registry.register(new HeliusStreamConnector());
}

export { CoinGeckoConnector, PythHermesConnector, HeliusStreamConnector };
export { INGESTION_REPLAY_DATASET };
