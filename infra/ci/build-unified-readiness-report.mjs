#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_OUTPUT_DIR = "infra/task-status/artifacts/readiness";
const REQUIRED_RELIABILITY_CHECKS = [
  "guardedModeOnly",
  "riskCapsConfigured",
  "noNakedExposureEnforced",
  "approvalTrailRequired",
];

function fail(code, message) {
  throw new Error(`unified-readiness-report: DIAGNOSTIC_CODE=${code}; ${message}`);
}

function failMissingRequiredInput(key, sourceLabel) {
  fail(
    "missing_required_input",
    `BLOCKER_REASON=missing_required_input:${key}; Missing required ${sourceLabel} field: ${key}`,
  );
}

function readJsonFromPath(filePath, label) {
  if (!filePath) {
    fail("missing_cli_input", `Missing required ${label} path argument.`);
  }
  if (!existsSync(filePath)) {
    fail("missing_input_file", `Missing required ${label} file: ${filePath}`);
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("json_parse_error", `Could not parse ${label} JSON at ${filePath}: ${error.message}`);
  }
}

function normalizeUtcStamp(isoUtc) {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    fail("invalid_as_of_utc", `Invalid UTC timestamp value: ${isoUtc}`);
  }
  const normalized = date.toISOString();
  const stamp = normalized.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { normalized, stamp };
}

function requireObject(value, sourceLabel) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_contract_type", `${sourceLabel} must be a JSON object`);
  }
}

function requireFiniteNonNegativeInteger(value, key, sourceLabel) {
  if (!Number.isInteger(value) || value < 0) {
    fail("invalid_contract_value", `${sourceLabel} field ${key} must be a non-negative integer`);
  }
}

function ensurePromotionGateContract(snapshot) {
  requireObject(snapshot, "promotion snapshot");
  if (!("as_of_utc" in snapshot)) {
    failMissingRequiredInput("as_of_utc", "promotion snapshot");
  }
  if (!("evaluator" in snapshot)) {
    failMissingRequiredInput("evaluator", "promotion snapshot");
  }
  requireObject(snapshot.evaluator, "promotion snapshot evaluator");
  const evaluator = snapshot.evaluator;
  for (const key of [
    "paper_days_completed",
    "guarded_live_days_completed",
    "realized_pnl_usd",
    "critical_risk_breaches",
    "overall_pass",
    "failed_criteria",
  ]) {
    if (!(key in evaluator)) {
      failMissingRequiredInput(key, "promotion snapshot evaluator");
    }
  }
  requireFiniteNonNegativeInteger(evaluator.paper_days_completed, "paper_days_completed", "evaluator");
  requireFiniteNonNegativeInteger(
    evaluator.guarded_live_days_completed,
    "guarded_live_days_completed",
    "evaluator",
  );
  requireFiniteNonNegativeInteger(evaluator.critical_risk_breaches, "critical_risk_breaches", "evaluator");
  if (typeof evaluator.realized_pnl_usd !== "number") {
    fail("invalid_contract_type", "evaluator field realized_pnl_usd must be numeric");
  }
  if (typeof evaluator.overall_pass !== "boolean") {
    fail("invalid_contract_type", "evaluator field overall_pass must be boolean");
  }
  if (!Array.isArray(evaluator.failed_criteria)) {
    fail("invalid_contract_type", "evaluator field failed_criteria must be an array");
  }
}

function ensureRiskTelemetryContract(payload) {
  requireObject(payload, "risk telemetry");
  for (const key of ["task_id", "as_of_utc", "critical_breach_total", "top_causes"]) {
    if (!(key in payload)) {
      failMissingRequiredInput(key, "risk telemetry");
    }
  }
  if (payload.task_id !== "PM-O-002") {
    fail("invalid_contract_value", `risk telemetry task_id must be PM-O-002 (received: ${payload.task_id})`);
  }
  requireFiniteNonNegativeInteger(payload.critical_breach_total, "critical_breach_total", "risk telemetry");
  if (!Array.isArray(payload.top_causes)) {
    fail("invalid_contract_type", "risk telemetry field top_causes must be an array");
  }
  for (const [idx, cause] of payload.top_causes.entries()) {
    requireObject(cause, `risk telemetry top_causes[${idx}]`);
    if (!("category" in cause)) {
      failMissingRequiredInput(`top_causes[${idx}].category`, "risk telemetry");
    }
    if (!("count" in cause)) {
      failMissingRequiredInput(`top_causes[${idx}].count`, "risk telemetry");
    }
    if (typeof cause.category !== "string" || cause.category.trim().length === 0) {
      fail("invalid_contract_value", `risk telemetry top_causes[${idx}].category must be non-empty string`);
    }
    requireFiniteNonNegativeInteger(cause.count, `top_causes[${idx}].count`, "risk telemetry");
  }
}

function ensureOpportunityTelemetryContract(payload) {
  requireObject(payload, "opportunity telemetry");
  for (const key of [
    "task_id",
    "as_of_utc",
    "accepted_count",
    "skipped_count",
    "expected_net_usd_p50",
    "expected_net_usd_p90",
    "skip_reasons",
  ]) {
    if (!(key in payload)) {
      failMissingRequiredInput(key, "opportunity telemetry");
    }
  }
  if (payload.task_id !== "PM-O-003") {
    fail(
      "invalid_contract_value",
      `opportunity telemetry task_id must be PM-O-003 (received: ${payload.task_id})`,
    );
  }
  requireFiniteNonNegativeInteger(payload.accepted_count, "accepted_count", "opportunity telemetry");
  requireFiniteNonNegativeInteger(payload.skipped_count, "skipped_count", "opportunity telemetry");
  if (typeof payload.expected_net_usd_p50 !== "number") {
    fail("invalid_contract_type", "opportunity telemetry expected_net_usd_p50 must be numeric");
  }
  if (typeof payload.expected_net_usd_p90 !== "number") {
    fail("invalid_contract_type", "opportunity telemetry expected_net_usd_p90 must be numeric");
  }
  if (!Array.isArray(payload.skip_reasons)) {
    fail("invalid_contract_type", "opportunity telemetry skip_reasons must be an array");
  }
  for (const [idx, reason] of payload.skip_reasons.entries()) {
    requireObject(reason, `opportunity telemetry skip_reasons[${idx}]`);
    if (!("reason" in reason)) {
      failMissingRequiredInput(`skip_reasons[${idx}].reason`, "opportunity telemetry");
    }
    if (!("count" in reason)) {
      failMissingRequiredInput(`skip_reasons[${idx}].count`, "opportunity telemetry");
    }
    if (typeof reason.reason !== "string" || reason.reason.trim().length === 0) {
      fail(
        "invalid_contract_value",
        `opportunity telemetry skip_reasons[${idx}].reason must be non-empty string`,
      );
    }
    requireFiniteNonNegativeInteger(reason.count, `skip_reasons[${idx}].count`, "opportunity telemetry");
  }
}

function ensureReliabilityEvidenceContract(payload, expectedTaskId, label) {
  requireObject(payload, label);
  for (const key of ["taskId", "generatedAtUtc", "checks"]) {
    if (!(key in payload)) {
      failMissingRequiredInput(key, label);
    }
  }
  if (payload.taskId !== expectedTaskId) {
    fail("invalid_contract_value", `${label} taskId must be ${expectedTaskId} (received: ${payload.taskId})`);
  }
  requireObject(payload.checks, `${label} checks`);
  for (const check of REQUIRED_RELIABILITY_CHECKS) {
    if (!(check in payload.checks)) {
      failMissingRequiredInput(`checks.${check}`, label);
    }
    if (payload.checks[check] !== true) {
      fail("evidence_check_failed", `BLOCKER_REASON=evidence_check_failed:${expectedTaskId}:${check}`);
    }
  }
}

function parseGeneratedAtUtc(value, label) {
  if (typeof value !== "string" || !/^\d{8}T\d{6}Z$/.test(value)) {
    fail("invalid_contract_value", `${label} generatedAtUtc must use YYYYMMDDTHHMMSSZ format`);
  }
  const canonical = value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6.000Z",
  );
  const parsed = Date.parse(canonical);
  if (!Number.isFinite(parsed)) {
    fail("invalid_contract_value", `${label} generatedAtUtc is not parseable as UTC timestamp`);
  }
  return parsed;
}

function latestPriorReportPath(outputDir, currentStamp) {
  if (!existsSync(outputDir)) {
    return null;
  }
  const candidates = readdirSync(outputDir)
    .filter((name) => /^readiness-report-\d{8}T\d{6}Z\.json$/.test(name))
    .sort()
    .reverse();
  for (const name of candidates) {
    const stamp = name.match(/^readiness-report-(\d{8}T\d{6}Z)\.json$/)?.[1];
    if (stamp && stamp < currentStamp) {
      return resolve(outputDir, name);
    }
  }
  return null;
}

function buildTrend(current, previous) {
  if (!previous) {
    return {
      baseline: true,
      summary: "No prior readiness snapshot available; trend baseline established.",
      deltas: {},
    };
  }
  const deltas = {
    realized_pnl_usd: Number((current.promotion.realized_pnl_usd - previous.promotion.realized_pnl_usd).toFixed(6)),
    critical_breach_total: current.risk.critical_breach_total - previous.risk.critical_breach_total,
    accepted_count: current.opportunity.accepted_count - previous.opportunity.accepted_count,
    skipped_count: current.opportunity.skipped_count - previous.opportunity.skipped_count,
    expected_net_usd_p50: Number(
      (current.opportunity.expected_net_usd_p50 - previous.opportunity.expected_net_usd_p50).toFixed(6),
    ),
  };
  const components = [
    `realized_pnl_usd ${deltas.realized_pnl_usd >= 0 ? "+" : ""}${deltas.realized_pnl_usd}`,
    `critical_breach_total ${deltas.critical_breach_total >= 0 ? "+" : ""}${deltas.critical_breach_total}`,
    `accepted_count ${deltas.accepted_count >= 0 ? "+" : ""}${deltas.accepted_count}`,
    `skipped_count ${deltas.skipped_count >= 0 ? "+" : ""}${deltas.skipped_count}`,
    `expected_net_usd_p50 ${deltas.expected_net_usd_p50 >= 0 ? "+" : ""}${deltas.expected_net_usd_p50}`,
  ];
  return {
    baseline: false,
    summary: components.join("; "),
    deltas,
  };
}

function boolLabel(value) {
  return value ? "PASS" : "FAIL";
}

const promotionPath = resolve(process.argv[2] || process.env.READINESS_PROMOTION_SNAPSHOT_PATH || "");
const riskPath = resolve(process.argv[3] || process.env.READINESS_RISK_TELEMETRY_PATH || "");
const opportunityPath = resolve(process.argv[4] || process.env.READINESS_OPPORTUNITY_TELEMETRY_PATH || "");
const dflowPath = resolve(process.argv[5] || process.env.READINESS_DFLOW_EVIDENCE_PATH || "");
const geminiPath = resolve(process.argv[6] || process.env.READINESS_GEMINI_EVIDENCE_PATH || "");
const outputDir = resolve(process.env.READINESS_REPORT_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);

const promotionSnapshot = readJsonFromPath(promotionPath, "promotion snapshot");
const riskTelemetry = readJsonFromPath(riskPath, "risk telemetry");
const opportunityTelemetry = readJsonFromPath(opportunityPath, "opportunity telemetry");
const dflowEvidence = readJsonFromPath(dflowPath, "dflow reliability evidence");
const geminiEvidence = readJsonFromPath(geminiPath, "gemini reliability evidence");

ensurePromotionGateContract(promotionSnapshot);
ensureRiskTelemetryContract(riskTelemetry);
ensureOpportunityTelemetryContract(opportunityTelemetry);
ensureReliabilityEvidenceContract(dflowEvidence, "PM-C-001", "dflow reliability evidence");
ensureReliabilityEvidenceContract(geminiEvidence, "PM-C-002", "gemini reliability evidence");

const asOfCandidates = [
  normalizeUtcStamp(promotionSnapshot.as_of_utc).normalized,
  normalizeUtcStamp(riskTelemetry.as_of_utc).normalized,
  normalizeUtcStamp(opportunityTelemetry.as_of_utc).normalized,
  new Date(parseGeneratedAtUtc(dflowEvidence.generatedAtUtc, "dflow reliability evidence")).toISOString(),
  new Date(parseGeneratedAtUtc(geminiEvidence.generatedAtUtc, "gemini reliability evidence")).toISOString(),
].sort();

const asOfUtc = asOfCandidates[asOfCandidates.length - 1];
const { stamp } = normalizeUtcStamp(asOfUtc);

const current = {
  promotion: {
    overall_pass: promotionSnapshot.evaluator.overall_pass,
    failed_criteria: promotionSnapshot.evaluator.failed_criteria,
    realized_pnl_usd: promotionSnapshot.evaluator.realized_pnl_usd,
    critical_risk_breaches: promotionSnapshot.evaluator.critical_risk_breaches,
  },
  risk: {
    critical_breach_total: riskTelemetry.critical_breach_total,
    top_causes: riskTelemetry.top_causes,
  },
  opportunity: {
    accepted_count: opportunityTelemetry.accepted_count,
    skipped_count: opportunityTelemetry.skipped_count,
    expected_net_usd_p50: opportunityTelemetry.expected_net_usd_p50,
    expected_net_usd_p90: opportunityTelemetry.expected_net_usd_p90,
  },
  reliability: {
    dflow_checks: dflowEvidence.checks,
    gemini_checks: geminiEvidence.checks,
  },
};

const priorPath = latestPriorReportPath(outputDir, stamp);
let priorSnapshot = null;
if (priorPath) {
  priorSnapshot = readJsonFromPath(priorPath, "prior readiness report");
}

const trend = buildTrend(current, priorSnapshot ? priorSnapshot.current : null);

const gateStatus = {
  promotion_gate: current.promotion.overall_pass,
  risk_breach_gate: current.risk.critical_breach_total === 0,
  opportunity_signal_gate: current.opportunity.accepted_count > 0,
  reliability_gate: true,
};

const blockers = [];
if (!gateStatus.promotion_gate) {
  blockers.push(
    ...current.promotion.failed_criteria.map((criterion) => `promotion_gate_failed:${criterion}`),
  );
}
if (!gateStatus.risk_breach_gate) {
  blockers.push(`critical_breach_total:${current.risk.critical_breach_total}`);
}
if (!gateStatus.opportunity_signal_gate) {
  blockers.push("opportunity_signal_gate:accepted_count_zero");
}
if (!gateStatus.reliability_gate) {
  blockers.push("reliability_gate:failed_checks");
}

const overallReady = blockers.length === 0;

const report = {
  task_id: "PM-O-005",
  generated_at_utc: new Date().toISOString(),
  as_of_utc: asOfUtc,
  sources: {
    promotion_snapshot_path: promotionPath,
    risk_telemetry_path: riskPath,
    opportunity_telemetry_path: opportunityPath,
    dflow_evidence_path: dflowPath,
    gemini_evidence_path: geminiPath,
    prior_report_path: priorPath,
  },
  gate_status: {
    ...gateStatus,
    overall_ready: overallReady,
  },
  blockers,
  trend_summary: trend,
  current,
};

mkdirSync(outputDir, { recursive: true });
const jsonOut = resolve(outputDir, `readiness-report-${stamp}.json`);
const mdOut = resolve(outputDir, `readiness-report-${stamp}.md`);

writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const mdLines = [
  `# Unified Daily Readiness Report (${stamp})`,
  "",
  `- Task: PM-O-005`,
  `- As of (UTC): ${asOfUtc}`,
  `- Overall readiness: ${overallReady ? "READY" : "BLOCKED"}`,
  "",
  "## Gate Status",
  "",
  `- Promotion gate: ${boolLabel(gateStatus.promotion_gate)}`,
  `- Risk breach gate: ${boolLabel(gateStatus.risk_breach_gate)}`,
  `- Opportunity signal gate: ${boolLabel(gateStatus.opportunity_signal_gate)}`,
  `- Reliability gate: ${boolLabel(gateStatus.reliability_gate)}`,
  "",
  "## Blockers",
  "",
];

if (blockers.length === 0) {
  mdLines.push("- None");
} else {
  for (const blocker of blockers) {
    mdLines.push(`- ${blocker}`);
  }
}

mdLines.push("", "## Trend Summary", "", `- ${trend.summary}`, "", "## Current Metrics", "");
mdLines.push(`- Realized PnL (USD): ${current.promotion.realized_pnl_usd}`);
mdLines.push(`- Critical breaches (risk telemetry): ${current.risk.critical_breach_total}`);
mdLines.push(`- Opportunity accepted/skipped: ${current.opportunity.accepted_count}/${current.opportunity.skipped_count}`);
mdLines.push(`- Opportunity expected net p50/p90 (USD): ${current.opportunity.expected_net_usd_p50}/${current.opportunity.expected_net_usd_p90}`);
mdLines.push("", "## Risk Top Causes", "");

if (current.risk.top_causes.length === 0) {
  mdLines.push("- None");
} else {
  for (const cause of current.risk.top_causes) {
    mdLines.push(`- ${cause.category}: ${cause.count}`);
  }
}

writeFileSync(mdOut, `${mdLines.join("\n")}\n`, "utf8");

console.log("Generated unified readiness artifacts:");
console.log(`- ${jsonOut}`);
console.log(`- ${mdOut}`);
