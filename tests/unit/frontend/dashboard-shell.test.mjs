import test from "node:test";
import assert from "node:assert/strict";
import { createConsoleShell, consoleRoutes } from "../../../apps/frontend-console/src/lib/dashboard-shell.ts";
import { connectAndSignForOperator, createOperatorChallenge } from "../../../apps/frontend-console/src/lib/operator-auth.ts";
import { createAuthorizedActionRequest } from "../../../apps/frontend-console/src/lib/operator-controls.ts";
import { createDashboardSnapshot } from "../../../apps/frontend-console/src/lib/live-dashboard.ts";
import { buildConfigApprovalTimeline } from "../../../apps/frontend-console/src/lib/config-approvals.ts";
import { resolveEntitlementState } from "../../../apps/frontend-console/src/lib/commerce-entitlements.ts";
import { evaluatePromotionGate } from "../../../services/control-plane-api/src/routes/promotion-gate.ts";
import { enforcePromotionBoardState } from "../../../services/control-plane-api/src/routes/promotion-board-enforcement.ts";

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

test("promotion evaluator counts completed days using strict UTC wall-clock boundaries", () => {
  const result = evaluatePromotionGate({
    asOfUtcMs: Date.parse("2026-04-24T00:00:00.000Z"),
    paperStartedAtUtcMs: Date.parse("2026-04-17T23:59:59.999Z"),
    guardedLiveStartedAtUtcMs: Date.parse("2026-04-21T00:00:00.000Z"),
    realizedPnlUsd: 10.5,
    criticalRiskBreaches: 0
  });

  assert.equal(result.paper_days_completed, 7);
  assert.equal(result.guarded_live_days_completed, 3);
  assert.equal(result.overall_pass, true);
  assert.deepEqual(result.failed_criteria, []);
});

test("promotion evaluator reports deterministic missing-input blockers and ordered failures", () => {
  const result = evaluatePromotionGate({
    asOfUtcMs: Date.parse("2026-04-24T12:00:00.000Z"),
    realizedPnlUsd: -2,
    criticalRiskBreaches: 3
  });

  assert.equal(result.overall_pass, false);
  assert.deepEqual(result.failed_criteria, [
    "missing_required_input:guarded_live_started_at_utc_ms",
    "missing_required_input:paper_started_at_utc_ms",
    "paper_days_requirement",
    "guarded_live_days_requirement",
    "realized_pnl_positive_requirement",
    "critical_risk_breach_requirement"
  ]);
});

test("board enforcement keeps PM-D-001 blocked with exact failed criteria when evaluator fails", () => {
  const board = `| ID | Owner | DependsOn | Scope | StageGate | EvidenceRequired | Status | Notes |
|---|---|---|---|---|---|---|---|
| PM-D-001 | Worker 5 (PNP Execution Hardening) | PM-C-001, PM-C-002, PROMOTION-GATE | \`services/execution-orchestrator/adapters/pnp/**\`, \`services/position-settlement-service/adapters/pnp/**\`, \`infra/**\`, \`docs/runbooks/**\` | Stage D | Promotion-gate evidence bundle (7d paper, 3d live, positive realized PnL, zero critical breaches) | BLOCKED | old note |`;
  const evaluatorResult = {
    as_of_utc: "2026-04-24T00:00:00.000Z",
    paper_days_completed: 6,
    guarded_live_days_completed: 2,
    realized_pnl_usd: -5,
    critical_risk_breaches: 1,
    overall_pass: false,
    failed_criteria: [
      "paper_days_requirement",
      "guarded_live_days_requirement",
      "realized_pnl_positive_requirement",
      "critical_risk_breach_requirement"
    ]
  };

  const result = enforcePromotionBoardState({ boardMarkdown: board, evaluatorResult });
  assert.equal(result.pmD001Status, "BLOCKED");
  assert.equal(
    result.pmD001Notes,
    "Hard gate: evaluator overall_pass=false. Failed criteria: paper_days_requirement, guarded_live_days_requirement, realized_pnl_positive_requirement, critical_risk_breach_requirement. BLOCKED on `PROMOTION-GATE`."
  );
  assert.match(
    result.updatedBoardMarkdown,
    /\| PM-D-001 .* \| BLOCKED \| Hard gate: evaluator overall_pass=false\. Failed criteria: paper_days_requirement, guarded_live_days_requirement, realized_pnl_positive_requirement, critical_risk_breach_requirement\. BLOCKED on `PROMOTION-GATE`\. \|/
  );
});

test("board enforcement promotes PM-D-001 to ready when evaluator passes and records evidence path", () => {
  const board = `| ID | Owner | DependsOn | Scope | StageGate | EvidenceRequired | Status | Notes |
|---|---|---|---|---|---|---|---|
| PM-D-001 | Worker 5 (PNP Execution Hardening) | PM-C-001, PM-C-002, PROMOTION-GATE | \`services/execution-orchestrator/adapters/pnp/**\`, \`services/position-settlement-service/adapters/pnp/**\`, \`infra/**\`, \`docs/runbooks/**\` | Stage D | Promotion-gate evidence bundle (7d paper, 3d live, positive realized PnL, zero critical breaches) | BLOCKED | old note |`;
  const evaluatorResult = {
    as_of_utc: "2026-04-24T00:00:00.000Z",
    paper_days_completed: 7,
    guarded_live_days_completed: 3,
    realized_pnl_usd: 25,
    critical_risk_breaches: 0,
    overall_pass: true,
    failed_criteria: []
  };

  const result = enforcePromotionBoardState({
    boardMarkdown: board,
    evaluatorResult,
    evidencePath: "artifacts/promotion-gate/2026-04-24/evaluator.json"
  });
  assert.equal(result.pmD001Status, "READY");
  assert.equal(
    result.pmD001Notes,
    "Promotion gate passed by evaluator (overall_pass=true). Evidence: `artifacts/promotion-gate/2026-04-24/evaluator.json`."
  );
  assert.match(
    result.updatedBoardMarkdown,
    /\| PM-D-001 .* \| READY \| Promotion gate passed by evaluator \(overall_pass=true\)\. Evidence: `artifacts\/promotion-gate\/2026-04-24\/evaluator\.json`\.\s\|/
  );
});
