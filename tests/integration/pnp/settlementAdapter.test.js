import test from "node:test";
import assert from "node:assert/strict";
import { PnpSettlementAdapter } from "../../../services/position-settlement-service/adapters/pnp/settlementAdapter.js";

test("settlement lifecycle handles pending, settled, and redeemed states", async () => {
  const adapter = new PnpSettlementAdapter({ now: () => 1713700000000 });

  const pending = await adapter.buildSettlementRecord({
    intentId: "intent-42",
    marketId: "pnp-sol-usdc-v2",
    orderId: "order-42",
  });
  assert.equal(pending.status, "settlement_pending");
  assert.equal(pending.createdAtMs, 1713700000000);

  const settled = await adapter.markSettled({
    settlementRecord: pending,
    settlementTxId: "settle-tx-42",
    settledAtMs: 1713700006000,
  });
  assert.equal(settled.status, "settled");
  assert.equal(settled.settlementTxId, "settle-tx-42");

  const redeemed = await adapter.markRedeemed({
    settlementRecord: settled,
    redemptionTxId: "redeem-tx-42",
    redeemedAtMs: 1713700009000,
  });
  assert.equal(redeemed.status, "redeemed");
  assert.equal(redeemed.redeemedAtMs, 1713700009000);
});
