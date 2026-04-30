export class PnpSettlementAdapter {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
  }

  async buildSettlementRecord({ intentId, marketId, orderId, positionId }) {
    this.#validateRequiredString(intentId, "intentId");
    this.#validateRequiredString(marketId, "marketId");
    this.#validateRequiredString(orderId, "orderId");

    const createdAtMs = this.now();
    return {
      settlementId: `settlement-${intentId}`,
      intentId,
      positionId: positionId ?? `position-${intentId}`,
      marketId,
      orderId,
      status: "settlement_pending",
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
  }

  async markSettled({ settlementRecord, settledAtMs = this.now(), settlementTxId }) {
    this.#validateSettlementRecord(settlementRecord);
    this.#validateRequiredString(settlementTxId, "settlementTxId");
    if (settlementRecord.status !== "settlement_pending") {
      throw new Error("PNP settlement can only move to settled from settlement_pending");
    }

    return {
      ...settlementRecord,
      status: "settled",
      settledAtMs,
      settlementTxId,
      updatedAtMs: settledAtMs,
    };
  }

  async markRedeemed({ settlementRecord, redemptionTxId, redeemedAtMs = this.now() }) {
    this.#validateSettlementRecord(settlementRecord);
    this.#validateRequiredString(redemptionTxId, "redemptionTxId");
    if (settlementRecord.status !== "settled") {
      throw new Error("PNP redemption requires settlement in settled status");
    }

    return {
      ...settlementRecord,
      status: "redeemed",
      redemptionTxId,
      redeemedAtMs,
      updatedAtMs: redeemedAtMs,
    };
  }

  checkSettlementEligibility({ settlementRecord, nowMs }) {
    if (!settlementRecord || typeof settlementRecord !== "object") {
      return { eligible: false, reason: "missing settlementRecord" };
    }
    if (settlementRecord.status !== "settlement_pending") {
      return { eligible: false, reason: "settlement must be in settlement_pending status" };
    }
    const required = [
      ["settlementId", settlementRecord.settlementId],
      ["intentId", settlementRecord.intentId],
      ["marketId", settlementRecord.marketId],
      ["orderId", settlementRecord.orderId],
    ];
    for (const [field, value] of required) {
      if (!value || typeof value !== "string") {
        return { eligible: false, reason: `missing required field: ${field}` };
      }
    }
    if (nowMs !== undefined && (!Number.isFinite(nowMs) || nowMs < 0)) {
      return { eligible: false, reason: "invalid nowMs" };
    }
    return { eligible: true, reason: null };
  }

  /**
   * Builds a redeemed settlement record without mutating the input (evidence path).
   * @param {{ settlementRecord: object, redemptionTxId: string, redeemedAtMs?: number }} input
   */
  async buildRedemptionRecord({ settlementRecord, redemptionTxId, redeemedAtMs }) {
    const atMs = redeemedAtMs ?? this.now();
    this.#validateSettlementRecord(settlementRecord);
    this.#validateRequiredString(redemptionTxId, "redemptionTxId");
    if (settlementRecord.status !== "settled") {
      throw new Error("PNP redemption requires settlement in settled status");
    }
    return {
      ...settlementRecord,
      status: "redeemed",
      redemptionTxId,
      redeemedAtMs: atMs,
      updatedAtMs: atMs,
    };
  }

  #validateSettlementRecord(settlementRecord) {
    if (!settlementRecord || typeof settlementRecord !== "object") {
      throw new Error("PNP settlement requires settlementRecord payload");
    }
    this.#validateRequiredString(settlementRecord.settlementId, "settlementRecord.settlementId");
    this.#validateRequiredString(settlementRecord.intentId, "settlementRecord.intentId");
    this.#validateRequiredString(settlementRecord.marketId, "settlementRecord.marketId");
    this.#validateRequiredString(settlementRecord.orderId, "settlementRecord.orderId");
    this.#validateRequiredString(settlementRecord.status, "settlementRecord.status");
  }

  #validateRequiredString(value, fieldName) {
    if (!value || typeof value !== "string") {
      throw new Error(`PNP settlement requires ${fieldName}`);
    }
  }
}
