import test from "node:test";
import assert from "node:assert/strict";
import { createConsoleShell, consoleRoutes } from "../../../apps/frontend-console/src/lib/dashboard-shell.ts";
import { connectAndSignForOperator, createOperatorChallenge } from "../../../apps/frontend-console/src/lib/operator-auth.ts";
import { createAuthorizedActionRequest } from "../../../apps/frontend-console/src/lib/operator-controls.ts";
import { createDashboardSnapshot } from "../../../apps/frontend-console/src/lib/live-dashboard.ts";
import { buildConfigApprovalTimeline } from "../../../apps/frontend-console/src/lib/config-approvals.ts";
import { resolveEntitlementState } from "../../../apps/frontend-console/src/lib/commerce-entitlements.ts";

test("console scaffold exposes required route groups", () => {
  const shell = createConsoleShell();

  assert.equal(shell.appName, "Solana Opportunity Console");
  assert.equal(consoleRoutes.length, 6);
  assert.ok(consoleRoutes.every((route) => route.requiresAuth === true));
});

test("phantom connect and sign returns operator session payload", async () => {
  const provider = {
    isPhantom: true,
    async connect() {
      return {
        publicKey: {
          toString: () => "wallet_operator_1"
        }
      };
    },
    async signMessage(message) {
      return {
        signature: message
      };
    }
  };

  const session = await connectAndSignForOperator(provider, "pause", 1234);
  assert.equal(session.walletAddress, "wallet_operator_1");
  assert.equal(session.role, "operator");
  assert.equal(session.challenge, createOperatorChallenge("wallet_operator_1", "pause", 1234));
  assert.ok(session.signature.length > 0);
});

test("frontend control helper creates action-specific signed payload", async () => {
  const provider = {
    isPhantom: true,
    async connect() {
      return {
        publicKey: {
          toString: () => "wallet_operator_2"
        }
      };
    },
    async signMessage(message) {
      return {
        signature: message
      };
    }
  };

  const request = await createAuthorizedActionRequest(provider, "kill_switch", 4567);
  assert.equal(request.action, "kill_switch");
  assert.equal(request.actorWallet, "wallet_operator_2");
  assert.equal(request.authorization?.challenge, createOperatorChallenge("wallet_operator_2", "kill_switch", 4567));
});

test("dashboard snapshot calculates live totals for opportunity/position/risk views", () => {
  const snapshot = createDashboardSnapshot({
    generatedAtMs: 10_000,
    opportunities: [
      {
        intentId: "intent_b",
        market: "SOL-USD",
        venue: "pnp",
        edgeNetBps: 120,
        expectedValueUsd: 12.25,
        direction: "long",
        status: "new",
        updatedAtMs: 9_000
      },
      {
        intentId: "intent_a",
        market: "SOL-USD",
        venue: "dflow",
        edgeNetBps: 240,
        expectedValueUsd: 18.9,
        direction: "short",
        status: "executing",
        updatedAtMs: 9_500
      }
    ],
    positions: [
      {
        positionId: "pos_1",
        market: "SOL-USD",
        venue: "dflow",
        side: "buy",
        notionalUsd: 100,
        unrealizedPnlUsd: 5.5,
        status: "open",
        updatedAtMs: 9_200
      },
      {
        positionId: "pos_2",
        market: "BTC-USD",
        venue: "pnp",
        side: "sell",
        notionalUsd: 40,
        unrealizedPnlUsd: -1.25,
        status: "closing",
        updatedAtMs: 9_400
      }
    ],
    riskSignals: [
      {
        signalId: "risk_1",
        category: "drawdown",
        severity: "critical",
        message: "drawdown threshold breached",
        triggeredAtMs: 9_300
      }
    ]
  });

  assert.equal(snapshot.opportunities[0].intentId, "intent_a");
  assert.equal(snapshot.totals.openPositions, 1);
  assert.equal(snapshot.totals.grossExposureUsd, 140);
  assert.equal(snapshot.totals.netUnrealizedPnlUsd, 4.25);
  assert.equal(snapshot.totals.criticalRiskSignals, 1);
});

test("config approval timeline and commerce entitlement verification stay deterministic", () => {
  const timeline = buildConfigApprovalTimeline({
    request: {
      changeId: "cfg_1",
      configArea: "risk",
      requestedBy: "wallet_ops",
      reason: "tighten drawdown policy",
      requestedAtMs: 1_000,
      proposedVersion: "risk-v2"
    },
    approvals: [
      {
        changeId: "cfg_1",
        reviewerWallet: "wallet_reviewer_a",
        decision: "approved",
        decidedAtMs: 1_500
      },
      {
        changeId: "cfg_1",
        reviewerWallet: "wallet_reviewer_b",
        decision: "approved",
        decidedAtMs: 2_000
      }
    ],
    events: [
      {
        eventId: "evt_2",
        changeId: "cfg_1",
        actor: "wallet_reviewer_b",
        action: "approval_recorded",
        recordedAtMs: 2_000,
        details: "approved by reviewer b"
      },
      {
        eventId: "evt_1",
        changeId: "cfg_1",
        actor: "wallet_ops",
        action: "request_created",
        recordedAtMs: 1_000,
        details: "request opened"
      }
    ]
  });
  const entitlement = resolveEntitlementState({
    hook: {
      paymentReference: "pay_1",
      billingWallet: "wallet_bill",
      plan: "operator_pro",
      amountUsd: 299,
      initiatedAtMs: 10_000
    },
    verification: {
      paymentReference: "pay_1",
      transactionSignature: "sig_abc",
      verifiedAtMs: 10_500,
      status: "confirmed"
    }
  });

  assert.equal(timeline.status, "approved");
  assert.equal(timeline.approvalsRemaining, 0);
  assert.equal(timeline.events[0].eventId, "evt_1");
  assert.equal(entitlement.active, true);
  assert.equal(entitlement.plan, "operator_pro");
});
