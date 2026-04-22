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
