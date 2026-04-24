const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TX_ENCODING = "base64";
const DEFAULT_STATUS_POLL_INTERVAL_MS = 250;
const DEFAULT_STATUS_MAX_ATTEMPTS = 20;
const DEFAULT_QUOTE_FRESHNESS_MAX_AGE_MS = 15_000;
const DEFAULT_ORDER_STATUS_FRESHNESS_MAX_AGE_MS = 30_000;
const DEFAULT_GUARDED_MODE = "dry_run";
const DEFAULT_MAX_NOTIONAL_USD = 250;
const DEFAULT_MAX_DAILY_NOTIONAL_USD = 2_500;
const DEFAULT_MAX_SLIPPAGE_BPS = 75;
const DEFAULT_APPROVAL_TTL_MS = 15 * 60_000;
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
    this.guardrailConfig = this.#createGuardrailConfig(config.guardrails);
    this.approvalStore = config.approvalStore ?? new Map();
    this.executionAuditTrail = config.executionAuditTrail ?? [];
    this.dailyNotionalLedger = config.dailyNotionalLedger ?? new Map();
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
   * Fetch /quote and return deterministic integrity evaluation output.
   * @param {Record<string, string | number | boolean | undefined>} params
   * @param {object} [options]
   * @param {number} [options.nowMs]
   * @param {number} [options.maxAgeMs]
   * @param {boolean} [options.throwOnError]
   */
  async getQuoteIntegrity(params, options = {}) {
    const quote = await this.getQuote(params);
    return this.validateQuoteIntegrity(quote, options);
  }

  /**
   * Validate /quote response freshness and canonical identifiers.
   * @param {unknown} quoteResponse
   * @param {object} [options]
   * @param {number} [options.nowMs]
   * @param {number} [options.maxAgeMs]
   * @param {boolean} [options.throwOnError]
   */
  validateQuoteIntegrity(quoteResponse, options = {}) {
    const evaluated = this.#evaluateIntegrity(quoteResponse, {
      responseType: "quote",
      nowMs: options.nowMs,
      maxAgeMs: options.maxAgeMs,
      defaultMaxAgeMs: DEFAULT_QUOTE_FRESHNESS_MAX_AGE_MS,
    });
    if (options.throwOnError && !evaluated.ok) {
      throw new Error(`DFlow quote integrity validation failed: ${evaluated.errors.join("; ")}`);
    }
    return evaluated;
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
   * Create an approval token required for guarded-live submissions.
   * @param {object} request
   * @param {string} request.intentId
   * @param {number} request.estimatedNotionalUsd
   * @param {string} request.approvedBy
   * @param {number} [request.approvedAtMs]
   * @param {number} [request.expiresAtMs]
   * @param {string} [request.approvalId]
   */
  createGuardedLiveApproval(request) {
    const intentId = this.#asNonEmptyString(request?.intentId);
    const approvedBy = this.#asNonEmptyString(request?.approvedBy);
    const estimatedNotionalUsd = this.#asFiniteNumber(request?.estimatedNotionalUsd);
    if (!intentId || !approvedBy || estimatedNotionalUsd === null) {
      throw new Error("Guarded-live approval requires intentId, approvedBy, and estimatedNotionalUsd");
    }

    const approvedAtMs = Number.isFinite(request?.approvedAtMs) ? Number(request.approvedAtMs) : Date.now();
    const expiresAtMs = Number.isFinite(request?.expiresAtMs)
      ? Number(request.expiresAtMs)
      : approvedAtMs + this.guardrailConfig.approvalTtlMs;
    const approvalId = this.#asNonEmptyString(request?.approvalId) ?? `dflow-approval-${intentId}-${approvedAtMs}`;

    const approval = {
      approvalId,
      intentId,
      estimatedNotionalUsd,
      approvedBy,
      approvedAtMs,
      expiresAtMs,
      createdAtMs: Date.now(),
      used: false,
      usedAtMs: null,
    };
    this.approvalStore.set(approvalId, approval);
    this.#recordAudit("approval_created", {
      approvalId,
      intentId,
      estimatedNotionalUsd,
      approvedBy,
      expiresAtMs,
    });
    return approval;
  }

  /**
   * Stage C guarded-live execution path with hard caps and no-naked enforcement.
   * @param {object} request
   * @param {string} request.intentId
   * @param {Record<string, string | number | boolean | undefined>} request.quoteParams
   * @param {Record<string, unknown>} request.swapPayload
   * @param {object} request.riskContext
   * @param {number} request.riskContext.estimatedNotionalUsd
   * @param {number} request.riskContext.currentNetExposureUsd
   * @param {number} request.riskContext.projectedNetExposureUsd
   * @param {number} [request.riskContext.hedgedExposureUsd]
   * @param {boolean} [request.riskContext.reduceOnly]
   * @param {object} [options]
   * @param {boolean} [options.live]
   * @param {string} [options.approvalId]
   * @param {number} [options.nowMs]
   */
  async executeGuardedLiveSwap(request, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const mode = this.guardrailConfig.mode;
    const runLive = options.live === true && mode === "guarded_live";
    const assessment = this.assessGuardedLiveRisk(request, { nowMs });
    const artifact = {
      artifactId: `dflow-guarded-${assessment.intentId}-${nowMs}`,
      mode,
      liveRequested: options.live === true,
      liveExecuted: false,
      createdAtMs: nowMs,
      assessment,
      approval: null,
      quoteIntegrity: null,
      submission: null,
    };

    if (!assessment.allowed) {
      this.#recordAudit("guarded_rejected", artifact);
      return artifact;
    }

    if (!runLive) {
      this.#recordAudit("guarded_dry_run", artifact);
      return artifact;
    }

    const approval = this.#consumeValidApproval({
      approvalId: options.approvalId,
      intentId: assessment.intentId,
      estimatedNotionalUsd: assessment.risk.estimatedNotionalUsd,
      nowMs,
    });
    artifact.approval = approval;

    const quoteIntegrity = await this.getQuoteIntegrity(request.quoteParams ?? {}, { nowMs });
    artifact.quoteIntegrity = quoteIntegrity;
    if (!quoteIntegrity.ok) {
      artifact.assessment.allowed = false;
      artifact.assessment.violations.push("quote integrity validation failed before live submission");
      this.#recordAudit("guarded_rejected_quote_integrity", artifact);
      return artifact;
    }

    const submission = await this.postSwapIdempotent(request.swapPayload ?? {}, {
      idempotencyKey: request.swapPayload?.idempotencyKey ?? assessment.intentId,
    });
    artifact.liveExecuted = true;
    artifact.submission = submission;
    this.#incrementDailyNotionalLedger(assessment.risk.estimatedNotionalUsd, nowMs);
    this.#recordAudit("guarded_live_executed", artifact);
    return artifact;
  }

  /**
   * @param {object} request
   * @param {object} [options]
   * @param {number} [options.nowMs]
   */
  assessGuardedLiveRisk(request, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const intentId = this.#asNonEmptyString(request?.intentId) ?? "unknown-intent";
    const estimatedNotionalUsd = this.#asFiniteNumber(request?.riskContext?.estimatedNotionalUsd);
    const currentNetExposureUsd = this.#asFiniteNumber(request?.riskContext?.currentNetExposureUsd);
    const projectedNetExposureUsd = this.#asFiniteNumber(request?.riskContext?.projectedNetExposureUsd);
    const hedgedExposureUsd = this.#asFiniteNumber(request?.riskContext?.hedgedExposureUsd) ?? 0;
    const reduceOnly = request?.riskContext?.reduceOnly === true;
    const swapSlippageBps = this.#asFiniteNumber(request?.swapPayload?.slippageBps);
    const violations = [];

    if (!this.guardrailConfig.enabled) {
      violations.push("guarded-live path disabled by configuration");
    }
    if (estimatedNotionalUsd === null) {
      violations.push("missing riskContext.estimatedNotionalUsd");
    }
    if (estimatedNotionalUsd !== null && estimatedNotionalUsd > this.guardrailConfig.maxNotionalUsd) {
      violations.push(
        `notional cap breach (${estimatedNotionalUsd} > ${this.guardrailConfig.maxNotionalUsd} USD per trade)`,
      );
    }

    const dayKey = this.#toUtcDayKey(nowMs);
    const dailyUsed = this.dailyNotionalLedger.get(dayKey) ?? 0;
    if (estimatedNotionalUsd !== null && dailyUsed + estimatedNotionalUsd > this.guardrailConfig.maxDailyNotionalUsd) {
      violations.push(
        `daily notional cap breach (${dailyUsed + estimatedNotionalUsd} > ${this.guardrailConfig.maxDailyNotionalUsd} USD)`,
      );
    }

    if (swapSlippageBps !== null && swapSlippageBps > this.guardrailConfig.maxSlippageBps) {
      violations.push(`slippage cap breach (${swapSlippageBps}bps > ${this.guardrailConfig.maxSlippageBps}bps)`);
    }

    if (this.guardrailConfig.enforceNoNakedExposure) {
      const hasExposureInputs = currentNetExposureUsd !== null && projectedNetExposureUsd !== null;
      if (!hasExposureInputs) {
        violations.push("missing exposure fields for no-naked-exposure guard");
      } else {
        const currentAbs = Math.abs(currentNetExposureUsd);
        const projectedAbs = Math.abs(projectedNetExposureUsd);
        const reducesExposure = projectedAbs <= currentAbs;
        const fullyHedged = hedgedExposureUsd >= projectedAbs;
        if (!reduceOnly && !reducesExposure && !fullyHedged) {
          violations.push("no-naked-exposure guard failed (position increases without sufficient hedge)");
        }
      }
    }

    return {
      intentId,
      evaluatedAtMs: nowMs,
      allowed: violations.length === 0,
      violations,
      risk: {
        estimatedNotionalUsd,
        currentNetExposureUsd,
        projectedNetExposureUsd,
        hedgedExposureUsd,
        reduceOnly,
        swapSlippageBps,
        dailyUsedNotionalUsd: dailyUsed,
        dailyRemainingNotionalUsd: Math.max(this.guardrailConfig.maxDailyNotionalUsd - dailyUsed, 0),
      },
      caps: {
        maxNotionalUsd: this.guardrailConfig.maxNotionalUsd,
        maxDailyNotionalUsd: this.guardrailConfig.maxDailyNotionalUsd,
        maxSlippageBps: this.guardrailConfig.maxSlippageBps,
      },
      mode: this.guardrailConfig.mode,
    };
  }

  listGuardedExecutionAuditTrail() {
    return [...this.executionAuditTrail];
  }

  /**
   * @param {string} marketAddress
   */
  async getMarketMetadata(marketAddress) {
    return this.#request("GET", this.metadataBaseUrl, `/markets/${marketAddress}`);
  }

  /**
   * Fetch /order-status and return deterministic integrity evaluation output.
   * @param {Record<string, string | number | boolean | undefined>} params
   * @param {object} [options]
   * @param {number} [options.nowMs]
   * @param {number} [options.maxAgeMs]
   * @param {boolean} [options.throwOnError]
   */
  async getOrderStatusIntegrity(params, options = {}) {
    const statusResponse = await this.getOrderStatus(params);
    return this.validateOrderStatusIntegrity(statusResponse, options);
  }

  /**
   * Validate /order-status response freshness, state parsing, and canonical identifiers.
   * @param {unknown} statusResponse
   * @param {object} [options]
   * @param {number} [options.nowMs]
   * @param {number} [options.maxAgeMs]
   * @param {boolean} [options.throwOnError]
   */
  validateOrderStatusIntegrity(statusResponse, options = {}) {
    const evaluated = this.#evaluateIntegrity(statusResponse, {
      responseType: "order-status",
      nowMs: options.nowMs,
      maxAgeMs: options.maxAgeMs,
      defaultMaxAgeMs: DEFAULT_ORDER_STATUS_FRESHNESS_MAX_AGE_MS,
    });
    if (options.throwOnError && !evaluated.ok) {
      throw new Error(`DFlow order-status integrity validation failed: ${evaluated.errors.join("; ")}`);
    }
    return evaluated;
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

  /**
   * @param {unknown} response
   * @param {object} options
   * @param {"quote" | "order-status"} options.responseType
   * @param {number | undefined} options.nowMs
   * @param {number | undefined} options.maxAgeMs
   * @param {number} options.defaultMaxAgeMs
   */
  #evaluateIntegrity(response, options) {
    const normalized = response && typeof response === "object" ? response : {};
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : options.defaultMaxAgeMs;
    const errors = [];
    const warnings = [];

    const canonicalIds = this.#extractCanonicalIds(normalized);
    if (!canonicalIds.primaryId) {
      errors.push("missing canonical primary identifier");
    }

    const sourceTimestampMs = this.#resolveResponseTimestampMs(normalized);
    let freshnessAgeMs = null;
    let isFresh = null;
    if (sourceTimestampMs === null) {
      warnings.push("missing timestamp for freshness verification");
    } else {
      freshnessAgeMs = nowMs - sourceTimestampMs;
      isFresh = freshnessAgeMs <= maxAgeMs;
      if (!isFresh) {
        errors.push(`${options.responseType} response is stale (${freshnessAgeMs}ms old > ${maxAgeMs}ms)`);
      }
    }

    const parsedStatus = this.#normalizeOrderStatusState(normalized);
    if (options.responseType === "order-status" && !parsedStatus) {
      errors.push("missing parseable order status state");
    }

    return {
      ok: errors.length === 0,
      responseType: options.responseType,
      parsed: {
        status: parsedStatus,
        timestampMs: sourceTimestampMs,
      },
      canonicalIds,
      freshness: {
        nowMs,
        maxAgeMs,
        timestampMs: sourceTimestampMs,
        ageMs: freshnessAgeMs,
        isFresh,
      },
      errors,
      warnings,
      response: normalized,
    };
  }

  /**
   * @param {Record<string, unknown>} response
   */
  #extractCanonicalIds(response) {
    const quoteId = this.#asNonEmptyString(response.quoteId) ?? this.#asNonEmptyString(response.quote_id);
    const orderId = this.#asNonEmptyString(response.orderId) ?? this.#asNonEmptyString(response.order_id);
    const intentId = this.#asNonEmptyString(response.intentId) ?? this.#asNonEmptyString(response.intent_id);
    const clientOrderId =
      this.#asNonEmptyString(response.clientOrderId) ?? this.#asNonEmptyString(response.client_order_id);
    const requestId = this.#asNonEmptyString(response.requestId) ?? this.#asNonEmptyString(response.request_id);
    const fallbackId = this.#asNonEmptyString(response.id);

    return {
      primaryId: quoteId ?? orderId ?? intentId ?? clientOrderId ?? requestId ?? fallbackId ?? null,
      quoteId: quoteId ?? null,
      orderId: orderId ?? null,
      intentId: intentId ?? null,
      clientOrderId: clientOrderId ?? null,
      requestId: requestId ?? null,
      id: fallbackId ?? null,
    };
  }

  /**
   * @param {Record<string, unknown>} response
   */
  #resolveResponseTimestampMs(response) {
    const timestampCandidates = [
      response.timestampMs,
      response.updatedAtMs,
      response.createdAtMs,
      response.timestamp,
      response.updatedAt,
      response.createdAt,
      response.ts,
      response.time,
    ];

    for (const candidate of timestampCandidates) {
      const parsed = this.#parseTimestampMs(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  /**
   * @param {unknown} value
   */
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

  #createGuardrailConfig(guardrails) {
    const mode = guardrails?.mode === "guarded_live" ? "guarded_live" : DEFAULT_GUARDED_MODE;
    return {
      enabled: guardrails?.enabled !== false,
      mode,
      maxNotionalUsd: this.#asFiniteNumber(guardrails?.maxNotionalUsd) ?? DEFAULT_MAX_NOTIONAL_USD,
      maxDailyNotionalUsd:
        this.#asFiniteNumber(guardrails?.maxDailyNotionalUsd) ?? DEFAULT_MAX_DAILY_NOTIONAL_USD,
      maxSlippageBps: this.#asFiniteNumber(guardrails?.maxSlippageBps) ?? DEFAULT_MAX_SLIPPAGE_BPS,
      approvalTtlMs: this.#asFiniteNumber(guardrails?.approvalTtlMs) ?? DEFAULT_APPROVAL_TTL_MS,
      enforceNoNakedExposure: guardrails?.enforceNoNakedExposure !== false,
    };
  }

  #consumeValidApproval({ approvalId, intentId, estimatedNotionalUsd, nowMs }) {
    const normalizedApprovalId = this.#asNonEmptyString(approvalId);
    if (!normalizedApprovalId) {
      throw new Error("guarded-live live execution requires approvalId");
    }

    const approval = this.approvalStore.get(normalizedApprovalId);
    if (!approval) {
      throw new Error(`guarded-live approval not found: ${normalizedApprovalId}`);
    }
    if (approval.used) {
      throw new Error(`guarded-live approval already consumed: ${normalizedApprovalId}`);
    }
    if (approval.intentId !== intentId) {
      throw new Error(`guarded-live approval intent mismatch (${approval.intentId} != ${intentId})`);
    }
    if (approval.expiresAtMs < nowMs) {
      throw new Error(`guarded-live approval expired at ${approval.expiresAtMs}`);
    }
    if (estimatedNotionalUsd !== null && estimatedNotionalUsd > approval.estimatedNotionalUsd) {
      throw new Error(
        `guarded-live notional exceeds approval (${estimatedNotionalUsd} > ${approval.estimatedNotionalUsd})`,
      );
    }

    const consumed = {
      ...approval,
      used: true,
      usedAtMs: nowMs,
    };
    this.approvalStore.set(normalizedApprovalId, consumed);
    return consumed;
  }

  #incrementDailyNotionalLedger(estimatedNotionalUsd, nowMs) {
    if (estimatedNotionalUsd === null) {
      return;
    }
    const dayKey = this.#toUtcDayKey(nowMs);
    const current = this.dailyNotionalLedger.get(dayKey) ?? 0;
    this.dailyNotionalLedger.set(dayKey, current + estimatedNotionalUsd);
  }

  #toUtcDayKey(nowMs) {
    return new Date(nowMs).toISOString().slice(0, 10);
  }

  #recordAudit(type, payload) {
    this.executionAuditTrail.push({
      type,
      emittedAtMs: Date.now(),
      payload,
    });
  }

  #asFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
