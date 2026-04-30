import { PnpClient } from "./client.js";

const CUSTOM_ORACLE_RESOLVABLE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_QUOTE_AGE_MS = 5_000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 500;
const DEFAULT_STATUS_MAX_ATTEMPTS = 20;
const DEFAULT_ORDER_STATUS_FRESHNESS_MAX_AGE_MS = 30_000;
const DEFAULT_STATUS_TERMINAL_STATES = new Set([
  "filled",
  "succeeded",
  "success",
  "completed",
  "confirmed",
  "failed",
  "rejected",
  "cancelled",
  "canceled",
  "expired",
  "dropped",
]);

export class PnpExecutionAdapter {
  constructor({
    client = new PnpClient(),
    enableV3 = false,
    featureFlags = {},
    now = () => Date.now(),
    maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.client = client;
    this.enableV3 = enableV3;
    this.featureFlags = featureFlags;
    this.now = now;
    this.maxQuoteAgeMs = maxQuoteAgeMs;
    this.sleepImpl = sleepImpl;
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

  /**
   * Fetches a quote then validates integrity without throwing — for guarded-live gating.
   * @param {{ marketId: string, size: number }} params
   */
  async evaluateGuardedLiveQuote(params) {
    let quote;
    try {
      quote = await this.client.getQuote(params);
    } catch (error) {
      return {
        quoteFetchFailed: true,
        quote: null,
        quoteIntegrity: {
          ok: false,
          errors: [error?.message ?? "unknown quote fetch error"],
          warnings: [],
          parsed: {},
        },
      };
    }
    try {
      const validated = this.#validateQuoteIntegrity({
        quote,
        marketId: params.marketId,
        size: params.size,
      });
      return {
        quoteFetchFailed: false,
        quote: validated,
        quoteIntegrity: { ok: true, errors: [], warnings: [], parsed: {} },
      };
    } catch (error) {
      return {
        quoteFetchFailed: false,
        quote,
        quoteIntegrity: {
          ok: false,
          errors: [error?.message ?? "unknown quote integrity error"],
          warnings: [],
          parsed: {},
        },
      };
    }
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

  /**
   * Poll order status until terminal state or limits.
   * @param {{ orderId?: string, intentId?: string }} params
   * @param {{ pollIntervalMs?: number, maxAttempts?: number, timeoutMs?: number | null, terminalStates?: string[] }} [options]
   */
  async trackOrderStatusLifecycle(params, options = {}) {
    const startedAtMs = Date.now();
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : null;
    const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
      ? Number(options.pollIntervalMs)
      : DEFAULT_STATUS_POLL_INTERVAL_MS;
    const maxAttempts = Number.isFinite(options.maxAttempts)
      ? Number(options.maxAttempts)
      : DEFAULT_STATUS_MAX_ATTEMPTS;
    const terminalStates = this.#createTerminalStateSet(options.terminalStates);
    const history = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const statusResponse = await this.client.getOrderStatus(params);
      const normalizedState = this.#normalizeOrderStatusState(statusResponse);
      history.push({
        attempt,
        polledAtMs: Date.now(),
        state: normalizedState,
        response: statusResponse,
      });

      if (normalizedState && terminalStates.has(normalizedState)) {
        return {
          terminal: true,
          timedOut: false,
          maxAttemptsReached: false,
          attempts: attempt,
          finalState: normalizedState,
          finalResponse: statusResponse,
          history,
        };
      }

      const elapsedMs = Date.now() - startedAtMs;
      if (timeoutMs !== null && elapsedMs >= timeoutMs) {
        return {
          terminal: false,
          timedOut: true,
          maxAttemptsReached: false,
          attempts: attempt,
          finalState: normalizedState,
          finalResponse: statusResponse,
          history,
        };
      }

      if (attempt < maxAttempts && pollIntervalMs > 0) {
        await this.sleepImpl(pollIntervalMs);
      }
    }

    const finalEntry = history[history.length - 1] ?? null;
    return {
      terminal: false,
      timedOut: false,
      maxAttemptsReached: true,
      attempts: history.length,
      finalState: finalEntry?.state ?? null,
      finalResponse: finalEntry?.response ?? null,
      history,
    };
  }

  /**
   * @param {unknown} statusResponse
   * @param {{ nowMs?: number, maxAgeMs?: number }} [options]
   */
  validateOrderStatusIntegrity(statusResponse, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : this.now();
    const maxAgeMs = Number.isFinite(options.maxAgeMs)
      ? Number(options.maxAgeMs)
      : DEFAULT_ORDER_STATUS_FRESHNESS_MAX_AGE_MS;
    const errors = [];
    const warnings = [];

    const normalized = statusResponse && typeof statusResponse === "object" ? statusResponse : {};
    const statusRaw =
      normalized.status ?? normalized.orderStatus ?? normalized.lifecycleState ?? normalized.state;
    const status =
      typeof statusRaw === "string" && statusRaw.trim().length > 0 ? statusRaw.trim().toLowerCase() : null;
    if (!status) {
      errors.push("missing non-empty status");
    }

    const orderId = this.#asNonEmptyString(normalized.orderId) ?? this.#asNonEmptyString(normalized.order_id);
    const intentId = this.#asNonEmptyString(normalized.intentId) ?? this.#asNonEmptyString(normalized.intent_id);
    if (!orderId && !intentId) {
      errors.push("missing orderId and intentId");
    }

    const timestampMs = this.#resolveStatusTimestampMs(normalized);
    if (timestampMs === null) {
      errors.push("missing timestamp for freshness verification");
    } else {
      const ageMs = nowMs - timestampMs;
      if (!Number.isFinite(ageMs) || ageMs < 0) {
        errors.push("invalid timestamp age");
      } else if (ageMs > maxAgeMs) {
        errors.push(`order status response is stale (${ageMs}ms old > ${maxAgeMs}ms)`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      parsed: {
        status,
        timestampMs,
      },
    };
  }

  #normalizeOrderStatusState(response) {
    if (!response || typeof response !== "object") {
      return null;
    }
    const stateCandidate =
      response.status ?? response.state ?? response.orderStatus ?? response.executionStatus ?? response.lifecycleState;
    if (typeof stateCandidate !== "string") {
      return null;
    }
    return stateCandidate.trim().toLowerCase();
  }

  #createTerminalStateSet(terminalStates) {
    if (!Array.isArray(terminalStates) || terminalStates.length === 0) {
      return DEFAULT_STATUS_TERMINAL_STATES;
    }
    const normalized = terminalStates
      .filter((state) => typeof state === "string")
      .map((state) => state.trim().toLowerCase())
      .filter((state) => state.length > 0);
    if (normalized.length === 0) {
      return DEFAULT_STATUS_TERMINAL_STATES;
    }
    return new Set(normalized);
  }

  #resolveStatusTimestampMs(response) {
    if (!response || typeof response !== "object") {
      return null;
    }
    const candidates = [
      response.updatedAtMs,
      response.timestampMs,
      response.createdAtMs,
      response.timestamp,
      response.updatedAt,
      response.createdAt,
      response.ts,
      response.time,
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

  #asNonEmptyString(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
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
