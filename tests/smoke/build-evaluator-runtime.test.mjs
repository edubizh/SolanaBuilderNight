import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "../..");
const buildScript = join(repoRoot, "infra/ci/build-evaluator-runtime.mjs");

test("build-evaluator-runtime: zero quotes + only rpc_error autobot lines yields critical_risk_breaches===0", () => {
  const work = join(
    repoRoot,
    ".artifacts",
    "pm-r-004-smoke",
    `ws-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const pg = join(work, ".artifacts", "promotion-gate");
  const autobot = join(work, ".artifacts", "autobot");
  const pred = join(work, ".artifacts", "prediction-bot");
  mkdirSync(pg, { recursive: true });
  mkdirSync(autobot, { recursive: true });
  mkdirSync(pred, { recursive: true });

  const asOf = Date.parse("2026-04-24T12:00:00.000Z");
  const paperStart = Date.parse("2019-12-20T00:00:00.000Z");
  const liveStart = Date.parse("2019-12-20T00:00:00.000Z");

  writeFileSync(
    join(pg, "context.json"),
    `${JSON.stringify(
      {
        paper_started_at_utc_ms: paperStart,
        guarded_live_started_at_utc_ms: liveStart,
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(autobot, "profit-loop-smoke.jsonl"),
    [
      JSON.stringify({ status: "rpc_error", liveExecution: { signature: "sig1" } }),
      JSON.stringify({ status: "rpc_error", error: "fetch failed" }),
    ].join("\n") + "\n",
  );

  execFileSync(
    process.execPath,
    [buildScript, work],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        EVALUATOR_AS_OF_UTC_MS: String(asOf),
        EVALUATOR_SKIP_CHAIN: "1",
      },
    },
  );

  const out = JSON.parse(
    readFileSync(join(work, ".artifacts", "promotion-gate", "evaluator-runtime.json"), "utf8"),
  );
  assert.equal(out.critical_risk_breaches, 0);
  assert.equal(out.paper_days_completed >= 7, true);
  assert.equal(out.guarded_live_days_completed >= 3, true);
});
