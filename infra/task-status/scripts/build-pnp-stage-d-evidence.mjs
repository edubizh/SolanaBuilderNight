#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PnpExecutionAdapter } from "../../../services/execution-orchestrator/adapters/pnp/executionAdapter.js";
import { PnpGuardedAdapter } from "../../../services/execution-orchestrator/adapters/pnp/guardedAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");

const nowMs = Date.now();
const fixedClock = () => nowMs;

const executionAdapter = new PnpExecutionAdapter({
  now: fixedClock,
  client: {
    async discoverMarkets() {
      return [];
    },
    async getQuote({ marketId, size }) {
      return {
        marketId,
        size,
        price: 100,
        sourceTimestampMs: nowMs,
        fetchedAtMs: nowMs,
      };
    },
  },
});

const guarded = new PnpGuardedAdapter({
  executionAdapter,
  mode: "dry_run",
  guardrails: { enforceNoNakedExposure: false },
  now: fixedClock,
});

guarded.createGuardedLiveApproval({
  intentId: "pm-d-001-evidence",
  estimatedNotionalUsd: 50,
  approvedBy: "stage-d-evidence-script",
  approvedAtMs: nowMs,
});

const assessment = guarded.assessGuardedLiveRisk(
  {
    intentId: "pm-d-001-evidence",
    orderRequest: { marketId: "pnp-sol-usdc-v2", side: "buy", size: 1, maxSlippageBps: 50 },
    riskContext: {
      estimatedNotionalUsd: 50,
      currentNetExposureUsd: 10,
      projectedNetExposureUsd: 10,
      hedgedExposureUsd: 200,
      reduceOnly: false,
    },
  },
  { nowMs },
);

const artifact = await guarded.executeGuardedLiveTrade(
  {
    intentId: "pm-d-001-evidence",
    orderRequest: { marketId: "pnp-sol-usdc-v2", side: "buy", size: 1, maxSlippageBps: 50 },
    riskContext: {
      estimatedNotionalUsd: 50,
      currentNetExposureUsd: 10,
      projectedNetExposureUsd: 10,
      hedgedExposureUsd: 200,
      reduceOnly: false,
    },
  },
  { live: false, nowMs },
);

const generatedAtUtc = new Date(nowMs).toISOString();
const stamp = generatedAtUtc.replaceAll(":", "").replace(/\./g, "-");
const outDir = join(repoRoot, "infra/task-status/artifacts");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `pnp-stage-d-guarded-live-evidence-${stamp}.json`);

const payload = {
  task_id: "PM-D-001",
  generated_at_utc: generatedAtUtc,
  stage: "D",
  adapter: "pnp",
  mode: "dry_run",
  assessment,
  artifact,
  audit_trail: guarded.listGuardedExecutionAuditTrail(),
  guardrail_caps: {
    maxNotionalUsd: 250,
    maxDailyNotionalUsd: 2500,
    maxSlippageBps: 75,
  },
};

writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`${outPath}\n`);
