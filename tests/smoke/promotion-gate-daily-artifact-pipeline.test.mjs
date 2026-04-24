import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = "infra/ci/build-promotion-gate-daily-artifacts.mjs";

function runPipelineRaw(evaluator, context) {
  const tempRoot = mkdtempSync(join(tmpdir(), "promotion-gate-pipeline-"));
  const evaluatorPath = join(tempRoot, "evaluator.json");
  const contextPath = join(tempRoot, "context.json");
  const artifactDir = join(tempRoot, "artifacts");

  writeFileSync(evaluatorPath, `${JSON.stringify(evaluator, null, 2)}\n`, "utf8");
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, evaluatorPath, contextPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PROMOTION_GATE_ARTIFACT_DIR: artifactDir,
      },
    },
  );

  return {
    tempRoot,
    artifactDir,
    result,
  };
}

function runPipeline(evaluator, context) {
  const run = runPipelineRaw(evaluator, context);
  if (run.result.status !== 0) {
    const output = run.result.stderr || run.result.stdout || "Pipeline script failed.";
    rmSync(run.tempRoot, { recursive: true, force: true });
    throw new Error(output);
  }
  return run;
}

test("daily pipeline emits UTC-stamped JSON and markdown artifacts", () => {
  const evaluator = {
    as_of_utc: "2026-04-24T00:00:00.000Z",
    paper_days_completed: 7,
    guarded_live_days_completed: 3,
    realized_pnl_usd: 12.4,
    critical_risk_breaches: 0,
    overall_pass: true,
    failed_criteria: [],
  };
  const context = {
    paper_started_at_utc_ms: Date.parse("2026-04-17T23:59:59.999Z"),
    guarded_live_started_at_utc_ms: Date.parse("2026-04-21T00:00:00.000Z"),
  };

  const run = runPipeline(evaluator, context);
  try {
    const files = readdirSync(run.artifactDir);
    const jsonArtifact = files.find((name) =>
      /^promotion-gate-daily-snapshot-\d{8}T\d{6}Z\.json$/.test(name),
    );
    const mdArtifact = files.find((name) =>
      /^promotion-gate-daily-summary-\d{8}T\d{6}Z\.md$/.test(name),
    );

    assert.ok(jsonArtifact, "Expected UTC timestamped machine snapshot artifact.");
    assert.ok(mdArtifact, "Expected UTC timestamped markdown summary artifact.");

    const snapshot = JSON.parse(readFileSync(join(run.artifactDir, jsonArtifact), "utf8"));
    assert.equal(snapshot.as_of_utc, evaluator.as_of_utc);
    assert.equal(snapshot.evaluator.overall_pass, true);
    assert.deepEqual(snapshot.remaining_to_unlock, [
      "None. Promotion gate criteria are fully satisfied.",
    ]);

    const summary = readFileSync(join(run.artifactDir, mdArtifact), "utf8");
    assert.match(summary, /## Remaining To Unlock/);
    assert.match(summary, /None\. Promotion gate criteria are fully satisfied\./);
  } finally {
    rmSync(run.tempRoot, { recursive: true, force: true });
  }
});

test("daily pipeline fails deterministically on missing required context with explicit blocker reason", () => {
  const evaluator = {
    as_of_utc: "2026-04-24T00:00:00.000Z",
    paper_days_completed: 7,
    guarded_live_days_completed: 3,
    realized_pnl_usd: 12.4,
    critical_risk_breaches: 0,
    overall_pass: true,
    failed_criteria: [],
  };
  const context = {
    paper_started_at_utc_ms: Date.parse("2026-04-17T23:59:59.999Z"),
  };

  const run = runPipelineRaw(evaluator, context);
  try {
    assert.notEqual(run.result.status, 0, "Expected non-zero exit when required context data is missing.");
    const output = `${run.result.stderr}\n${run.result.stdout}`;
    assert.match(output, /BLOCKER_REASON=missing_required_input:guarded_live_started_at_utc_ms/);
    assert.equal(existsSync(run.artifactDir), false, "No artifact directory should be written on deterministic input failure.");
  } finally {
    rmSync(run.tempRoot, { recursive: true, force: true });
  }
});

test("daily pipeline computes deterministic remaining-to-unlock guidance", () => {
  const evaluator = {
    as_of_utc: "2026-04-24T00:00:00.000Z",
    paper_days_completed: 5,
    guarded_live_days_completed: 1,
    realized_pnl_usd: -1.5,
    critical_risk_breaches: 2,
    overall_pass: false,
    failed_criteria: [
      "missing_required_input:paper_started_at_utc_ms",
      "paper_days_requirement",
      "guarded_live_days_requirement",
      "realized_pnl_positive_requirement",
      "critical_risk_breach_requirement",
    ],
  };
  const context = {
    paper_started_at_utc_ms: Date.parse("2026-04-19T00:00:00.000Z"),
    guarded_live_started_at_utc_ms: Date.parse("2026-04-23T00:00:00.000Z"),
  };

  const run = runPipeline(evaluator, context);
  try {
    const files = readdirSync(run.artifactDir);
    const jsonArtifact = files.find((name) => name.endsWith(".json"));
    assert.ok(jsonArtifact, "Expected snapshot JSON artifact.");
    const snapshot = JSON.parse(readFileSync(join(run.artifactDir, jsonArtifact), "utf8"));

    assert.deepEqual(snapshot.remaining_to_unlock, [
      "Provide required evaluator input: paper_started_at_utc_ms",
      "Complete 2 more UTC paper day(s) (target: 7).",
      "Complete 2 more UTC guarded-live day(s) (target: 3).",
      "Raise realized PnL above 0 USD.",
      "Reduce critical risk breaches to 0.",
    ]);
  } finally {
    rmSync(run.tempRoot, { recursive: true, force: true });
  }
});
