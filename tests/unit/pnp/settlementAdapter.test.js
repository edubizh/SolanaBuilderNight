import test from "node:test";
import assert from "node:assert/strict";
import { PnpSettlementAdapter } from "../../../services/position-settlement-service/adapters/pnp/settlementAdapter.js";

test("settlement lifecycle transitions pending -> settled -> redeemed", async () => {
  const adapter = new PnpSettlementAdapter({ now: () => 1713700000000 });

  const pending = await adapter.buildSettlementRecord({
    intentId: "intent-100",
    marketId: "pnp-sol-usdc-v2",
    orderId: "order-100",
  });
  assert.equal(pending.status, "settlement_pending");
  assert.equal(pending.settlementId, "settlement-intent-100");

  const settled = await adapter.markSettled({
    settlementRecord: pending,
    settlementTxId: "settle-tx-100",
    settledAtMs: 1713700005000,
  });
  assert.equal(settled.status, "settled");
  assert.equal(settled.settlementTxId, "settle-tx-100");

  const redeemed = await adapter.markRedeemed({
    settlementRecord: settled,
    redemptionTxId: "redeem-tx-100",
    redeemedAtMs: 1713700009000,
  });
  assert.equal(redeemed.status, "redeemed");
  assert.equal(redeemed.redemptionTxId, "redeem-tx-100");
});

test("markRedeemed requires settled status", async () => {
  const adapter = new PnpSettlementAdapter({ now: () => 1713700000000 });
  const pending = await adapter.buildSettlementRecord({
    intentId: "intent-101",
    marketId: "pnp-sol-usdc-v2",
    orderId: "order-101",
  });

  await assert.rejects(
    () => adapter.markRedeemed({ settlementRecord: pending, redemptionTxId: "redeem-tx-101" }),
    /requires settlement in settled status/,
  );
});

test("checkSettlementEligibility returns eligible for valid pending record", async () => {
  const adapter = new PnpSettlementAdapter({ now: () => 1713700000000 });
  const pending = await adapter.buildSettlementRecord({
    intentId: "intent-elig",
    marketId: "m1",
    orderId: "o1",
  });
  const { eligible, reason } = adapter.checkSettlementEligibility({
    settlementRecord: pending,
    nowMs: 1713700000000,
  });
  assert.equal(eligible, true);
  assert.equal(reason, null);
});

test("checkSettlementEligibility rejects non-pending status", async () => {
  const adapter = new PnpSettlementAdapter({ now: () => 1713700000000 });
  const { eligible, reason } = adapter.checkSettlementEligibility({
    settlementRecord: { status: "settled", settlementId: "s", intentId: "i", marketId: "m", orderId: "o" },
    nowMs: 1,
  });
  assert.equal(eligible, false);
  assert.ok(String(reason).includes("settlement_pending"));
});

test("buildRedemptionRecord returns redeemed copy without mutating input", async () => {
  const adapter = new PnpSettlementAdapter({ now: () => 1713700000000 });
  const pending = await adapter.buildSettlementRecord({
    intentId: "intent-br",
    marketId: "m1",
    orderId: "o1",
  });
  const settled = await adapter.markSettled({
    settlementRecord: pending,
    settlementTxId: "stx-1",
    settledAtMs: 1713700001000,
  });
  const redeemed = await adapter.buildRedemptionRecord({
    settlementRecord: settled,
    redemptionTxId: "rtx-1",
    redeemedAtMs: 1713700002000,
  });
  assert.equal(redeemed.status, "redeemed");
  assert.equal(settled.status, "settled");
  assert.equal(redeemed.redemptionTxId, "rtx-1");
});
