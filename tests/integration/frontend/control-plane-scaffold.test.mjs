import test from "node:test";
import assert from "node:assert/strict";
import { createServerDescriptor } from "../../../services/control-plane-api/src/server.ts";
import { evaluateActionRequest } from "../../../services/control-plane-api/src/routes/control-actions.ts";
import { getLiveDashboardResponse } from "../../../services/control-plane-api/src/routes/live-dashboard.ts";
import { getConfigApprovalResponse } from "../../../services/control-plane-api/src/routes/config-approvals.ts";
import { getCommerceVerificationResponse } from "../../../services/control-plane-api/src/routes/commerce-hooks.ts";
import { connectAndSignForOperator, createOperatorChallenge } from "../../../apps/frontend-console/src/lib/operator-auth.ts";

test("control-plane scaffold publishes health and control routes", () => {
  const descriptor = createServerDescriptor();

  assert.equal(descriptor.service, "control-plane-api");
  assert.equal(descriptor.routes.health, "/health");
  assert.equal(descriptor.routes.controls, "/v1/controls/actions");
  assert.equal(descriptor.routes.liveDashboard, "/v1/dashboard/live");
  assert.equal(descriptor.routes.configApprovals, "/v1/config/approvals");
  assert.equal(descriptor.routes.commerceHooks, "/v1/commerce/verify");
});

test("control actions always require authorization in scaffold", () => {
  const accepted = evaluateActionRequest({
    action: "pause",
    actorWallet: "wallet_abc",
    requestedAtMs: 1_000,
    authorization: {
      wallet: "wallet_abc",
      role: "operator",
      challenge: "control-plane-auth:wallet_abc:pause:950",
      signature: "signed_payload"
    }
  });
  const rejected = evaluateActionRequest({ action: "resume", actorWallet: "" });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.requiresAuthorization, true);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.requiresAuthorization, true);
});

test("signed wallet session maps to authorized control-plane action", async () => {
  const provider = {
    isPhantom: true,
    async connect() {
      return {
        publicKey: {
          toString: () => "wallet_live_operator"
        }
      };
    },
    async signMessage(message) {
      return { signature: message };
    }
  };

  const authSession = await connectAndSignForOperator(provider, "kill_switch", 777);
  const result = evaluateActionRequest({
    action: "kill_switch",
    actorWallet: authSession.walletAddress,
    requestedAtMs: 800,
    authorization: {
      wallet: authSession.walletAddress,
      role: authSession.role,
      challenge: authSession.challenge,
      signature: authSession.signature
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.requiresAuthorization, true);
});

test("control actions reject role escalation and stale challenges", () => {
  const stale = evaluateActionRequest({
    action: "resume",
    actorWallet: "wallet_ops",
    requestedAtMs: 200_001,
    authorization: {
      wallet: "wallet_ops",
      role: "operator",
      challenge: createOperatorChallenge("wallet_ops", "resume", 100_000),
      signature: "signed_payload"
    }
  });

  const forbidden = evaluateActionRequest({
    action: "kill_switch",
    actorWallet: "wallet_viewer",
    requestedAtMs: 2_000,
    authorization: {
      wallet: "wallet_viewer",
      role: "viewer",
      challenge: createOperatorChallenge("wallet_viewer", "kill_switch", 1_950),
      signature: "signed_payload"
    }
  });

  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "stale_challenge");
  assert.equal(forbidden.accepted, false);
  assert.equal(forbidden.reason, "forbidden_action");
});

test("live dashboard route payload includes opportunities, positions, and risk signals", () => {
  const response = getLiveDashboardResponse({
    generatedAtMs: 55_000,
    opportunities: [
      {
        intentId: "intent_1",
        market: "SOL-USD",
        venue: "dflow",
        edgeNetBps: 130,
        expectedValueUsd: 11.2,
        direction: "long",
        status: "watching",
        updatedAtMs: 54_900
      }
    ],
    positions: [],
    riskSignals: [],
    totals: {
      openPositions: 0,
      grossExposureUsd: 0,
      netUnrealizedPnlUsd: 0,
      criticalRiskSignals: 0
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.snapshot.opportunities.length, 1);
});

test("config approvals and commerce verification endpoints return normalized payloads", () => {
  const approvals = getConfigApprovalResponse({
    changeId: "cfg_live_1",
    status: "pending",
    approvalsRequired: 2,
    approvalsReceived: 1,
    approvalsRemaining: 1
  });
  const commerce = getCommerceVerificationResponse({
    paymentReference: "pay_live_1",
    billingWallet: "wallet_billing",
    plan: "operator_enterprise",
    settlementStatus: "pending",
    entitlementActive: false
  });

  assert.equal(approvals.ok, true);
  assert.equal(approvals.timeline.approvalsRemaining, 1);
  assert.equal(commerce.ok, true);
  assert.equal(commerce.entitlementActive, false);
});
