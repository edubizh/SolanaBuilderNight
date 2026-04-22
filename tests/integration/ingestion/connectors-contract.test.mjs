import test from "node:test";
import assert from "node:assert/strict";

import { ConnectorRegistry } from "../../../services/ingestion-gateway/src/connectors/connector-registry.ts";
import { CoinGeckoConnector } from "../../../services/ingestion-gateway/src/connectors/coingecko-connector.ts";
import { HeliusStreamConnector } from "../../../services/ingestion-gateway/src/connectors/helius-stream-connector.ts";
import { PythHermesConnector } from "../../../services/ingestion-gateway/src/connectors/pyth-hermes-connector.ts";

test("ingestion gateway registers canonical connector providers", () => {
  const registry = new ConnectorRegistry();
  registry.register(new CoinGeckoConnector());
  registry.register(new PythHermesConnector());
  registry.register(new HeliusStreamConnector());
  assert.deepEqual(registry.listProviders(), ["coingecko", "helius", "pyth-hermes"]);
});
