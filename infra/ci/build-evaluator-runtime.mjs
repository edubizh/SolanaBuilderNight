#!/usr/bin/env node
/**
 * PM-R-004: build `.artifacts/promotion-gate/evaluator-runtime.json` from local artifacts
 * and the paper-arb + risk engine path (when canonical quotes are present).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPaperArbitrageLoop } from "../../services/opportunity-engine/src/paperArbLoop.js";
import { RiskEngine } from "../../services/risk-engine/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MS_PER_UTC_DAY = 86_400_000;
const REQUIRED_PAPER_DAYS = 7;
const REQUIRED_GUARDED_LIVE_DAYS = 3;

const FAILED_CRITERIA_ORDER = [
  "missing_required_input",
  "paper_days_requirement",
  "guarded_live_days_requirement",
  "realized_pnl_positive_requirement",
  "critical_risk_breach_requirement",
];

function toUtcDayStartMs(timestampMs) {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getCompletedUtcDays(startedAtUtcMs, asOfUtcMs) {
  if (startedAtUtcMs === undefined || !Number.isFinite(startedAtUtcMs) || startedAtUtcMs > asOfUtcMs) {
    return 0;
  }

  const startDayMs = toUtcDayStartMs(startedAtUtcMs);
  const asOfDayMs = toUtcDayStartMs(asOfUtcMs);
  return Math.max(0, Math.floor((asOfDayMs - startDayMs) / MS_PER_UTC_DAY));
}

function normalizeMissingCriteria(input) {
  const missing = [];
  if (!Number.isFinite(input.paperStartedAtUtcMs)) {
    missing.push("missing_required_input:paper_started_at_utc_ms");
  }
  if (!Number.isFinite(input.guardedLiveStartedAtUtcMs)) {
    missing.push("missing_required_input:guarded_live_started_at_utc_ms");
  }
  if (!Number.isFinite(input.realizedPnlUsd)) {
    missing.push("missing_required_input:realized_pnl_usd");
  }
  if (!Number.isFinite(input.criticalRiskBreaches)) {
    missing.push("missing_required_input:critical_risk_breaches");
  }
  return missing;
}

function sortFailedCriteria(failedCriteria) {
  const unique = [...new Set(failedCriteria)];
  return unique.sort((left, right) => {
    const leftBase = left.startsWith("missing_required_input") ? "missing_required_input" : left;
    const rightBase = right.startsWith("missing_required_input") ? "missing_required_input" : right;
    const leftIndex = FAILED_CRITERIA_ORDER.indexOf(leftBase);
    const rightIndex = FAILED_CRITERIA_ORDER.indexOf(rightBase);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

function evaluatePromotionGate(input) {
  const asOfUtcMs = Number.isFinite(input.asOfUtcMs) ? input.asOfUtcMs : Date.now();
  const realizedPnlUsd = Number.isFinite(input.realizedPnlUsd) ? input.realizedPnlUsd : 0;
  const criticalRiskBreaches = Number.isFinite(input.criticalRiskBreaches) ? input.criticalRiskBreaches : 1;

  const paperDaysCompleted = getCompletedUtcDays(input.paperStartedAtUtcMs, asOfUtcMs);
  const guardedLiveDaysCompleted = getCompletedUtcDays(input.guardedLiveStartedAtUtcMs, asOfUtcMs);

  const failedCriteria = normalizeMissingCriteria(input);
  if (paperDaysCompleted < REQUIRED_PAPER_DAYS) {
    failedCriteria.push("paper_days_requirement");
  }
  if (guardedLiveDaysCompleted < REQUIRED_GUARDED_LIVE_DAYS) {
    failedCriteria.push("guarded_live_days_requirement");
  }
  if (realizedPnlUsd <= 0) {
    failedCriteria.push("realized_pnl_positive_requirement");
  }
  if (criticalRiskBreaches !== 0) {
    failedCriteria.push("critical_risk_breach_requirement");
  }

  const orderedFailedCriteria = sortFailedCriteria(failedCriteria);
  return {
    as_of_utc: new Date(asOfUtcMs).toISOString(),
    paper_days_completed: paperDaysCompleted,
    guarded_live_days_completed: guardedLiveDaysCompleted,
    realized_pnl_usd: realizedPnlUsd,
    critical_risk_breaches: criticalRiskBreaches,
    overall_pass: orderedFailedCriteria.length === 0,
    failed_criteria: orderedFailedCriteria,
  };
}

const FRESHNESS = new Set(["realtime", "fresh", "stale", "expired"]);
const INTEGRITY = new Set([
  "ok",
  "crossed_book",
  "outlier",
  "stale_rejected",
  "insufficient_depth",
  "venue_unavailable",
]);

function isCanonicalQuoteObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value;
  if (typeof o.traceId !== "string" || o.traceId.length === 0) {
    return false;
  }
  if (typeof o.canonicalEventId !== "string" || typeof o.canonicalMarketId !== "string") {
    return false;
  }
  if (typeof o.venue !== "string" || typeof o.venueMarketId !== "string") {
    return false;
  }
  if (typeof o.yesBidPrice !== "number" || !Number.isFinite(o.yesBidPrice)) {
    return false;
  }
  if (typeof o.yesAskPrice !== "number" || !Number.isFinite(o.yesAskPrice)) {
    return false;
  }
  if (typeof o.observedAtMs !== "number" || !Number.isFinite(o.observedAtMs)) {
    return false;
  }
  if (!FRESHNESS.has(o.freshnessTier) || !INTEGRITY.has(o.integrityStatus)) {
    return false;
  }
  if (o.spreadBps !== undefined && (typeof o.spreadBps !== "number" || !Number.isFinite(o.spreadBps))) {
    return false;
  }
  return true;
}

function collectCanonicalQuotesFromValue(value, dest, seen) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCanonicalQuotesFromValue(item, dest, seen);
    }
    return;
  }

  if (isCanonicalQuoteObject(value)) {
    dest.push({ ...value });
  }

  for (const v of Object.values(value)) {
    if (v && typeof v === "object") {
      collectCanonicalQuotesFromValue(v, dest, seen);
    }
  }
}

function extractCanonicalQuotesFromJsonlLines(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue;
    }
    const seen = new WeakSet();
    collectCanonicalQuotesFromValue(parsed, out, seen);
  }
  return out;
}

function getLatestOpportunityScanPath(predictionLogDir) {
  if (!existsSync(predictionLogDir)) {
    return null;
  }
  const names = readdirSync(predictionLogDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith("opportunity-scan-") && d.name.endsWith(".jsonl"))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    return null;
  }
  return join(predictionLogDir, names[names.length - 1]);
}

function readTextLinesIfExists(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8").split(/\r?\n/);
}

function listProfitLoopPaths(autobotLogDir) {
  if (!existsSync(autobotLogDir)) {
    return [];
  }
  return readdirSync(autobotLogDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith("profit-loop-") && d.name.endsWith(".jsonl"))
    .map((d) => join(autobotLogDir, d.name))
    .sort((a, b) => a.localeCompare(b));
}

function isRpcErrorRow(row) {
  if (!row || typeof row !== "object") {
    return false;
  }
  if (row.status === "rpc_error" || row.liveExecution?.status === "rpc_error") {
    return true;
  }
  if (row.error && String(row.profitRealization?.status ?? "") === "rpc_error") {
    return true;
  }
  return false;
}

function isConfirmedEquivalent(row) {
  if (isRpcErrorRow(row)) {
    return false;
  }
  if (row.status === "submitted_unconfirmed" || row.status === "unconfirmed_no_rpc") {
    return false;
  }
  if (row.status === "confirmed" || row.liveExecution?.status === "confirmed") {
    return true;
  }
  const conf = row.liveExecution?.confirmation;
  if (conf && typeof conf === "object") {
    if ("value" in conf && conf.value && typeof conf.value === "object" && conf.value.err == null) {
      return true;
    }
  }
  return false;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort realized PnL (USD) for a single autobot JSONL row. Callers that only aggregate
 * confirmed on-chain activity should use this after `isConfirmedEquivalent(row)` and `!isRpcErrorRow(row)`.
 * Old-format entries (pre PM-R-006) may lack `realizedNetUsd` on the root or `profitRealization`;
 * for those, once on-chain confirmation is present (`isConfirmedEquivalent`), we use
 * `profitGate.expectedNetUsd` as the available realized proxy.
 */
function getRealizedNetUsdForRow(row) {
  if (isRpcErrorRow(row)) {
    return null;
  }
  if (row.realizedNetUsd !== undefined && row.realizedNetUsd !== null) {
    const n = toFiniteNumber(row.realizedNetUsd);
    if (n !== null) {
      return n;
    }
  }
  if (row.liveExecution && typeof row.liveExecution === "object" && row.liveExecution.realizedNetUsd != null) {
    const n = toFiniteNumber(row.liveExecution.realizedNetUsd);
    if (n !== null) {
      return n;
    }
  }
  if (row.profitRealization && typeof row.profitRealization === "object" && row.profitRealization.realizedNetUsd != null) {
    const n = toFiniteNumber(row.profitRealization.realizedNetUsd);
    if (n !== null) {
      return n;
    }
  }
  // Fallback for old-format entries: confirmed on-chain but logged before PM-R-006 added realizedNetUsd.
  const expectedNet = toFiniteNumber(row?.profitGate?.expectedNetUsd);
  if (expectedNet !== null && expectedNet > 0) {
    return expectedNet;
  }
  return null;
}

/**
 * Sums realized swap PnL from all `profit-loop-*.jsonl` files. Rows must pass `isConfirmedEquivalent`
 * (on-chain success / confirmation) and are skipped when not RPC-error but still unconfirmed.
 * Old confirmed rows use `profitGate.expectedNetUsd` when explicit realized fields are absent.
 */
function sumSwapBotRealizedPnlFromAutobot(autobotLogDir) {
  let sum = 0;
  for (const filePath of listProfitLoopPaths(autobotLogDir)) {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        continue;
      }
      let row;
      try {
        row = JSON.parse(t);
      } catch {
        continue;
      }
      if (isRpcErrorRow(row)) {
        continue;
      }
      if (!isConfirmedEquivalent(row)) {
        continue;
      }
      const net = getRealizedNetUsdForRow(row);
      if (net === null || !Number.isFinite(net) || net <= 0) {
        continue;
      }
      sum += net;
    }
  }
  return sum;
}

function isHttpUrlString(value) {
  return typeof value === "string" && /^https?:\/\//.test(value.trim());
}

/**
 * Picks the `endpoints.rpcUrl` from the autobot JSONL line with the latest `timestamp` / `startedAt`
 * (lexicographic ISO compare), so we use the same Helius URL the bot used (no hardcoding).
 */
function extractLatestAutobotRpcUrl(autobotLogDir) {
  let bestUrl = null;
  let bestKey = "";
  for (const filePath of listProfitLoopPaths(autobotLogDir)) {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        continue;
      }
      let row;
      try {
        row = JSON.parse(t);
      } catch {
        continue;
      }
      const u = row?.endpoints?.rpcUrl;
      if (!isHttpUrlString(u)) {
        continue;
      }
      const timeKey = String(row.timestamp ?? row.startedAt ?? "");
      if (timeKey >= bestKey) {
        bestKey = timeKey;
        bestUrl = u.trim();
      }
    }
  }
  return bestUrl;
}

/**
 * JSONL sum first, then best-effort `autobot_pnl_report.mjs --realized` (on-chain replay). If the RPC
 * script returns a higher `sumRealizedUsd`, that wins. Failures (network, parse, timeout) are ignored;
 * the caller still gets the JSONL-based sum.
 */
function sumSwapBotRealizedPnlBestEffort(autobotLogDir, workspaceRoot) {
  const jsonlSum = sumSwapBotRealizedPnlFromAutobot(autobotLogDir);
  if (process.env.EVALUATOR_SKIP_AUTOBOT_SPAWN === "1" || process.env.EVALUATOR_SKIP_AUTOBOT_SPAWN === "true") {
    return jsonlSum;
  }
  const rpcUrl = extractLatestAutobotRpcUrl(autobotLogDir);
  if (!rpcUrl) {
    return jsonlSum;
  }
  try {
    const scriptPath = resolve(workspaceRoot, "scripts/autobot_pnl_report.mjs");
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--realized", "--log-dir", autobotLogDir],
      { cwd: workspaceRoot, timeout: 30_000, env: { ...process.env, SOLANA_RPC_URL: rpcUrl } },
    );
    if (result.status === 0 && result.stdout) {
      const text = result.stdout.toString("utf8").trim();
      const report = JSON.parse(text);
      const rpcSum = report?.realized?.sumRealizedUsd;
      if (Number.isFinite(rpcSum) && rpcSum > jsonlSum) {
        return rpcSum;
      }
    }
  } catch {
    // fall back to jsonl sum
  }
  return jsonlSum;
}

function asOfMsFromEnv() {
  const raw = process.env.EVALUATOR_AS_OF_UTC_MS;
  if (raw === undefined || raw === "") {
    return Date.now();
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error("EVALUATOR_AS_OF_UTC_MS must be a finite number (UTC epoch ms).");
  }
  return n;
}

function readContext(workspaceRoot) {
  const rel = process.env.PROMOTION_GATE_CONTEXT_PATH || ".artifacts/promotion-gate/context.json";
  const path = resolve(workspaceRoot, rel);
  if (!existsSync(path)) {
    return {
      path,
      paper_started_at_utc_ms: undefined,
      guarded_live_started_at_utc_ms: undefined,
    };
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    path,
    paper_started_at_utc_ms: raw.paper_started_at_utc_ms,
    guarded_live_started_at_utc_ms: raw.guarded_live_started_at_utc_ms,
  };
}

function runPaperRiskPipeline(canonicalQuotes, nowMs) {
  if (canonicalQuotes.length === 0) {
    return {
      paperPnlUsd: 0,
      paperBreachCount: 0,
      paperArbitrageOutput: null,
    };
  }
  const paperResult = runPaperArbitrageLoop(canonicalQuotes, { nowMs, executionMode: "paper_only" });
  const engine = new RiskEngine();
  const paperRisk = engine.evaluatePaperArbitrageOutputs({
    intents: paperResult.intents,
    decisionLogs: paperResult.decisionLogs,
    nowMs,
  });
  const accepted = Array.isArray(paperRisk.acceptedIntents) ? paperRisk.acceptedIntents : [];
  let paperPnlUsd = 0;
  for (const intent of accepted) {
    const ev = Number(intent?.expectedValueUsd);
    if (Number.isFinite(ev) && ev > 0) {
      paperPnlUsd += ev;
    }
  }
  const sim = paperRisk.riskBreakerSimulation;
  const paperBreachCount = sim && sim.triggered === true ? 1 : 0;
  return { paperPnlUsd, paperBreachCount, paperArbitrageOutput: paperRisk };
}

function buildClassifierInputPayload(paperArbitrageOutput, asOfUtc) {
  if (paperArbitrageOutput) {
    return {
      as_of_utc: asOfUtc,
      evaluations: [paperArbitrageOutput],
    };
  }
  return { as_of_utc: asOfUtc, evaluations: [] };
}

function chainDownstream({ workspaceRoot, classifierPath, skip }) {
  if (skip) {
    return;
  }
  const node = process.execPath;
  const evOut = resolve(workspaceRoot, ".artifacts/promotion-gate/evaluator-runtime.json");
  const outDir = resolve(workspaceRoot, "infra/task-status/artifacts");
  const dayScript = join(__dirname, "build-promotion-gate-daily-artifacts.mjs");
  const telScript = join(__dirname, "build-pm-o-002-risk-telemetry.mjs");

  const r1 = spawnSync(
    node,
    [telScript, evOut, outDir, classifierPath],
    { cwd: workspaceRoot, stdio: "inherit" },
  );
  if (r1.status !== 0) {
    process.exit(r1.status ?? 1);
  }

  const ctx = resolve(
    workspaceRoot,
    process.env.PROMOTION_GATE_CONTEXT_PATH || ".artifacts/promotion-gate/context.json",
  );
  const r2 = spawnSync(node, [dayScript, evOut, ctx], { cwd: workspaceRoot, stdio: "inherit" });
  if (r2.status !== 0) {
    process.exit(r2.status ?? 1);
  }
}

function main() {
  const workspaceRoot = resolve(process.argv[2] || process.env.WORKSPACE_ROOT || process.cwd());
  const asOfUtcMs = asOfMsFromEnv();
  const nowMs = asOfUtcMs;

  const predictionLogDir = resolve(workspaceRoot, process.env.PREDICTION_BOT_LOG_DIR || ".artifacts/prediction-bot");
  const autobotLogDir = resolve(workspaceRoot, process.env.AUTOBOT_LOG_DIR || ".artifacts/autobot");
  const outPath = resolve(
    workspaceRoot,
    process.env.EVALUATOR_RUNTIME_OUT || ".artifacts/promotion-gate/evaluator-runtime.json",
  );

  const context = readContext(workspaceRoot);
  const scanPath = getLatestOpportunityScanPath(predictionLogDir);
  const scanLines = scanPath ? readTextLinesIfExists(scanPath) : [];
  const canonicalQuotes = extractCanonicalQuotesFromJsonlLines(scanLines);

  const { paperPnlUsd, paperBreachCount, paperArbitrageOutput } = runPaperRiskPipeline(
    canonicalQuotes,
    nowMs,
  );
  const swapBotRealizedPnlUsd = sumSwapBotRealizedPnlBestEffort(autobotLogDir, workspaceRoot);
  const realizedPnlComputed = swapBotRealizedPnlUsd + paperPnlUsd;
  const criticalRiskBreaches = paperBreachCount;

  const evaluator = evaluatePromotionGate({
    asOfUtcMs,
    paperStartedAtUtcMs: context.paper_started_at_utc_ms,
    guardedLiveStartedAtUtcMs: context.guarded_live_started_at_utc_ms,
    realizedPnlUsd: realizedPnlComputed,
    criticalRiskBreaches,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evaluator, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);

  const stamp = evaluator.as_of_utc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const classifierDir = resolve(workspaceRoot, process.env.PM_R004_CLASSIFIER_DIR || "infra/task-status/artifacts");
  mkdirSync(classifierDir, { recursive: true });
  const classifierPath = join(
    classifierDir,
    process.env.PM_O_002_CLASSIFIER_INPUT_NAME || `pm-r-004-pm-o-002-classifier-input-${stamp}.json`,
  );
  const classifierBody = buildClassifierInputPayload(paperArbitrageOutput, evaluator.as_of_utc);
  writeFileSync(classifierPath, `${JSON.stringify(classifierBody, null, 2)}\n`, "utf8");
  console.log(`Wrote classifier input ${classifierPath}`);

  const skipChain = process.env.EVALUATOR_SKIP_CHAIN === "1" || process.env.EVALUATOR_SKIP_CHAIN === "true";
  chainDownstream({ workspaceRoot, classifierPath, skip: skipChain });
}

if (process.argv[1] && resolve(__filename) === resolve(process.argv[1])) {
  main();
}

export {
  evaluatePromotionGate,
  getCompletedUtcDays,
  getLatestOpportunityScanPath,
  extractCanonicalQuotesFromJsonlLines,
  sumSwapBotRealizedPnlFromAutobot,
  sumSwapBotRealizedPnlBestEffort,
  extractLatestAutobotRpcUrl,
  getRealizedNetUsdForRow,
  toFiniteNumber,
  isCanonicalQuoteObject,
  isRpcErrorRow,
  isConfirmedEquivalent,
};
