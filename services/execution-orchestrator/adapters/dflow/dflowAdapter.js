const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TX_ENCODING = "base64";
const DEFAULT_STATUS_POLL_INTERVAL_MS = 250;
const DEFAULT_STATUS_MAX_ATTEMPTS = 20;
const DEFAULT_STATUS_TERMINAL_STATES = new Set([
  "filled",
  "succeeded",
  "success",
  "completed",
  "confirmed",
  "landed",
  "failed",
  "rejected",
  "cancelled",
  "canceled",
  "expired",
  "dropped",
]);

export class DFlowAdapter {
  /**
   * @param {object} config
   * @param {string} [config.tradingBaseUrl]
   * @param {string} [config.metadataBaseUrl]
   * @param {typeof fetch} [config.fetchImpl]
   * @param {number} [config.timeoutMs]
   */
  constructor(config = {}) {
    this.tradingBaseUrl = config.tradingBaseUrl ?? "https://quote-api.dflow.net";
    this.metadataBaseUrl = config.metadataBaseUrl ?? "https://api.prod.dflow.net";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleepImpl = config.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.idempotentSubmissionStore = config.idempotentSubmissionStore ?? new Map();
    this.terminalStateStore = config.terminalStateStore ?? new Map();
  }

  /**
   * @param {Record<string, string | number | boolean | undefined>} params
   */
  async getOrder(params) {
    return this.#request("GET", this.tradingBaseUrl, "/order", { query: params });
  }

  /**
   * Request /order and normalize any transaction payloads for execution orchestration.
   * @param {Record<string, string | number | boolean | undefined>} params
   */
  async getOrderWithParsedTransactions(params) {
    const order = await this.getOrder(params);
    return {
      ...order,
      parsedTransactions: this.#extractTransactions(order),
    };
  }

  /**
   * @param {Record<string, string | number | boolean | undefined>} params
   */
  async getOrderStatus(params) {
    return this.#request("GET", this.tradingBaseUrl, "/order-status", { query: params });
  }

  /**
   * Poll /order-status until terminal state or polling limits are reached.
   * @param {Record<string, string | number | boolean | undefined>} params
   * @param {object} [options]
   * @param {number} [options.pollIntervalMs]
   * @param {number} [options.maxAttempts]
   * @param {number} [options.timeoutMs]
   * @param {string[]} [options.terminalStates]
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
      const statusResponse = await this.getOrderStatus(params);
      const normalizedState = this.#normalizeOrderStatusState(statusResponse);
      history.push({
        attempt,
        polledAtMs: Date.now(),
        state: normalizedState,
        response: statusResponse,
      });

      if (normalizedState && terminalStates.has(normalizedState)) {
        const terminalResult = {
          terminal: true,
          timedOut: false,
          maxAttemptsReached: false,
          attempts: attempt,
          finalState: normalizedState,
          finalResponse: statusResponse,
          history,
        };
        this.#persistTerminalLifecycle(params, terminalResult);
        return terminalResult;
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
   * @param {Record<string, string | number | boolean | undefined>} params
   */
  async getQuote(params) {
    return this.#request("GET", this.tradingBaseUrl, "/quote", { query: params });
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  async postSwap(payload) {
    return this.#request("POST", this.tradingBaseUrl, "/swap", { body: payload });
  }

  /**
   * Idempotent swap submission keyed by explicit key or payload identity.
   * @param {Record<string, unknown>} payload
   * @param {object} [options]
   * @param {string} [options.idempotencyKey]
   */
  async postSwapIdempotent(payload, options = {}) {
    const idempotencyKey = this.#resolveSubmissionIdempotencyKey(payload, options.idempotencyKey);
    const existing = this.idempotentSubmissionStore.get(idempotencyKey);
    if (existing) {
      const previous = await existing;
      return {
        ...previous,
        deduplicated: true,
      };
    }

    const submissionPromise = this.postSwap(payload)
      .then((swap) => ({
        idempotencyKey,
        deduplicated: false,
        swap,
      }))
      .catch((error) => {
        this.idempotentSubmissionStore.delete(idempotencyKey);
        throw error;
      });

    this.idempotentSubmissionStore.set(idempotencyKey, submissionPromise);
    const resolved = await submissionPromise;
    const persisted = Promise.resolve({ ...resolved, deduplicated: true });
    this.idempotentSubmissionStore.set(idempotencyKey, persisted);
    return resolved;
  }

  /**
   * Imperative execution helper: fetches a quote then executes swap for that quote.
   * @param {Record<string, string | number | boolean | undefined>} quoteParams
   * @param {Record<string, unknown>} [swapOverrides]
   */
  async executeImperativeSwap(quoteParams, swapOverrides = {}) {
    const quote = await this.getQuote(quoteParams);
    const quoteId = quote?.quoteId ?? quote?.id ?? swapOverrides.quoteId;
    if (!quoteId) {
      throw new Error("DFlow imperative swap requires quoteId from /quote response");
    }

    const swapRequest = {
      ...swapOverrides,
      quoteId,
    };

    const submitted = await this.postSwapIdempotent(swapRequest);
    return {
      quote,
      swapRequest,
      swap: submitted.swap,
      idempotencyKey: submitted.idempotencyKey,
      deduplicated: submitted.deduplicated,
    };
  }

  /**
   * @param {string} marketAddress
   */
  async getMarketMetadata(marketAddress) {
    return this.#request("GET", this.metadataBaseUrl, `/markets/${marketAddress}`);
  }

  /**
   * @param {string} key
   */
  getPersistedTerminalState(key) {
    if (typeof key !== "string" || key.trim().length === 0) {
      return null;
    }

    return this.terminalStateStore.get(key) ?? null;
  }

  async #request(method, baseUrl, path, options = {}) {
    const url = new URL(path, baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: options.body ? { "content-type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const data = text.length > 0 ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`DFlow ${method} ${path} failed (${response.status})`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * @param {Record<string, unknown>} orderResponse
   */
  #extractTransactions(orderResponse) {
    if (!orderResponse || typeof orderResponse !== "object") {
      return [];
    }

    const candidates = [
      ["transaction", orderResponse.transaction],
      ["tx", orderResponse.tx],
      ["transactions", orderResponse.transactions],
      ["swapTransaction", orderResponse.swapTransaction],
      ["setupTransaction", orderResponse.setupTransaction],
      ["cleanupTransaction", orderResponse.cleanupTransaction],
    ];

    const parsed = [];
    for (const [sourceField, candidate] of candidates) {
      if (candidate === undefined || candidate === null) {
        continue;
      }

      if (Array.isArray(candidate)) {
        for (const nested of candidate) {
          const parsedTx = this.#parseTransactionCandidate(sourceField, nested);
          if (parsedTx) {
            parsed.push(parsedTx);
          }
        }
        continue;
      }

      const parsedTx = this.#parseTransactionCandidate(sourceField, candidate);
      if (parsedTx) {
        parsed.push(parsedTx);
      }
    }

    return parsed;
  }

  /**
   * @param {string} sourceField
   * @param {unknown} candidate
   */
  #parseTransactionCandidate(sourceField, candidate) {
    if (typeof candidate === "string") {
      return this.#normalizeTransactionEnvelope({
        sourceField,
        transaction: candidate,
      });
    }

    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    const tx =
      candidate.transaction ??
      candidate.tx ??
      candidate.serializedTransaction ??
      candidate.serializedTx;

    if (typeof tx !== "string") {
      return null;
    }

    return this.#normalizeTransactionEnvelope({
      sourceField,
      transaction: tx,
      encoding: candidate.encoding,
      signer: candidate.signer,
      expiresAtMs: candidate.expiresAtMs,
      expiresAt: candidate.expiresAt,
      routePlan: candidate.routePlan,
      expectedOutAmount: candidate.expectedOutAmount,
    });
  }

  /**
   * @param {object} envelope
   * @param {string} envelope.sourceField
   * @param {string} envelope.transaction
   * @param {unknown} [envelope.encoding]
   * @param {unknown} [envelope.signer]
   * @param {unknown} [envelope.expiresAtMs]
   * @param {unknown} [envelope.expiresAt]
   * @param {unknown} [envelope.routePlan]
   * @param {unknown} [envelope.expectedOutAmount]
   */
  #normalizeTransactionEnvelope(envelope) {
    const encoding = typeof envelope.encoding === "string" ? envelope.encoding : DEFAULT_TX_ENCODING;
    let byteLength = null;
    if (encoding === "base64") {
      try {
        byteLength = Buffer.from(envelope.transaction, "base64").byteLength;
      } catch {
        byteLength = null;
      }
    }

    return {
      sourceField: envelope.sourceField,
      transaction: envelope.transaction,
      encoding,
      byteLength,
      signer: typeof envelope.signer === "string" ? envelope.signer : null,
      expiresAtMs:
        typeof envelope.expiresAtMs === "number"
          ? envelope.expiresAtMs
          : typeof envelope.expiresAt === "number"
            ? envelope.expiresAt
            : null,
      routePlan: envelope.routePlan ?? null,
      expectedOutAmount:
        typeof envelope.expectedOutAmount === "string" || typeof envelope.expectedOutAmount === "number"
          ? String(envelope.expectedOutAmount)
          : null,
    };
  }

  /**
   * @param {unknown} response
   */
  #normalizeOrderStatusState(response) {
    if (!response || typeof response !== "object") {
      return null;
    }

    const stateCandidate =
      response.status ??
      response.state ??
      response.orderStatus ??
      response.executionStatus ??
      response.lifecycleState;

    if (typeof stateCandidate !== "string") {
      return null;
    }

    return stateCandidate.trim().toLowerCase();
  }

  /**
   * @param {unknown} terminalStates
   */
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

  /**
   * @param {Record<string, string | number | boolean | undefined>} params
   * @param {object} lifecycle
   */
  #persistTerminalLifecycle(params, lifecycle) {
    const persistedAtMs = Date.now();
    const keys = [
      this.#asNonEmptyString(params?.intentId),
      this.#asNonEmptyString(params?.orderId),
      this.#asNonEmptyString(lifecycle?.finalResponse?.intentId),
      this.#asNonEmptyString(lifecycle?.finalResponse?.orderId),
      this.#asNonEmptyString(lifecycle?.finalResponse?.id),
    ].filter(Boolean);

    if (keys.length === 0) {
      return;
    }

    const record = {
      ...lifecycle,
      persistedAtMs,
    };

    for (const key of keys) {
      this.terminalStateStore.set(key, record);
    }
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {string | undefined} explicitKey
   */
  #resolveSubmissionIdempotencyKey(payload, explicitKey) {
    const explicit = this.#asNonEmptyString(explicitKey);
    if (explicit) {
      return explicit;
    }

    const derivedCandidates = [
      this.#asNonEmptyString(payload?.intentId),
      this.#asNonEmptyString(payload?.idempotencyKey),
      this.#asNonEmptyString(payload?.orderId),
      this.#asNonEmptyString(payload?.quoteId),
      this.#asNonEmptyString(payload?.clientOrderId),
    ];
    const derived = derivedCandidates.find(Boolean);

    if (!derived) {
      throw new Error(
        "DFlow idempotent swap submission requires idempotencyKey or one of intentId/idempotencyKey/orderId/quoteId/clientOrderId in payload",
      );
    }

    return derived;
  }

  /**
   * @param {unknown} value
   */
  #asNonEmptyString(value) {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
