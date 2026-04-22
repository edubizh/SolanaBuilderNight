import type { Connector } from "./types.js";

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    this.connectors.set(connector.provider, connector);
  }

  listProviders(): string[] {
    return Array.from(this.connectors.keys()).sort();
  }

  async initializeAll(): Promise<void> {
    for (const connector of this.connectors.values()) {
      await connector.initialize();
    }
  }
}
