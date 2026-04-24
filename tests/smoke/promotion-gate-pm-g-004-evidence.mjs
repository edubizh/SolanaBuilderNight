#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = "infra/ci/build-promotion-gate-daily-artifacts.mjs";
const EVIDENCE_DIR = resolve("tests/smoke/artifacts/promotion-gate/pm-g-004");
const PASS_ARTIFACT_DIR = resolve(EVIDENCE_DIR, "pass-artifacts");
const TEMP_DIR = resolve(EVIDENCE_DIR, ".tmp");

function run(evaluatorPath, contextPath, artifactDir) {
  return spawnSync(process.execPath, [SCRIPT_PATH, evaluatorPath, contextPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PROMOTION_GATE_ARTIFACT_DIR: artifactDir,
    },
  });
}

rmSync(TEMP_DIR, { recursive: true, force: true });
mkdirSync(TEMP_DIR, { recursive: true });
mkdirSync(EVIDENCE_DIR, { recursive: true });
rmSync(PASS_ARTIFACT_DIR, { recursive: true, force: true });

const passEvaluatorPath = resolve(EVIDENCE_DIR, "pass-evaluator.json");
const passContextPath = resolve(EVIDENCE_DIR, "pass-context.json");
const failEvaluatorPath = resolve(EVIDENCE_DIR, "missing-data-evaluator.json");
const failContextPath = resolve(EVIDENCE_DIR, "missing-data-context.json");

const passEvaluator = {
  as_of_utc: "2026-04-24T00:00:00.000Z",
  paper_days_completed: 7,
  guarded_live_days_completed: 3,
  realized_pnl_usd: 12.4,
  critical_risk_breaches: 0,
  overall_pass: true,
  failed_criteria: [],
};
const passContext = {
  paper_started_at_utc_ms: Date.parse("2026-04-17T23:59:59.999Z"),
  guarded_live_started_at_utc_ms: Date.parse("2026-04-21T00:00:00.000Z"),
};
const failContext = {
  paper_started_at_utc_ms: Date.parse("2026-04-17T23:59:59.999Z"),
};

writeFileSync(passEvaluatorPath, `${JSON.stringify(passEvaluator, null, 2)}\n`, "utf8");
writeFileSync(passContextPath, `${JSON.stringify(passContext, null, 2)}\n`, "utf8");
writeFileSync(failEvaluatorPath, `${JSON.stringify(passEvaluator, null, 2)}\n`, "utf8");
writeFileSync(failContextPath, `${JSON.stringify(failContext, null, 2)}\n`, "utf8");

const passRun = run(passEvaluatorPath, passContextPath, TEMP_DIR);
writeFileSync(
  resolve(EVIDENCE_DIR, "pass-run.log"),
  `exit_code=${passRun.status}\nstdout:\n${passRun.stdout}\nstderr:\n${passRun.stderr}\n`,
  "utf8",
);
if (passRun.status !== 0) {
  throw new Error("Pass-path evidence generation failed.");
}
cpSync(TEMP_DIR, PASS_ARTIFACT_DIR, { recursive: true });

rmSync(TEMP_DIR, { recursive: true, force: true });
mkdirSync(TEMP_DIR, { recursive: true });

const failRun = run(failEvaluatorPath, failContextPath, TEMP_DIR);
writeFileSync(
  resolve(EVIDENCE_DIR, "missing-data-failure.log"),
  `exit_code=${failRun.status}\nstdout:\n${failRun.stdout}\nstderr:\n${failRun.stderr}\n`,
  "utf8",
);
if (failRun.status === 0) {
  throw new Error("Missing-data failure mode unexpectedly exited with code 0.");
}
const failOutput = `${failRun.stdout}\n${failRun.stderr}`;
if (!failOutput.includes("DIAGNOSTIC_CODE=missing_required_input")) {
  throw new Error("Missing-data failure log did not include expected deterministic diagnostic code.");
}
if (!failOutput.includes("BLOCKER_REASON=missing_required_input:guarded_live_started_at_utc_ms")) {
  throw new Error("Missing-data failure log did not include expected blocker reason.");
}

writeFileSync(
  resolve(EVIDENCE_DIR, "evidence-summary.md"),
  [
    "# PM-G-004 Evidence Summary",
    "",
    "- Pass path: `pass-run.log` exit code must be 0 and artifacts copied to `pass-artifacts/`.",
    "- Missing data failure: `missing-data-failure.log` exit code must be non-zero and include both `DIAGNOSTIC_CODE=missing_required_input` and `BLOCKER_REASON=missing_required_input:guarded_live_started_at_utc_ms`.",
    "",
    "## Captured Artifacts",
    "",
    "- `pass-artifacts/promotion-gate-daily-snapshot-*.json`",
    "- `pass-artifacts/promotion-gate-daily-summary-*.md`",
    "",
    "## Captured Logs",
    "",
    "- `pass-run.log`",
    "- `missing-data-failure.log`",
  ].join("\n") + "\n",
  "utf8",
);

rmSync(TEMP_DIR, { recursive: true, force: true });
console.log(`PM-G-004 evidence written to ${EVIDENCE_DIR}`);
