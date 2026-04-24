import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = "infra/ci/build-pm-o-002-risk-telemetry.mjs";

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("PM-O-002 telemetry script maps breaker causeRollup reasons into top_causes", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "pm-o-002-risk-telemetry-"));
  const evaluatorPath = join(tempRoot, "evaluator-runtime.json");
  const classifierPath = join(tempRoot, "classifier-input.json");
  const outDir = join(tempRoot, "out");

  writeJson(evaluatorPath, {
    as_of_utc: "2026-04-24T21:29:38Z",
    paper_days_completed: 7,
    guarded_live_days_completed: 3,
    realized_pnl_usd: 0,
    critical_risk_breaches: 2,
    overall_pass: false,
    failed_criteria: ["critical_risk_breach_requirement"]
  });
  writeJson(classifierPath, {
    as_of_utc: "2026-04-24T21:29:38Z",
    evaluations: [
      {
        riskBreakerSimulation: {
          triggered: true,
          reasons: ["critical_rule_breach", "reconciliation_mismatch_threshold"],
          criticalBreachClassifier: {
            classification: "critical_breach",
            causeRollup: [
              { rank: 1, reason: "critical_rule_breach", count: 1 },
              { rank: 2, reason: "reconciliation_mismatch_threshold", count: 1 }
            ]
          }
        }
      },
      {
        riskBreakerSimulation: {
          triggered: true,
          reasons: ["reconciliation_mismatch_threshold"],
          criticalBreachClassifier: {
            classification: "critical_breach",
            causeRollup: [{ rank: 1, reason: "reconciliation_mismatch_threshold", count: 1 }]
          }
        }
      }
    ]
  });

  const result = spawnSync(process.execPath, [SCRIPT_PATH, evaluatorPath, outDir, classifierPath], {
    encoding: "utf8"
  });

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsonName = readdirSync(outDir).find((name) => /^pm-o-002-risk-telemetry-\d{8}T\d{6}Z\.json$/.test(name));
    assert.ok(jsonName, "Expected PM-O-002 risk telemetry artifact.");
    const payload = JSON.parse(readFileSync(join(outDir, jsonName), "utf8"));
    assert.equal(payload.task_id, "PM-O-002");
    assert.equal(payload.critical_breach_total, 2);
    assert.deepEqual(payload.top_causes, [
      { category: "reconciliation_mismatch_threshold", reason: "reconciliation_mismatch_threshold", count: 2 },
      { category: "critical_rule_breach", reason: "critical_rule_breach", count: 1 }
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
