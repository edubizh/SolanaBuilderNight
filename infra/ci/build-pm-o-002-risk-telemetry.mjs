#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPmO002BreachTelemetry } from "../../services/risk-engine/src/index.js";

function fail(code, message) {
  throw new Error(`pm-o-002-risk-telemetry: DIAGNOSTIC_CODE=${code}; ${message}`);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("json_parse_error", `Could not parse ${label} JSON at ${filePath}: ${error.message}`);
  }
}

function normalizeUtcStamp(isoUtc) {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    fail("invalid_as_of_utc", `Invalid as_of_utc value: ${isoUtc}`);
  }
  const normalized = date.toISOString();
  const stamp = normalized.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { normalized, stamp };
}

const evaluatorPath = resolve(process.argv[2] || ".artifacts/promotion-gate/evaluator-runtime.json");
const outputDir = resolve(process.argv[3] || "infra/task-status/artifacts");
const classifierInputPathArg = process.argv[4] || process.env.PM_O_002_CLASSIFIER_INPUT_PATH;
const classifierInputPath = classifierInputPathArg ? resolve(classifierInputPathArg) : null;

const evaluator = readJson(evaluatorPath, "evaluator-runtime");
if (!evaluator || typeof evaluator !== "object") {
  fail("invalid_contract_type", "Evaluator runtime payload must be an object");
}
if (typeof evaluator.as_of_utc !== "string") {
  fail("missing_required_input", "Evaluator runtime missing as_of_utc");
}
if (!Number.isInteger(evaluator.critical_risk_breaches) || evaluator.critical_risk_breaches < 0) {
  fail("invalid_contract_value", "Evaluator runtime critical_risk_breaches must be a non-negative integer");
}

const classifierInput = classifierInputPath
  ? readJson(classifierInputPath, "PM-O-002 classifier input")
  : null;
const classifierEvaluations = buildClassifierEvaluations(classifierInput);
const telemetryEvaluations =
  classifierEvaluations.length > 0
    ? classifierEvaluations
    : Array.from({ length: evaluator.critical_risk_breaches }, () => ({
        riskBreakerSimulation: {
          triggered: true,
          reasons: ["critical_risk_breach_requirement"],
          criticalBreachClassifier: {
            classification: "critical_breach",
            causeRollup: [{ reason: "critical_risk_breach_requirement", count: 1 }]
          }
        }
      }));
const telemetryAsOfUtc =
  (classifierInput && typeof classifierInput.as_of_utc === "string" && classifierInput.as_of_utc) ||
  evaluator.as_of_utc;

const telemetry = buildPmO002BreachTelemetry({
  asOfUtc: telemetryAsOfUtc,
  evaluations: telemetryEvaluations
});
const { stamp } = normalizeUtcStamp(telemetry.as_of_utc);

mkdirSync(outputDir, { recursive: true });
const outPath = resolve(outputDir, `pm-o-002-risk-telemetry-${stamp}.json`);
writeFileSync(outPath, `${JSON.stringify(telemetry, null, 2)}\n`, "utf8");

console.log("Generated PM-O-002 risk telemetry artifact:");
console.log(`- ${outPath}`);

function buildClassifierEvaluations(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const directEvaluations = Array.isArray(payload.evaluations) ? payload.evaluations : [];
  if (directEvaluations.length > 0) {
    return directEvaluations;
  }

  const simulations = Array.isArray(payload.riskBreakerSimulations) ? payload.riskBreakerSimulations : [];
  if (simulations.length > 0) {
    return simulations.map((riskBreakerSimulation) => ({ riskBreakerSimulation }));
  }

  const intents = Array.isArray(payload.paperArbitrageOutputs) ? payload.paperArbitrageOutputs : [];
  if (intents.length > 0) {
    return intents;
  }

  return [];
}
