import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = "infra/ci/build-unified-readiness-report.mjs";

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function fixtureSet(asOfUtc, overrides = {}) {
  return {
    promotion: {
      as_of_utc: asOfUtc,
      evaluator: {
        paper_days_completed: 7,
        guarded_live_days_completed: 3,
        realized_pnl_usd: 42.5,
        critical_risk_breaches: 0,
        overall_pass: true,
        failed_criteria: [],
      },
      ...overrides.promotion,
    },
    risk: {
      task_id: "PM-O-002",
      as_of_utc: asOfUtc,
      critical_breach_total: 0,
      top_causes: [{ category: "none", count: 0 }],
      ...overrides.risk,
    },
    opportunity: {
      task_id: "PM-O-003",
      as_of_utc: asOfUtc,
      accepted_count: 14,
      skipped_count: 3,
      expected_net_usd_p50: 4.25,
      expected_net_usd_p90: 8.5,
      skip_reasons: [{ reason: "spread_too_tight", count: 3 }],
      ...overrides.opportunity,
    },
    dflow: {
      taskId: "PM-C-001",
      generatedAtUtc: "20260424T210000Z",
      checks: {
        guardedModeOnly: true,
        riskCapsConfigured: true,
        noNakedExposureEnforced: true,
        approvalTrailRequired: true,
      },
      ...overrides.dflow,
    },
    gemini: {
      taskId: "PM-C-002",
      generatedAtUtc: "20260424T210000Z",
      checks: {
        guardedModeOnly: true,
        riskCapsConfigured: true,
        noNakedExposureEnforced: true,
        approvalTrailRequired: true,
      },
      ...overrides.gemini,
    },
  };
}

function runBuilder(fixtures, envOverrides = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "unified-readiness-"));
  const promotionPath = join(tempRoot, "promotion.json");
  const riskPath = join(tempRoot, "risk.json");
  const opportunityPath = join(tempRoot, "opportunity.json");
  const dflowPath = join(tempRoot, "dflow.json");
  const geminiPath = join(tempRoot, "gemini.json");
  const outDir = join(tempRoot, "out");

  writeJson(promotionPath, fixtures.promotion);
  writeJson(riskPath, fixtures.risk);
  writeJson(opportunityPath, fixtures.opportunity);
  writeJson(dflowPath, fixtures.dflow);
  writeJson(geminiPath, fixtures.gemini);

  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, promotionPath, riskPath, opportunityPath, dflowPath, geminiPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        READINESS_REPORT_OUTPUT_DIR: outDir,
        ...envOverrides,
      },
    },
  );

  return {
    tempRoot,
    outDir,
    promotionPath,
    riskPath,
    opportunityPath,
    dflowPath,
    geminiPath,
    result,
  };
}

test("unified readiness report emits machine and markdown outputs", () => {
  const run = runBuilder(fixtureSet("2026-04-24T20:55:06.541Z"));
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    const files = readdirSync(run.outDir);
    const jsonName = files.find((name) => /^readiness-report-\d{8}T\d{6}Z\.json$/.test(name));
    const mdName = files.find((name) => /^readiness-report-\d{8}T\d{6}Z\.md$/.test(name));
    assert.ok(jsonName, "Expected machine-readable readiness report.");
    assert.ok(mdName, "Expected markdown readiness report.");

    const jsonPayload = JSON.parse(readFileSync(join(run.outDir, jsonName), "utf8"));
    assert.equal(jsonPayload.task_id, "PM-O-005");
    assert.equal(jsonPayload.gate_status.overall_ready, true);
    assert.deepEqual(jsonPayload.blockers, []);
    assert.equal(jsonPayload.trend_summary.baseline, true);

    const mdPayload = readFileSync(join(run.outDir, mdName), "utf8");
    assert.match(mdPayload, /## Gate Status/);
    assert.match(mdPayload, /Overall readiness: READY/);
    assert.match(mdPayload, /## Trend Summary/);
  } finally {
    rmSync(run.tempRoot, { recursive: true, force: true });
  }
});

test("unified readiness report computes deterministic trend deltas from prior snapshot", () => {
  const firstRun = runBuilder(
    fixtureSet("2026-04-24T20:55:06.541Z", {
      promotion: {
        evaluator: {
          paper_days_completed: 7,
          guarded_live_days_completed: 3,
          realized_pnl_usd: 10,
          critical_risk_breaches: 0,
          overall_pass: true,
          failed_criteria: [],
        },
      },
      opportunity: {
        accepted_count: 5,
        skipped_count: 5,
        expected_net_usd_p50: 1.5,
        expected_net_usd_p90: 2.5,
        skip_reasons: [{ reason: "liq_low", count: 5 }],
      },
    }),
  );

  try {
    assert.equal(firstRun.result.status, 0, firstRun.result.stderr || firstRun.result.stdout);

    const secondFixture = fixtureSet("2026-04-25T20:55:06.541Z", {
      promotion: {
        evaluator: {
          paper_days_completed: 8,
          guarded_live_days_completed: 4,
          realized_pnl_usd: 18,
          critical_risk_breaches: 0,
          overall_pass: true,
          failed_criteria: [],
        },
      },
      opportunity: {
        accepted_count: 9,
        skipped_count: 4,
        expected_net_usd_p50: 2.75,
        expected_net_usd_p90: 3.25,
        skip_reasons: [{ reason: "liq_low", count: 4 }],
      },
      dflow: {
        generatedAtUtc: "20260425T210000Z",
      },
      gemini: {
        generatedAtUtc: "20260425T210000Z",
      },
    });

    const rerun = runBuilder(secondFixture, {
      READINESS_REPORT_OUTPUT_DIR: firstRun.outDir,
    });
    try {
      assert.equal(rerun.result.status, 0, rerun.result.stderr || rerun.result.stdout);
      const files = readdirSync(firstRun.outDir);
      const newestJson = files
        .filter((name) => /^readiness-report-\d{8}T\d{6}Z\.json$/.test(name))
        .sort()
        .at(-1);
      assert.ok(newestJson, "Expected latest readiness report JSON artifact.");
      const payload = JSON.parse(readFileSync(join(firstRun.outDir, newestJson), "utf8"));
      assert.equal(payload.trend_summary.baseline, false);
      assert.equal(payload.trend_summary.deltas.realized_pnl_usd, 8);
      assert.equal(payload.trend_summary.deltas.accepted_count, 4);
      assert.equal(payload.trend_summary.deltas.skipped_count, -1);
    } finally {
      rmSync(rerun.tempRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(firstRun.tempRoot, { recursive: true, force: true });
  }
});

test("unified readiness report fails closed on missing required telemetry fields", () => {
  const fixtures = fixtureSet("2026-04-24T20:55:06.541Z");
  delete fixtures.risk.critical_breach_total;
  fixtures.risk.top_causes = [{ category: "latency", count: 2 }];
  const run = runBuilder(fixtures);
  try {
    assert.notEqual(run.result.status, 0, "Expected deterministic non-zero exit on missing required input.");
    const output = `${run.result.stderr}\n${run.result.stdout}`;
    assert.match(output, /DIAGNOSTIC_CODE=missing_required_input/);
    assert.match(output, /BLOCKER_REASON=missing_required_input:critical_breach_total/);
    assert.equal(existsSync(run.outDir), false, "No readiness artifact should be written on contract failure.");
  } finally {
    rmSync(run.tempRoot, { recursive: true, force: true });
  }
});

test("unified readiness report surfaces blockers when any gate fails", () => {
  const run = runBuilder(
    fixtureSet("2026-04-24T20:55:06.541Z", {
      promotion: {
        evaluator: {
          paper_days_completed: 7,
          guarded_live_days_completed: 3,
          realized_pnl_usd: 0,
          critical_risk_breaches: 2,
          overall_pass: false,
          failed_criteria: ["realized_pnl_positive_requirement", "critical_risk_breach_requirement"],
        },
      },
      risk: {
        task_id: "PM-O-002",
        as_of_utc: "2026-04-24T20:55:06.541Z",
        critical_breach_total: 2,
        top_causes: [{ category: "critical_risk_breach_requirement", count: 2 }],
      },
      opportunity: {
        accepted_count: 0,
        skipped_count: 12,
        expected_net_usd_p50: -0.25,
        expected_net_usd_p90: 1.0,
        skip_reasons: [{ reason: "risk_rejected", count: 12 }],
      },
    }),
  );
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    const files = readdirSync(run.outDir);
    const jsonName = files.find((name) => name.endsWith(".json"));
    assert.ok(jsonName, "Expected readiness report JSON artifact.");
    const report = JSON.parse(readFileSync(join(run.outDir, jsonName), "utf8"));
    assert.equal(report.gate_status.overall_ready, false);
    assert.deepEqual(report.blockers, [
      "promotion_gate_failed:realized_pnl_positive_requirement",
      "promotion_gate_failed:critical_risk_breach_requirement",
      "critical_breach_total:2",
      "opportunity_signal_gate:accepted_count_zero",
    ]);
  } finally {
    rmSync(run.tempRoot, { recursive: true, force: true });
  }
});
