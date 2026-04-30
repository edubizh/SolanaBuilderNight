const DEFAULT_GUARD = {
  enabled: true,
  mode: "dry_run",
  maxNotionalUsd: 250,
  maxDailyNotionalUsd: 2500,
  maxSlippageBps: 75,
  approvalTtlMs: 15 * 60_000,
  enforceNoNakedExposure: true,
};

export class PnpGuardedAdapter {
  /**
   * @param {object} config
   * @param {import("./executionAdapter.js").PnpExecutionAdapter} config.executionAdapter
   * @param {"dry_run" | "guarded_live"} [config.mode]
   * @param {Partial<typeof DEFAULT_GUARD>} [config.guardrails]
   * @param {Map<string, object>} [config.approvalStore]
   * @param {object[]} [config.executionAuditTrail]
   * @param {Map<string, number>} [config.dailyNotionalLedger]
   * @param {() => number} [config.now]
   */
  constructor({
    executionAdapter,
    mode,
    guardrails,
    approvalStore = new Map(),
    executionAuditTrail = [],
    dailyNotionalLedger = new Map(),
    now = () => Date.now(),
  }) {
    if (!executionAdapter) {
      throw new Error("PnpGuardedAdapter requires executionAdapter");
    }
    this.executionAdapter = executionAdapter;
    this.now = now;
    const merged = { ...DEFAULT_GUARD, ...(guardrails ?? {}) };
    merged.mode = mode ?? guardrails?.mode ?? DEFAULT_GUARD.mode;
    this.guardrailConfig = merged;
    this.approvalStore = approvalStore;
    this.executionAuditTrail = executionAuditTrail;
    this.dailyNotionalLedger = dailyNotionalLedger;
  }

  createGuardedLiveApproval(request) {
    const intentId = this.#asNonEmptyString(request?.intentId);
    const approvedBy = this.#asNonEmptyString(request?.approvedBy);
    const estimatedNotionalUsd = this.#asFiniteNumber(request?.estimatedNotionalUsd);
    if (!intentId || !approvedBy || estimatedNotionalUsd === null) {
      throw new Error("Guarded-live approval requires intentId, approvedBy, and estimatedNotionalUsd");
    }

    const approvedAtMs = Number.isFinite(request?.approvedAtMs) ? Number(request.approvedAtMs) : this.now();
    const expiresAtMs = Number.isFinite(request?.expiresAtMs)
      ? Number(request.expiresAtMs)
      : approvedAtMs + this.guardrailConfig.approvalTtlMs;
    const approvalId =
      this.#asNonEmptyString(request?.approvalId) ?? `pnp-approval-${intentId}-${approvedAtMs}`;

    const approval = {
      approvalId,
      intentId,
      estimatedNotionalUsd,
      approvedBy,
      approvedAtMs,
      expiresAtMs,
      createdAtMs: this.now(),
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

  assessGuardedLiveRisk(request, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : this.now();
    const intentId = this.#asNonEmptyString(request?.intentId) ?? "unknown-intent";
    const estimatedNotionalUsd = this.#asFiniteNumber(request?.riskContext?.estimatedNotionalUsd);
    const currentNetExposureUsd = this.#asFiniteNumber(request?.riskContext?.currentNetExposureUsd);
    const projectedNetExposureUsd = this.#asFiniteNumber(request?.riskContext?.projectedNetExposureUsd);
    const hedgedExposureUsd = this.#asFiniteNumber(request?.riskContext?.hedgedExposureUsd) ?? 0;
    const reduceOnly = request?.riskContext?.reduceOnly === true;
    const orderSlippageBps = this.#asFiniteNumber(request?.orderRequest?.maxSlippageBps);
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
    if (
      estimatedNotionalUsd !== null &&
      dailyUsed + estimatedNotionalUsd > this.guardrailConfig.maxDailyNotionalUsd
    ) {
      violations.push(
        `daily notional cap breach (${dailyUsed + estimatedNotionalUsd} > ${this.guardrailConfig.maxDailyNotionalUsd} USD)`,
      );
    }

    if (orderSlippageBps !== null && orderSlippageBps > this.guardrailConfig.maxSlippageBps) {
      violations.push(`slippage cap breach (${orderSlippageBps}bps > ${this.guardrailConfig.maxSlippageBps}bps)`);
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
        orderSlippageBps,
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

  async executeGuardedLiveTrade(request, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : this.now();
    const mode = this.guardrailConfig.mode;
    const runLive = options.live === true && mode === "guarded_live";
    const assessment = this.assessGuardedLiveRisk(request, { nowMs });
    const intentId = assessment.intentId;
    const artifact = {
      artifactId: `pnp-guarded-${intentId}-${nowMs}`,
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

    const approvalPeek = this.#consumeValidApproval({
      approvalId: options.approvalId,
      intentId: assessment.intentId,
      estimatedNotionalUsd: assessment.risk.estimatedNotionalUsd,
      nowMs,
      consume: false,
    });
    artifact.approval = approvalPeek;

    const quoteParams = request.quoteParams ?? request.orderRequest;
    const quoteEval = await this.executionAdapter.evaluateGuardedLiveQuote(quoteParams);

    if (quoteEval.quoteFetchFailed) {
      artifact.assessment.allowed = false;
      artifact.assessment.violations.push("quote fetch failed before live submission");
      artifact.quoteIntegrity = {
        ok: false,
        errors: quoteEval.quoteIntegrity.errors,
        warnings: quoteEval.quoteIntegrity.warnings ?? [],
      };
      this.#recordAudit("guarded_rejected_quote_fetch_error", artifact);
      return artifact;
    }

    artifact.quoteIntegrity = {
      ok: quoteEval.quoteIntegrity.ok,
      errors: quoteEval.quoteIntegrity.errors,
      warnings: quoteEval.quoteIntegrity.warnings ?? [],
      quote: quoteEval.quote ?? undefined,
    };

    if (!quoteEval.quoteIntegrity.ok) {
      artifact.assessment.allowed = false;
      artifact.assessment.violations.push("quote integrity failed");
      this.#recordAudit("guarded_rejected_quote_integrity", artifact);
      return artifact;
    }

    artifact.approval = this.#consumeValidApproval({
      approvalId: options.approvalId,
      intentId: assessment.intentId,
      estimatedNotionalUsd: assessment.risk.estimatedNotionalUsd,
      nowMs,
      consume: true,
    });

    try {
      const orderPayload = {
        ...(request.orderRequest ?? {}),
        intentId: request.orderRequest?.intentId ?? request.intentId,
      };
      const result = await this.executionAdapter.executeOrder(orderPayload);
      artifact.liveExecuted = true;
      artifact.submission = result;
      this.#incrementDailyNotionalLedger(assessment.risk.estimatedNotionalUsd, nowMs);
      this.#recordAudit("guarded_live_executed", artifact);
    } catch (error) {
      artifact.liveExecuted = false;
      artifact.assessment.allowed = false;
      artifact.assessment.violations.push("order submission failed after approval consumption");
      artifact.submission = {
        ok: false,
        error: error?.message ?? "unknown submission error",
      };
      this.#recordAudit("guarded_rejected_submission_error", artifact);
    }

    return artifact;
  }

  listGuardedExecutionAuditTrail() {
    return [...this.executionAuditTrail];
  }

  #recordAudit(type, payload) {
    this.executionAuditTrail.push({
      type,
      emittedAtMs: this.now(),
      payload,
    });
  }

  #consumeValidApproval({ approvalId, intentId, estimatedNotionalUsd, nowMs, consume = true }) {
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

    if (!consume) {
      return { ...approval };
    }

    const consumed = { ...approval, used: true, usedAtMs: nowMs };
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

  #asNonEmptyString(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  #asFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
