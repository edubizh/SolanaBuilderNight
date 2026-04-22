const DEFAULT_TIMEOUT_MS = 5_000;

export class PnpClient {
  constructor({
    baseUrl = "https://api.pnp-protocol.io",
    fetchImpl = fetch,
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  async discoverMarkets() {
    const payload = await this.#request("GET", "/markets");
    const markets = Array.isArray(payload?.markets) ? payload.markets : payload;
    if (!Array.isArray(markets)) {
      throw new Error("PNP discoverMarkets response must be an array");
    }

    return markets.map((market) => {
      const marketId = market.marketId ?? market.id;
      const version = String(market.version ?? "v2").toLowerCase();
      if (!marketId) {
        throw new Error("PNP market entry missing marketId");
      }
      if (version !== "v2" && version !== "v3") {
        throw new Error(`PNP market ${marketId} has unsupported version ${version}`);
      }

      return {
        marketId,
        version,
        baseSymbol: market.baseSymbol ?? market.baseAssetSymbol ?? "UNKNOWN",
        quoteSymbol: market.quoteSymbol ?? market.quoteAssetSymbol ?? "UNKNOWN",
      };
    });
  }

  async getQuote({ marketId, size }) {
    if (!marketId || typeof marketId !== "string") {
      throw new Error("PNP quote request requires marketId");
    }
    if (typeof size !== "number" || Number.isNaN(size) || size <= 0) {
      throw new Error("PNP quote request size must be a positive number");
    }

    const payload = await this.#request("GET", "/quote", {
      query: { marketId, size },
    });

    const price = Number(payload?.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`PNP quote for ${marketId} returned invalid price`);
    }

    return {
      marketId,
      price,
      size,
      fetchedAtMs: this.now(),
    };
  }

  async submitOrder({ intentId, marketId, side, size, maxSlippageBps }) {
    if (!intentId || typeof intentId !== "string") {
      throw new Error("PNP submitOrder requires intentId");
    }
    if (!marketId || typeof marketId !== "string") {
      throw new Error("PNP submitOrder requires marketId");
    }
    if (side !== "buy" && side !== "sell") {
      throw new Error("PNP submitOrder side must be buy or sell");
    }
    if (typeof size !== "number" || Number.isNaN(size) || size <= 0) {
      throw new Error("PNP submitOrder size must be a positive number");
    }
    if (
      maxSlippageBps !== undefined &&
      (typeof maxSlippageBps !== "number" || Number.isNaN(maxSlippageBps) || maxSlippageBps < 0)
    ) {
      throw new Error("PNP submitOrder maxSlippageBps must be a non-negative number");
    }

    return {
      intentId,
      marketId,
      side,
      size,
      maxSlippageBps: maxSlippageBps ?? 50,
      orderId: `pnp-${intentId}`,
      status: "accepted",
      acceptedAtMs: this.now(),
    };
  }

  async #request(method, path, { query } = {}) {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, { method, signal: controller.signal });
      const text = await response.text();
      const data = text.length > 0 ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`PNP ${method} ${path} failed (${response.status})`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}
