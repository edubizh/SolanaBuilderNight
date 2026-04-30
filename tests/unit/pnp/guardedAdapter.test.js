import test from "node:test";
import assert from "node:assert/strict";
import { PnpGuardedAdapter } from "../../../services/execution-orchestrator/adapters/pnp/guardedAdapter.js";
import { PnpExecutionAdapter } from "../../../services/execution-orchestrator/adapters/pnp/executionAdapter.js";

const FIXED_NOW = 1_720_000_000_000;

function baseRisk(overrides = {}) {
  return {
    estimatedNotionalUsd: 50,
    currentNetExposureUsd: 10,
    projectedNetExposureUsd: 10,
    hedgedExposureUsd: 200,
    ...overrides,
  };
}

test("createGuardedLiveApproval stores approval with TTL from guardrailConfig", () => {
  const store = new Map();
  const trail = [];
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    mode: "dry_run",
    guardrails: { approvalTtlMs: 120_000 },
    approvalStore: store,
    executionAuditTrail: trail,
    now: () => FIXED_NOW,
  });

  const approval = adapter.createGuardedLiveApproval({
    intentId: "intent-a",
    estimatedNotionalUsd: 40,
    approvedBy: "operator-1",
    approvedAtMs: FIXED_NOW,
  });

  assert.equal(approval.expiresAtMs, FIXED_NOW + 120_000);
  assert.equal(store.size, 1);
  assert.equal(trail[0].type, "approval_created");
  assert.equal(approval.used, false);
});

test("createGuardedLiveApproval throws when intentId is missing", () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    now: () => FIXED_NOW,
  });

  assert.throws(
    () =>
      adapter.createGuardedLiveApproval({
        intentId: "",
        estimatedNotionalUsd: 1,
        approvedBy: "op",
      }),
    /intentId/,
  );
});

test("assessGuardedLiveRisk clean request returns allowed true", () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    guardrails: { enforceNoNakedExposure: false },
    now: () => FIXED_NOW,
  });

  const assessment = adapter.assessGuardedLiveRisk({
    intentId: "i-clean",
    orderRequest: { marketId: "m1", side: "buy", size: 1, maxSlippageBps: 50 },
    riskContext: { estimatedNotionalUsd: 50 },
  });

  assert.equal(assessment.allowed, true);
  assert.deepEqual(assessment.violations, []);
});

test("assessGuardedLiveRisk notional cap breach uses exact message", () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    now: () => FIXED_NOW,
  });

  const assessment = adapter.assessGuardedLiveRisk({
    intentId: "i-big",
    orderRequest: { marketId: "m1", side: "buy", size: 1 },
    riskContext: { estimatedNotionalUsd: 300, ...baseRisk({ estimatedNotionalUsd: 300 }) },
  });

  assert.equal(assessment.allowed, false);
  assert.ok(
    assessment.violations.some((v) => v === "notional cap breach (300 > 250 USD per trade)"),
  );
});

test("assessGuardedLiveRisk daily cumulative cap breach after ledger use", () => {
  const ledger = new Map();
  ledger.set(new Date(FIXED_NOW).toISOString().slice(0, 10), 2490);
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    dailyNotionalLedger: ledger,
    now: () => FIXED_NOW,
  });

  const assessment = adapter.assessGuardedLiveRisk({
    intentId: "i-daily",
    orderRequest: { marketId: "m1", side: "buy", size: 1 },
    riskContext: baseRisk({ estimatedNotionalUsd: 20 }),
  });

  assert.equal(assessment.allowed, false);
  assert.ok(
    assessment.violations.some((v) => v === "daily notional cap breach (2510 > 2500 USD)"),
  );
});

test("assessGuardedLiveRisk slippage cap breach", () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    now: () => FIXED_NOW,
  });

  const assessment = adapter.assessGuardedLiveRisk({
    intentId: "i-slip",
    orderRequest: { marketId: "m1", side: "buy", size: 1, maxSlippageBps: 100 },
    riskContext: baseRisk(),
  });

  assert.equal(assessment.allowed, false);
  assert.ok(assessment.violations.some((v) => v === "slippage cap breach (100bps > 75bps)"));
});

test("assessGuardedLiveRisk no-naked-exposure when exposure grows without hedge", () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    now: () => FIXED_NOW,
  });

  const assessment = adapter.assessGuardedLiveRisk({
    intentId: "i-naked",
    orderRequest: { marketId: "m1", side: "buy", size: 1 },
    riskContext: {
      estimatedNotionalUsd: 50,
      currentNetExposureUsd: 10,
      projectedNetExposureUsd: 500,
      hedgedExposureUsd: 0,
      reduceOnly: false,
    },
  });

  assert.equal(assessment.allowed, false);
  assert.ok(
    assessment.violations.some((v) =>
      v.includes("no-naked-exposure guard failed (position increases without sufficient hedge)"),
    ),
  );
});

test("executeGuardedLiveTrade dry-run returns liveExecuted false with allowed assessment", async () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    mode: "dry_run",
    now: () => FIXED_NOW,
  });

  const artifact = await adapter.executeGuardedLiveTrade(
    {
      intentId: "i-dry",
      orderRequest: { marketId: "m1", side: "buy", size: 1, maxSlippageBps: 50 },
      riskContext: baseRisk(),
    },
    { live: false, nowMs: FIXED_NOW },
  );

  assert.equal(artifact.liveExecuted, false);
  assert.equal(artifact.assessment.allowed, true);
  assert.equal(artifact.submission, null);
  assert.ok(adapter.listGuardedExecutionAuditTrail().some((e) => e.type === "guarded_dry_run"));
});

test("executeGuardedLiveTrade rejected on notional cap records guarded_rejected", async () => {
  const adapter = new PnpGuardedAdapter({
    executionAdapter: new PnpExecutionAdapter({ now: () => FIXED_NOW }),
    now: () => FIXED_NOW,
  });

  const artifact = await adapter.executeGuardedLiveTrade(
    {
      intentId: "i-rej",
      orderRequest: { marketId: "m1", side: "buy", size: 1 },
      riskContext: baseRisk({ estimatedNotionalUsd: 400, currentNetExposureUsd: 0, projectedNetExposureUsd: 0, hedgedExposureUsd: 500 }),
    },
    { nowMs: FIXED_NOW },
  );

  assert.equal(artifact.assessment.allowed, false);
  assert.equal(artifact.submission, null);
  assert.ok(adapter.listGuardedExecutionAuditTrail().some((e) => e.type === "guarded_rejected"));
});

test("executeGuardedLiveTrade guarded_live with approval and mocks executes live path", async () => {
  const store = new Map();
  const trail = [];
  const executionAdapter = {
    async evaluateGuardedLiveQuote() {
      return {
        quoteFetchFailed: false,
        quote: { marketId: "m1", size: 1, price: 1, sourceTimestampMs: FIXED_NOW },
        quoteIntegrity: { ok: true, errors: [], warnings: [] },
      };
    },
    async executeOrder(payload) {
      return { ...payload, orderId: "ord-1", status: "submitted", acceptedAtMs: FIXED_NOW };
    },
  };

  const adapter = new PnpGuardedAdapter({
    executionAdapter,
    mode: "guarded_live",
    guardrails: { mode: "guarded_live", enforceNoNakedExposure: false },
    approvalStore: store,
    executionAuditTrail: trail,
    now: () => FIXED_NOW,
  });

  const approval = adapter.createGuardedLiveApproval({
    intentId: "live-1",
    estimatedNotionalUsd: 80,
    approvedBy: "operator",
    approvedAtMs: FIXED_NOW,
  });

  const artifact = await adapter.executeGuardedLiveTrade(
    {
      intentId: "live-1",
      orderRequest: { marketId: "m1", side: "buy", size: 1, maxSlippageBps: 50 },
      riskContext: { estimatedNotionalUsd: 50 },
    },
    { live: true, approvalId: approval.approvalId, nowMs: FIXED_NOW },
  );

  assert.equal(artifact.liveExecuted, true);
  assert.equal(artifact.submission.orderId, "ord-1");
  assert.ok(trail.some((e) => e.type === "guarded_live_executed"));
});
