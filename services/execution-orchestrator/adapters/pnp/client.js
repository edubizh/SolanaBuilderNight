const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_INITIAL_BACKOFF_MS = 100;
const DEFAULT_RETRY_MAX_BACKOFF_MS = 1_000;
const DEFAULT_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function createRetryConfig(retryPolicy) {
  const maxAttempts = asFiniteNumber(retryPolicy?.maxAttempts) ?? DEFAULT_RETRY_MAX_ATTEMPTS;
  const initialBackoffMs =
    asFiniteNumber(retryPolicy?.initialBackoffMs) ?? DEFAULT_RETRY_INITIAL_BACKOFF_MS;
  const maxBackoffMs = asFiniteNumber(retryPolicy?.maxBackoffMs) ?? DEFAULT_RETRY_MAX_BACKOFF_MS;
  const retryableStatusCodes = Array.isArray(retryPolicy?.retryableStatusCodes)
    ? new Set(retryPolicy.retryableStatusCodes.filter((status) => Number.isInteger(status)))
    : DEFAULT_RETRYABLE_STATUS_CODES;
  return {
    maxAttempts: Math.max(1, Math.trunc(maxAttempts)),
    initialBackoffMs: Math.max(0, Math.trunc(initialBackoffMs)),
    maxBackoffMs: Math.max(0, Math.trunc(maxBackoffMs)),
    retryableStatusCodes,
    retryOnTimeout: retryPolicy?.retryOnTimeout !== false,
    retryOnNetworkError: retryPolicy?.retryOnNetworkError !== false,
  };
}

function resolveRetryPolicy(baseRetryConfig, retryPolicyOverride, method, allowRetry) {
  const merged = createRetryConfig({
    ...baseRetryConfig,
    ...(retryPolicyOverride ?? {}),
  });
  if (method === "POST" && !allowRetry) {
    return {
      ...merged,
      maxAttempts: 1,
    };
  }
  return merged;
}

function computeBackoffMs(attempt, retryPolicy) {
  const exponent = Math.max(attempt - 1, 0);
  return Math.min(retryPolicy.maxBackoffMs, retryPolicy.initialBackoffMs * 2 ** exponent);
}

function isRetryableTransportError(error, retryPolicy) {
  if (!retryPolicy.retryOnNetworkError) {
    return false;
  }
  if (error?.retryable === true) {
    return true;
  }
  const code = typeof error?.code === "string" ? error.code.trim() : "";
  if (code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
    return true;
  }
  return error instanceof TypeError;
}

export class PnpClient {
  constructor({
    baseUrl = "https://api.pnp-protocol.io",
    fetchImpl = fetch,
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryPolicy,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.retryConfig = createRetryConfig(retryPolicy);
    this.sleepImpl = sleepImpl;
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
    const responseMarketId = payload?.marketId ?? payload?.id ?? marketId;
    if (responseMarketId !== marketId) {
      throw new Error(
        `PNP quote response marketId mismatch: requested ${marketId}, got ${String(responseMarketId)}`,
      );
    }

    const responseSize = payload?.size ?? payload?.quantity;
    if (responseSize !== undefined) {
      const normalizedSize = Number(responseSize);
      if (!Number.isFinite(normalizedSize) || normalizedSize <= 0) {
        throw new Error(`PNP quote for ${marketId} returned invalid size`);
      }
      if (Math.abs(normalizedSize - size) > Number.EPSILON) {
        throw new Error(
          `PNP quote response size mismatch: requested ${size}, got ${normalizedSize}`,
        );
      }
    }

    const quoteTimestampMs = this.#normalizeQuoteTimestampMs(payload, marketId);
    const fetchedAtMs = this.now();
    const sourceTimestampMs = quoteTimestampMs ?? fetchedAtMs;

    return {
      marketId,
      price,
      size,
      sourceTimestampMs,
      fetchedAtMs,
    };
  }

  #normalizeQuoteTimestampMs(payload, marketId) {
    const rawTimestamp =
      payload?.timestampMs ??
      payload?.quotedAtMs ??
      payload?.submittedAtMs ??
      payload?.acceptedAtMs ??
      payload?.asOfMs ??
      payload?.timestamp ??
      payload?.quotedAt;

    if (rawTimestamp === undefined || rawTimestamp === null || rawTimestamp === "") {
      return undefined;
    }

    const timestampMs = Number(rawTimestamp);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      throw new Error(`PNP quote for ${marketId} returned invalid timestamp`);
    }
    return timestampMs;
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

    const slippage = maxSlippageBps ?? 50;
    const payload = await this.#request(
      "POST",
      "/orders",
      {
        body: { intentId, marketId, side, size, maxSlippageBps: slippage },
        allowRetry: false,
      },
    );

    const orderId = payload?.orderId ?? payload?.id;
    if (!orderId || typeof orderId !== "string") {
      throw new Error("PNP submitOrder response missing orderId");
    }
    const status = typeof payload?.status === "string" && payload.status.length > 0 ? payload.status : "submitted";
    let submittedAtMs;
    try {
      submittedAtMs = this.#normalizeQuoteTimestampMs(payload, marketId) ?? this.now();
    } catch {
      submittedAtMs = this.now();
    }

    return {
      intentId,
      marketId,
      side,
      size,
      maxSlippageBps: slippage,
      orderId,
      status,
      acceptedAtMs: submittedAtMs,
    };
  }

  /**
   * @param {{ orderId?: string, intentId?: string }} params
   */
  async getOrderStatus({ orderId, intentId } = {}) {
    const hasOrder = orderId !== undefined && orderId !== null && String(orderId).trim().length > 0;
    const hasIntent = intentId !== undefined && intentId !== null && String(intentId).trim().length > 0;
    if (!hasOrder && !hasIntent) {
      throw new Error("PNP getOrderStatus requires orderId and/or intentId");
    }

    const query = {};
    if (hasOrder) {
      query.orderId = String(orderId).trim();
    }
    if (hasIntent) {
      query.intentId = String(intentId).trim();
    }

    const payload = await this.#request("GET", "/orders/status", { query });

    const statusRaw = payload?.status ?? payload?.orderStatus ?? payload?.lifecycleState;
    const status = typeof statusRaw === "string" && statusRaw.trim().length > 0 ? statusRaw.trim() : null;

    const filledRaw = payload?.filledSize ?? payload?.filled_size;
    const filledSize = filledRaw === undefined || filledRaw === null ? null : Number(filledRaw);

    const remainingRaw = payload?.remainingSize;
    const remainingSize = remainingRaw === undefined || remainingRaw === null ? null : Number(remainingRaw);

    const updatedAtMs = this.#resolveOrderStatusTimestampMs(payload) ?? this.now();

    return {
      status,
      filledSize: Number.isFinite(filledSize) ? filledSize : null,
      remainingSize: Number.isFinite(remainingSize) ? remainingSize : null,
      updatedAtMs,
      orderId: payload?.orderId ?? payload?.order_id ?? (hasOrder ? String(orderId).trim() : null),
      intentId: payload?.intentId ?? payload?.intent_id ?? (hasIntent ? String(intentId).trim() : null),
      raw: payload,
    };
  }

  #resolveOrderStatusTimestampMs(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const candidates = [
      payload.timestampMs,
      payload.updatedAtMs,
      payload.createdAtMs,
      payload.timestamp,
      payload.updatedAt,
      payload.createdAt,
      payload.ts,
      payload.time,
    ];
    for (const candidate of candidates) {
      const parsed = this.#parseTimestampMs(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  #parseTimestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value >= 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber >= 1_000_000_000_000 ? asNumber : asNumber * 1000;
      }
      const asDateMs = Date.parse(trimmed);
      if (Number.isFinite(asDateMs)) {
        return asDateMs;
      }
    }
    return null;
  }

  async #request(method, path, { query, body, allowRetry = false, retryPolicy } = {}) {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const retryCfg = resolveRetryPolicy(this.retryConfig, retryPolicy, method, allowRetry === true);
    const maxAttempts = retryCfg.maxAttempts;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url.toString(), {
          method,
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const text = await response.text();
        const data = text.length > 0 ? JSON.parse(text) : {};
        if (!response.ok) {
          const error = new Error(`PNP ${method} ${path} failed (${response.status})`);
          error.retryable = retryCfg.retryableStatusCodes.has(response.status);
          lastError = error;
          if (!error.retryable || attempt >= maxAttempts) {
            throw error;
          }
          const backoffMs = computeBackoffMs(attempt, retryCfg);
          if (backoffMs > 0) {
            await this.sleepImpl(backoffMs);
          }
          continue;
        }
        return data;
      } catch (error) {
        lastError = error;
        const isAbortError = error?.name === "AbortError";
        const retryableByType = isAbortError ? retryCfg.retryOnTimeout : isRetryableTransportError(error, retryCfg);
        if (!retryableByType || attempt >= maxAttempts) {
          throw error;
        }
        const backoffMs = computeBackoffMs(attempt, retryCfg);
        if (backoffMs > 0) {
          await this.sleepImpl(backoffMs);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error(`PNP ${method} ${path} failed after retries`);
  }
}
