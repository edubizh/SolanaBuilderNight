import { PnpClient } from "./client.js";

const CUSTOM_ORACLE_RESOLVABLE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_QUOTE_AGE_MS = 5_000;

export class PnpExecutionAdapter {
  constructor({
    client = new PnpClient(),
    enableV3 = false,
    featureFlags = {},
    now = () => Date.now(),
    maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
  } = {}) {
    this.client = client;
    this.enableV3 = enableV3;
    this.featureFlags = featureFlags;
    this.now = now;
    this.maxQuoteAgeMs = maxQuoteAgeMs;
  }

  async discoverMarkets() {
    const markets = await this.client.discoverMarkets();
    return markets
      .filter((market) => this.#isV3Enabled() || market.version === "v2")
      .sort((left, right) => left.marketId.localeCompare(right.marketId));
  }

  async getPrice({ marketId, size }) {
    if (!marketId) {
      throw new Error("PNP getPrice requires marketId");
    }
    const quote = await this.client.getQuote({ marketId, size });
    return this.#validateQuoteIntegrity({ quote, marketId, size });
  }

  async executeOrder(orderRequest) {
    this.#validateOrderRequest(orderRequest);
    this.#validateMarketVersionSupport(orderRequest);
    this.#validateCustomOracleResolvableWindow(orderRequest);
    return this.client.submitOrder({
      intentId: orderRequest.intentId,
      marketId: orderRequest.marketId,
      side: orderRequest.side,
      size: orderRequest.size,
      maxSlippageBps: orderRequest.maxSlippageBps,
    });
  }

  #validateOrderRequest(orderRequest) {
    if (!orderRequest || typeof orderRequest !== "object") {
      throw new Error("PNP executeOrder requires order request payload");
    }
    if (!orderRequest.intentId || typeof orderRequest.intentId !== "string") {
      throw new Error("PNP executeOrder requires intentId");
    }
    if (!orderRequest.marketId || typeof orderRequest.marketId !== "string") {
      throw new Error("PNP executeOrder requires marketId");
    }
    if (orderRequest.side !== "buy" && orderRequest.side !== "sell") {
      throw new Error("PNP executeOrder side must be buy or sell");
    }
    if (
      typeof orderRequest.size !== "number" ||
      Number.isNaN(orderRequest.size) ||
      orderRequest.size <= 0
    ) {
      throw new Error("PNP executeOrder size must be a positive number");
    }
  }

  #validateMarketVersionSupport(orderRequest) {
    if (!orderRequest.marketVersion) {
      return;
    }

    const marketVersion = String(orderRequest.marketVersion).toLowerCase();
    if (marketVersion !== "v2" && marketVersion !== "v3") {
      throw new Error("PNP executeOrder marketVersion must be v2 or v3");
    }
    if (marketVersion === "v3" && !this.#isV3Enabled()) {
      throw new Error("PNP V3 market execution requires pnpV3 feature flag");
    }
  }

  #validateCustomOracleResolvableWindow(orderRequest) {
    const guardrail = orderRequest.customOracleGuardrail;
    if (!guardrail?.requiresResolvableBy || !guardrail.marketCreatedAtMs) {
      return;
    }

    const elapsedMs = this.now() - Number(guardrail.marketCreatedAtMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error("PNP custom-oracle guardrail marketCreatedAtMs must be a valid timestamp");
    }

    const remainingMs = CUSTOM_ORACLE_RESOLVABLE_WINDOW_MS - elapsedMs;
    if (remainingMs <= 0) {
      throw new Error(
        "PNP custom-oracle guardrail violated: setMarketResolvable window exceeded 15 minutes",
      );
    }
  }

  #isV3Enabled() {
    return this.enableV3 || this.featureFlags?.pnpV3 === true;
  }

  #validateQuoteIntegrity({ quote, marketId, size }) {
    if (!quote || typeof quote !== "object") {
      throw new Error("PNP quote payload must be an object");
    }
    if (quote.marketId !== marketId) {
      throw new Error(
        `PNP quote marketId mismatch: requested ${marketId}, got ${String(quote.marketId)}`,
      );
    }
    if (typeof quote.size !== "number" || !Number.isFinite(quote.size) || quote.size <= 0) {
      throw new Error("PNP quote size must be a positive number");
    }
    if (Math.abs(quote.size - size) > Number.EPSILON) {
      throw new Error(`PNP quote size mismatch: requested ${size}, got ${quote.size}`);
    }
    if (typeof quote.price !== "number" || !Number.isFinite(quote.price) || quote.price <= 0) {
      throw new Error("PNP quote price must be a positive number");
    }

    const nowMs = this.now();
    const sourceTimestampMs = Number(quote.sourceTimestampMs ?? quote.fetchedAtMs);
    if (!Number.isFinite(sourceTimestampMs) || sourceTimestampMs <= 0) {
      throw new Error("PNP quote must include a valid timestamp");
    }
    const ageMs = nowMs - sourceTimestampMs;
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      throw new Error("PNP quote timestamp is invalid");
    }
    if (ageMs > this.maxQuoteAgeMs) {
      throw new Error(
        `PNP quote is stale: age ${ageMs}ms exceeds max ${this.maxQuoteAgeMs}ms`,
      );
    }

    return {
      ...quote,
      sourceTimestampMs,
    };
  }
}
