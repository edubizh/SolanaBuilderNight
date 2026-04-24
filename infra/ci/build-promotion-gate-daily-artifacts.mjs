#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_KEYS = [
  "as_of_utc",
  "paper_days_completed",
  "guarded_live_days_completed",
  "realized_pnl_usd",
  "critical_risk_breaches",
  "overall_pass",
  "failed_criteria",
];
const REQUIRED_CONTEXT_KEYS = [
  "paper_started_at_utc_ms",
  "guarded_live_started_at_utc_ms",
];

const MS_PER_UTC_DAY = 86_400_000;
const REQUIRED_PAPER_DAYS = 7;
const REQUIRED_GUARDED_LIVE_DAYS = 3;
const DEFAULT_RETENTION_RUNS = 30;
const MIN_RETENTION_RUNS = 1;

function fail(code, message) {
  throw new Error(`promotion-gate-daily-artifacts: DIAGNOSTIC_CODE=${code}; ${message}`);
}

function failMissingRequiredInput(key, sourceLabel) {
  fail(
    "missing_required_input",
    `BLOCKER_REASON=missing_required_input:${key}; Missing required ${sourceLabel} field: ${key}`,
  );
}

function normalizeUtcStamp(isoUtc) {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    fail("invalid_as_of_utc", `Invalid as_of_utc value: ${isoUtc}`);
  }
  const normalized = date.toISOString();
  const stamp = normalized.replace(/[-:]/g, "").replace(".000Z", "Z");
  return { normalized, stamp };
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("json_parse_error", `Could not parse ${label} JSON at ${filePath}: ${error.message}`);
  }
}

function ensureContract(evaluator) {
  for (const key of REQUIRED_KEYS) {
    if (!(key in evaluator)) {
      failMissingRequiredInput(key, "evaluator");
    }
  }
  if (!Array.isArray(evaluator.failed_criteria)) {
    fail("invalid_contract_type", "failed_criteria must be an array");
  }
  if (!evaluator.as_of_utc.endsWith("Z")) {
    fail("invalid_contract_value", "as_of_utc must be a UTC timestamp ending in Z");
  }
  if (!Number.isInteger(evaluator.paper_days_completed) || evaluator.paper_days_completed < 0) {
    fail("invalid_contract_value", "paper_days_completed must be a non-negative integer");
  }
  if (!Number.isInteger(evaluator.guarded_live_days_completed) || evaluator.guarded_live_days_completed < 0) {
    fail("invalid_contract_value", "guarded_live_days_completed must be a non-negative integer");
  }
  if (typeof evaluator.realized_pnl_usd !== "number") {
    fail("invalid_contract_type", "realized_pnl_usd must be numeric");
  }
  if (!Number.isInteger(evaluator.critical_risk_breaches) || evaluator.critical_risk_breaches < 0) {
    fail("invalid_contract_value", "critical_risk_breaches must be a non-negative integer");
  }
  if (typeof evaluator.overall_pass !== "boolean") {
    fail("invalid_contract_type", "overall_pass must be boolean");
  }
}

function ensureContextContract(context) {
  for (const key of REQUIRED_CONTEXT_KEYS) {
    if (!(key in context)) {
      failMissingRequiredInput(key, "context");
    }
  }
  if (!Number.isFinite(context.paper_started_at_utc_ms)) {
    fail("invalid_context_value", "Context field paper_started_at_utc_ms must be numeric.");
  }
  if (!Number.isFinite(context.guarded_live_started_at_utc_ms)) {
    fail("invalid_context_value", "Context field guarded_live_started_at_utc_ms must be numeric.");
  }
}

function toUtcDayStartMs(timestampMs) {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function strictCompletedUtcDays(startedAtUtcMs, asOfUtcMs) {
  if (!Number.isFinite(startedAtUtcMs)) {
    return 0;
  }
  const startDay = toUtcDayStartMs(startedAtUtcMs);
  const asOfDay = toUtcDayStartMs(asOfUtcMs);
  return Math.max(0, Math.floor((asOfDay - startDay) / MS_PER_UTC_DAY));
}

function validateStrictWallClock(evaluator, context) {
  const asOfUtcMs = Date.parse(evaluator.as_of_utc);
  const expectedPaperDays = strictCompletedUtcDays(context.paper_started_at_utc_ms, asOfUtcMs);
  const expectedGuardedDays = strictCompletedUtcDays(context.guarded_live_started_at_utc_ms, asOfUtcMs);

  if (expectedPaperDays !== evaluator.paper_days_completed) {
    fail(
      "strict_utc_wall_clock_mismatch",
      `Strict wall-clock mismatch for paper_days_completed: evaluator=${evaluator.paper_days_completed}, expected=${expectedPaperDays}`,
    );
  }
  if (expectedGuardedDays !== evaluator.guarded_live_days_completed) {
    fail(
      "strict_utc_wall_clock_mismatch",
      `Strict wall-clock mismatch for guarded_live_days_completed: evaluator=${evaluator.guarded_live_days_completed}, expected=${expectedGuardedDays}`,
    );
  }

  return {
    validated: true,
    policy: "STRICT_UTC_WALL_CLOCK",
    notes: [
      "UTC day completion only; no rolling 24h windows.",
      "Counts must equal floor((UTC day start(as_of_utc) - UTC day start(started_at)) / 86400000).",
      "Milliseconds within a UTC day do not earn fractional day credit.",
    ],
    expected_from_context: {
      paper_days_completed: expectedPaperDays,
      guarded_live_days_completed: expectedGuardedDays,
    },
  };
}

function buildRemainingToUnlock(evaluator) {
  const remaining = [];
  const missingInputs = evaluator.failed_criteria
    .filter((criterion) => criterion.startsWith("missing_required_input:"))
    .map((criterion) => criterion.split(":")[1] ?? "unknown");
  for (const missingInput of missingInputs) {
    remaining.push(`Provide required evaluator input: ${missingInput}`);
  }

  if (evaluator.paper_days_completed < REQUIRED_PAPER_DAYS) {
    remaining.push(
      `Complete ${REQUIRED_PAPER_DAYS - evaluator.paper_days_completed} more UTC paper day(s) (target: ${REQUIRED_PAPER_DAYS}).`,
    );
  }
  if (evaluator.guarded_live_days_completed < REQUIRED_GUARDED_LIVE_DAYS) {
    remaining.push(
      `Complete ${REQUIRED_GUARDED_LIVE_DAYS - evaluator.guarded_live_days_completed} more UTC guarded-live day(s) (target: ${REQUIRED_GUARDED_LIVE_DAYS}).`,
    );
  }
  if (evaluator.realized_pnl_usd <= 0) {
    remaining.push("Raise realized PnL above 0 USD.");
  }
  if (evaluator.critical_risk_breaches !== 0) {
    remaining.push("Reduce critical risk breaches to 0.");
  }

  if (remaining.length === 0) {
    return ["None. Promotion gate criteria are fully satisfied."];
  }

  return remaining;
}

function parseRetentionRuns(rawValue) {
  const candidate = rawValue ?? String(DEFAULT_RETENTION_RUNS);
  if (!/^\d+$/.test(candidate)) {
    fail(
      "invalid_retention_control",
      `PROMOTION_GATE_DAILY_RETENTION_RUNS must be a positive integer (received: ${candidate})`,
    );
  }
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_RETENTION_RUNS) {
    fail(
      "invalid_retention_control",
      `PROMOTION_GATE_DAILY_RETENTION_RUNS must be >= ${MIN_RETENTION_RUNS} (received: ${candidate})`,
    );
  }
  return parsed;
}

function stampFromArtifactName(name) {
  const match = name.match(/^promotion-gate-daily-(?:snapshot|summary)-(\d{8}T\d{6}Z)\.(?:json|md)$/);
  return match ? match[1] : null;
}

function pruneArtifactsByRetention(artifactDirectory, retentionRuns) {
  const files = readdirSync(artifactDirectory, { withFileTypes: true });
  const versioned = files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => stampFromArtifactName(name) !== null);

  const uniqueStamps = [...new Set(versioned.map((name) => stampFromArtifactName(name)))].sort().reverse();
  const keepStamps = new Set(uniqueStamps.slice(0, retentionRuns));

  const deleted = [];
  for (const name of versioned) {
    const stamp = stampFromArtifactName(name);
    if (!keepStamps.has(stamp)) {
      const target = resolve(artifactDirectory, name);
      rmSync(target, { force: true });
      deleted.push(name);
    }
  }

  return {
    retention_runs: retentionRuns,
    retained_run_count: keepStamps.size,
    removed_files: deleted.sort(),
  };
}

const evaluatorInputPath = process.argv[2] || process.env.PROMOTION_EVALUATOR_INPUT_PATH;
const contextInputPath = process.argv[3] || process.env.PROMOTION_GATE_CONTEXT_INPUT_PATH;
const artifactDir = resolve(process.env.PROMOTION_GATE_ARTIFACT_DIR || "infra/task-status/artifacts/promotion-gate");

if (!evaluatorInputPath) {
  fail("missing_cli_input", "Missing evaluator input path argument or PROMOTION_EVALUATOR_INPUT_PATH.");
}
if (!contextInputPath) {
  fail("missing_cli_input", "Missing context input path argument or PROMOTION_GATE_CONTEXT_INPUT_PATH.");
}

const evaluator = readJson(resolve(evaluatorInputPath), "evaluator input");
const context = readJson(resolve(contextInputPath), "context input");
ensureContract(evaluator);
ensureContextContract(context);
const { normalized: asOfUtc, stamp } = normalizeUtcStamp(evaluator.as_of_utc);
const strictWallClockPolicy = validateStrictWallClock(evaluator, context);
const remainingToUnlock = buildRemainingToUnlock(evaluator);
const retentionRuns = parseRetentionRuns(process.env.PROMOTION_GATE_DAILY_RETENTION_RUNS);

mkdirSync(artifactDir, { recursive: true });
const jsonOut = resolve(artifactDir, `promotion-gate-daily-snapshot-${stamp}.json`);
const mdOut = resolve(artifactDir, `promotion-gate-daily-summary-${stamp}.md`);

const snapshot = {
  task_id: "PM-O-001",
  generated_at_utc: new Date().toISOString(),
  as_of_utc: asOfUtc,
  evaluator_contract_version: "PM-G-001",
  strict_wall_clock_policy: strictWallClockPolicy,
  retention_policy: {
    mode: "deterministic_keep_latest_utc_stamps",
    retention_runs: retentionRuns,
  },
  evaluator: evaluator,
  remaining_to_unlock: remainingToUnlock,
};

writeFileSync(jsonOut, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const mdLines = [
  `# Promotion Gate Daily Summary (${stamp})`,
  "",
  `- Task: PM-O-001`,
  `- As of (UTC): ${asOfUtc}`,
  `- Evaluator contract source: PM-G-001`,
  `- Overall pass: ${evaluator.overall_pass ? "YES" : "NO"}`,
  `- Paper days completed: ${evaluator.paper_days_completed}/${REQUIRED_PAPER_DAYS}`,
  `- Guarded-live days completed: ${evaluator.guarded_live_days_completed}/${REQUIRED_GUARDED_LIVE_DAYS}`,
  `- Realized PnL (USD): ${evaluator.realized_pnl_usd}`,
  `- Critical risk breaches: ${evaluator.critical_risk_breaches}`,
  "",
  "## Strict Wall-Clock Policy",
  "",
  "- Policy: STRICT_UTC_WALL_CLOCK",
  "- Rule: Completed days are counted by UTC day boundaries only.",
  "- Rule: No rolling-hour approximation and no fractional UTC-day credit.",
  "",
  "## Retention Policy",
  "",
  `- Mode: deterministic_keep_latest_utc_stamps`,
  `- Retention runs: ${retentionRuns}`,
  "",
  "## Failed Criteria",
  "",
];

if (evaluator.failed_criteria.length === 0) {
  mdLines.push("- None");
} else {
  for (const criterion of evaluator.failed_criteria) {
    mdLines.push(`- ${criterion}`);
  }
}

mdLines.push("", "## Remaining To Unlock", "");
for (const item of remainingToUnlock) {
  mdLines.push(`- ${item}`);
}

writeFileSync(mdOut, `${mdLines.join("\n")}\n`, "utf8");
const retentionResult = pruneArtifactsByRetention(artifactDir, retentionRuns);

console.log("Generated promotion gate daily artifacts:");
console.log(`- ${jsonOut}`);
console.log(`- ${mdOut}`);
console.log("Applied retention policy:");
console.log(`- retention_runs=${retentionResult.retention_runs}`);
console.log(`- retained_run_count=${retentionResult.retained_run_count}`);
console.log(`- removed_files=${retentionResult.removed_files.length}`);
