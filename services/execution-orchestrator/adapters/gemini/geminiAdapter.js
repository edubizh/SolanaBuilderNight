const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_EXECUTION_MODE = "dry_run";
const DEFAULT_RISK_CAPS = Object.freeze({
  maxNotionalUsd: 250,
  maxDailyNotionalUsd: 2_500,
  maxSlippageBps: 75,
});

export class GeminiPredictionAdapter {
  /**
   * @param {object} config
   * @param {string} [config.baseUrl]
   * @param {typeof fetch} [config.fetchImpl]
   * @param {number} [config.timeoutMs]
   * @param {() => number} [config.now]
   * @param {(normalized: object, raw: object) => object} [config.normalizeMarketHook]
   * @param {(normalized: object, raw: object) => object} [config.normalizeQuoteHook]
   * @param {boolean} [config.requireAuthForQuote]
   * @param {"dry_run" | "guarded_live"} [config.executionMode]
   * @param {{maxNotionalUsd?: number, maxDailyNotionalUsd?: number, maxSlippageBps?: number}} [config.riskCaps]
   * @param {boolean} [config.allowLiveExecution]
   * @param {(payload: object, context: object) => Promise<object>} [config.executeOrderHook]
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl ?? "https://api.gemini.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = config.now ?? (() => Date.now());
    this.normalizeMarketHook = config.normalizeMarketHook ?? ((normalized) => normalized);
    this.normalizeQuoteHook = config.normalizeQuoteHook ?? ((normalized) => normalized);
    this.requireAuthForQuote = config.requireAuthForQuote ?? false;
    this.executionMode = config.executionMode ?? DEFAULT_EXECUTION_MODE;
    this.allowLiveExecution = config.allowLiveExecution ?? false;
    this.executeOrderHook = config.executeOrderHook ?? (async (payload) => this.#submitOrderLive(payload));
    this.riskCaps = {
      ...DEFAULT_RISK_CAPS,
      ...(config.riskCaps ?? {}),
    };
    this.approvalStore = new Map();
    this.dailyNotionalByBucket = new Map();
  }

  /**
   * @param {Record<string, string | number | boolean | undefined>} [params]
   */
  async getMarkets(params = {}) {
    const response = await this.#request("GET", "/v1/prediction/markets", { query: params });
    if (!Array.isArray(response?.markets)) {
      throw new Error("Gemini markets response must include markets array");
    }

    return response.markets.map((market) => this.normalizeMarket(market)).sort(this.#sortByMarketId);
  }

  /**
   * @param {Record<string, string | number | boolean | undefined>} params
   * @param {object} [options]
   * @param {object} [options.auth]
   */
  async getQuote(params, options = {}) {
    if (!params || typeof params !== "object") {
      throw new Error("Gemini quote request requires params object");
    }
    if (typeof params.marketId !== "string" || params.marketId.trim().length === 0) {
      throw new Error("Gemini quote request requires marketId");
    }

    const authSurface = this.buildAuthSurface(options.auth);
    if (this.requireAuthForQuote && !authSurface.hasCredentials) {
      throw new Error("Gemini quote requires auth credentials when requireAuthForQuote=true");
    }

    const response = await this.#request("GET", "/v1/prediction/quote", {
      query: params,
      headers: authSurface.headers,
    });
    return this.normalizeQuote(response);
  }

  async submitOrder(payload, context = {}) {
    if (!this.allowLiveExecution) {
      throw new Error("Gemini guarded-live execution disabled: allowLiveExecution=false");
    }
    return this.executeOrderHook(payload, context);
  }

  /**
   * @param {object} input
   * @param {string} input.intentId
   * @param {number | string} input.estimatedNotionalUsd
   * @param {number | string} [input.currentNetExposureUsd]
   * @param {number | string} [input.projectedNetExposureUsd]
   * @param {number | string} [input.hedgedExposureUsd]
   * @param {boolean} [input.reduceOnly]
   * @param {number | string} [input.slippageBps]
   * @param {object} [input.quote]
   * @param {object} [input.swapPayload]
   * @param {boolean} [input.live]
   * @param {string} [input.approvalId]
   */
  async executeGuardedOrder(input = {}) {
    const intentId = this.#asString(input.intentId);
    if (!intentId) {
      throw new Error("Gemini guarded execution requires intentId");
    }

    const mode = this.executionMode;
    const liveRequested = Boolean(input.live);
    const estimatedNotionalUsd = this.#toFiniteNumber(input.estimatedNotionalUsd);
    if (estimatedNotionalUsd === null || estimatedNotionalUsd <= 0) {
      throw new Error("Gemini guarded execution requires positive estimatedNotionalUsd");
    }

    const nowMs = this.now();
    const bucket = this.#dayBucket(nowMs);
    const dailyNotionalUsd = this.dailyNotionalByBucket.get(bucket) ?? 0;
    const projectedDailyNotionalUsd = dailyNotionalUsd + estimatedNotionalUsd;
    const assessment = this.#assessRisk({
      estimatedNotionalUsd,
      projectedDailyNotionalUsd,
      slippageBps: this.#toFiniteNumber(input.slippageBps),
      currentNetExposureUsd: this.#toFiniteNumber(input.currentNetExposureUsd) ?? 0,
      projectedNetExposureUsd: this.#toFiniteNumber(input.projectedNetExposureUsd) ?? 0,
      hedgedExposureUsd: this.#toFiniteNumber(input.hedgedExposureUsd) ?? 0,
      reduceOnly: Boolean(input.reduceOnly),
    });

    const quoteIntegrity = this.#checkQuoteIntegrity(input.quote);
    if (!quoteIntegrity.ok) {
      assessment.violations.push("QUOTE_INTEGRITY_FAILED");
      assessment.allowed = false;
    }

    const approval = this.#validateApproval({
      liveRequested,
      intentId,
      approvalId: input.approvalId,
      estimatedNotionalUsd,
      nowMs,
    });
    if (!approval.ok && approval.reason !== "NOT_REQUIRED") {
      assessment.violations.push(approval.reason);
      assessment.allowed = false;
    }

    if (liveRequested && mode !== "guarded_live") {
      assessment.violations.push("MODE_NOT_GUARDED_LIVE");
      assessment.allowed = false;
    }

    const liveExecuted = liveRequested && assessment.allowed;
    let submission = {
      executed: false,
      simulated: true,
      providerOrderId: null,
      idempotencyKey: this.#buildIdempotencyKey(intentId),
      deduplicated: false,
    };

    if (liveExecuted) {
      submission = {
        ...submission,
        ...(await this.submitOrder(input.swapPayload ?? {}, {
          intentId,
          approvalId: input.approvalId,
          idempotencyKey: submission.idempotencyKey,
        })),
        executed: true,
        simulated: false,
      };
      this.dailyNotionalByBucket.set(bucket, projectedDailyNotionalUsd);
      this.#consumeApproval(input.approvalId, nowMs);
    }

    const artifact = {
      artifactId: `gmn-guarded-${intentId}-${nowMs}`,
      generatedAtMs: nowMs,
      intentId,
      mode,
      liveRequested,
      liveExecuted,
      assessment,
      quoteIntegrity,
      approval: this.#approvalArtifact(input.approvalId),
      submission,
    };

    return {
      status: assessment.allowed ? (liveExecuted ? "executed" : "dry_run_eligible") : "rejected",
      artifact,
    };
  }

  /**
   * @param {object} request
   * @param {string} request.intentId
   * @param {number | string} request.approvedNotionalUsd
   * @param {string} request.approvedBy
   * @param {number} [request.ttlMs]
   */
  createApproval(request = {}) {
    const intentId = this.#asString(request.intentId);
    const approvedBy = this.#asString(request.approvedBy);
    const approvedNotionalUsd = this.#toFiniteNumber(request.approvedNotionalUsd);
    const ttlMs = this.#toFiniteNumber(request.ttlMs) ?? 300_000;
    if (!intentId || !approvedBy || approvedNotionalUsd === null || approvedNotionalUsd <= 0 || ttlMs <= 0) {
      throw new Error("Gemini approval requires intentId, approvedBy, approvedNotionalUsd, and positive ttlMs");
    }

    const nowMs = this.now();
    const approvalId = `gma-${intentId}-${nowMs}`;
    this.approvalStore.set(approvalId, {
      approvalId,
      intentId,
      approvedBy,
      approvedNotionalUsd,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      used: false,
      usedAtMs: null,
    });
    return { approvalId };
  }

  /**
   * @param {unknown} rawMarket
   */
  normalizeMarket(rawMarket) {
    if (!rawMarket || typeof rawMarket !== "object") {
      throw new Error("Gemini market payload must be an object");
    }

    const marketId = this.#asString(rawMarket.marketId ?? rawMarket.id);
    if (!marketId) {
      throw new Error("Gemini market payload missing marketId");
    }

    const normalized = {
      marketId,
      symbol: this.#asString(rawMarket.symbol) ?? marketId,
      status: this.#asString(rawMarket.status)?.toLowerCase() ?? "unknown",
      eventCode: this.#asString(rawMarket.eventCode ?? rawMarket.event_id),
      closeTimeMs: this.#toEpochMs(rawMarket.closeTimeMs ?? rawMarket.close_time_ms),
      outcomes: this.#normalizeOutcomes(rawMarket.outcomes),
    };

    return this.normalizeMarketHook(normalized, rawMarket);
  }

  /**
   * @param {unknown} rawQuote
   */
  normalizeQuote(rawQuote) {
    if (!rawQuote || typeof rawQuote !== "object") {
      throw new Error("Gemini quote payload must be an object");
    }

    const marketId = this.#asString(rawQuote.marketId ?? rawQuote.market_id);
    if (!marketId) {
      throw new Error("Gemini quote payload missing marketId");
    }

    const bid = this.#toFiniteNumber(rawQuote.bid);
    const ask = this.#toFiniteNumber(rawQuote.ask);
    if (bid === null || ask === null || bid > ask) {
      throw new Error("Gemini quote integrity violation: bid/ask invalid");
    }

    const normalized = {
      marketId,
      bid,
      ask,
      mid: Number(((bid + ask) / 2).toFixed(8)),
      timestampMs: this.#toEpochMs(rawQuote.timestampMs ?? rawQuote.timestamp_ms ?? this.now()),
      source: "gemini",
    };

    return this.normalizeQuoteHook(normalized, rawQuote);
  }

  /**
   * @param {unknown[]} markets
   */
  normalizeMarketSnapshot(markets) {
    if (!Array.isArray(markets)) {
      throw new Error("Gemini market snapshot requires markets array");
    }

    const normalizedMarkets = markets.map((market) => this.normalizeMarket(market)).sort(this.#sortByMarketId);
    return {
      source: "gemini",
      generatedAtMs: this.now(),
      markets: normalizedMarkets,
    };
  }

  /**
   * Stage A auth-surface scaffold only. This intentionally does not sign requests.
   * @param {object} [auth]
   */
  buildAuthSurface(auth = {}) {
    const apiKey = this.#asString(auth?.apiKey);
    const apiSecret = this.#asString(auth?.apiSecret);
    const passphrase = this.#asString(auth?.passphrase);
    const accountId = this.#asString(auth?.accountId);

    const headers = {};
    if (apiKey) {
      headers["x-gemini-api-key"] = apiKey;
    }
    if (accountId) {
      headers["x-gemini-account"] = accountId;
    }

    return {
      hasCredentials: Boolean(apiKey && apiSecret),
      signed: false,
      passphraseProvided: Boolean(passphrase),
      headers,
    };
  }

  async #request(method, path, options = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text.length > 0 ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`Gemini ${method} ${path} failed (${response.status})`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  #normalizeOutcomes(outcomes) {
    if (!Array.isArray(outcomes)) {
      return [];
    }

    return outcomes
      .map((outcome) => ({
        outcomeId: this.#asString(outcome?.outcomeId ?? outcome?.id),
        label: this.#asString(outcome?.label ?? outcome?.name) ?? "unknown",
      }))
      .filter((outcome) => outcome.outcomeId)
      .sort((left, right) => left.outcomeId.localeCompare(right.outcomeId));
  }

  #sortByMarketId(left, right) {
    return left.marketId.localeCompare(right.marketId);
  }

  #asString(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  #toEpochMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.trunc(numeric);
      }
    }
    return null;
  }

  #toFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return null;
  }

  async #submitOrderLive(payload) {
    return this.#request("POST", "/v1/prediction/orders", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  #dayBucket(epochMs) {
    return new Date(epochMs).toISOString().slice(0, 10);
  }

  #buildIdempotencyKey(intentId) {
    return `gmn-${intentId}`;
  }

  #checkQuoteIntegrity(quote) {
    if (!quote || typeof quote !== "object") {
      return { ok: false, reason: "MISSING_QUOTE" };
    }
    const bid = this.#toFiniteNumber(quote.bid);
    const ask = this.#toFiniteNumber(quote.ask);
    return { ok: bid !== null && ask !== null && bid <= ask, reason: bid !== null && ask !== null && bid <= ask ? null : "BID_ASK_INVALID" };
  }

  #assessRisk(input) {
    const violations = [];
    if (input.estimatedNotionalUsd > this.riskCaps.maxNotionalUsd) {
      violations.push("MAX_NOTIONAL_EXCEEDED");
    }
    if (input.projectedDailyNotionalUsd > this.riskCaps.maxDailyNotionalUsd) {
      violations.push("MAX_DAILY_NOTIONAL_EXCEEDED");
    }
    if (input.slippageBps !== null && input.slippageBps > this.riskCaps.maxSlippageBps) {
      violations.push("MAX_SLIPPAGE_EXCEEDED");
    }
    if (!this.#passesNoNakedExposure(input)) {
      violations.push("NAKED_EXPOSURE_FORBIDDEN");
    }

    return {
      allowed: violations.length === 0,
      violations,
      caps: {
        maxNotionalUsd: this.riskCaps.maxNotionalUsd,
        maxDailyNotionalUsd: this.riskCaps.maxDailyNotionalUsd,
        maxSlippageBps: this.riskCaps.maxSlippageBps,
      },
      observed: {
        estimatedNotionalUsd: input.estimatedNotionalUsd,
        projectedDailyNotionalUsd: input.projectedDailyNotionalUsd,
        slippageBps: input.slippageBps,
      },
    };
  }

  #passesNoNakedExposure(input) {
    if (input.reduceOnly) {
      return true;
    }
    if (Math.abs(input.projectedNetExposureUsd) < Math.abs(input.currentNetExposureUsd)) {
      return true;
    }
    return input.hedgedExposureUsd >= Math.abs(input.projectedNetExposureUsd);
  }

  #validateApproval({ liveRequested, intentId, approvalId, estimatedNotionalUsd, nowMs }) {
    if (!liveRequested) {
      return { ok: true, reason: "NOT_REQUIRED" };
    }
    const id = this.#asString(approvalId);
    if (!id) {
      return { ok: false, reason: "APPROVAL_REQUIRED" };
    }
    const approval = this.approvalStore.get(id);
    if (!approval) {
      return { ok: false, reason: "APPROVAL_NOT_FOUND" };
    }
    if (approval.used) {
      return { ok: false, reason: "APPROVAL_ALREADY_USED" };
    }
    if (approval.intentId !== intentId) {
      return { ok: false, reason: "APPROVAL_INTENT_MISMATCH" };
    }
    if (approval.expiresAtMs < nowMs) {
      return { ok: false, reason: "APPROVAL_EXPIRED" };
    }
    if (estimatedNotionalUsd > approval.approvedNotionalUsd) {
      return { ok: false, reason: "APPROVAL_NOTIONAL_EXCEEDED" };
    }
    return { ok: true, reason: null };
  }

  #consumeApproval(approvalId, usedAtMs) {
    const id = this.#asString(approvalId);
    if (!id) {
      return;
    }
    const approval = this.approvalStore.get(id);
    if (!approval) {
      return;
    }
    approval.used = true;
    approval.usedAtMs = usedAtMs;
    this.approvalStore.set(id, approval);
  }

  #approvalArtifact(approvalId) {
    const id = this.#asString(approvalId);
    if (!id) {
      return { required: false, approvalId: null };
    }
    const approval = this.approvalStore.get(id);
    if (!approval) {
      return { required: true, approvalId: id, found: false };
    }
    return {
      required: true,
      approvalId: approval.approvalId,
      intentId: approval.intentId,
      approvedBy: approval.approvedBy,
      approvedNotionalUsd: approval.approvedNotionalUsd,
      expiresAtMs: approval.expiresAtMs,
      used: approval.used,
      usedAtMs: approval.usedAtMs,
    };
  }
}
