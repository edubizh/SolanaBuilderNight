import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  getRealizedNetUsdForRow,
  sumSwapBotRealizedPnlFromAutobot,
} from "../../infra/ci/build-evaluator-runtime.mjs";

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

test("getRealizedNetUsdForRow: old confirmed row uses profitGate.expectedNetUsd (no top-level realizedNetUsd)", () => {
  const row = {
    liveExecution: {
      confirmation: { value: { err: null } },
    },
    profitGate: { expectedNetUsd: 0.0027 },
  };
  const v = getRealizedNetUsdForRow(row);
  assert.equal(v, 0.0027);
});

test("getRealizedNetUsdForRow: new format liveExecution.realizedNetUsd wins over profitGate", () => {
  const row = {
    liveExecution: {
      status: "confirmed",
      realizedNetUsd: 0.0031,
      confirmation: { value: { err: null } },
    },
    profitGate: { expectedNetUsd: 0.01 },
  };
  const v = getRealizedNetUsdForRow(row);
  assert.equal(v, 0.0031);
});

test("getRealizedNetUsdForRow: rpc_error row returns null", () => {
  const row = { status: "rpc_error", profitGate: { expectedNetUsd: 0.1 } };
  assert.equal(getRealizedNetUsdForRow(row), null);
});

test("sumSwapBotRealizedPnlFromAutobot: 2 old-format confirmed + 1 rpc_error = sum of ev only", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-sum-"));
  try {
    const lines = [
      {
        status: "rpc_error",
        profitGate: { expectedNetUsd: 0.1 },
        liveExecution: { signature: "a" },
      },
      {
        liveExecution: {
          signature: "b",
          confirmation: { value: { err: null } },
        },
        profitGate: { expectedNetUsd: 0.002 },
      },
      {
        liveExecution: {
          signature: "c",
          confirmation: { value: { err: null } },
        },
        profitGate: { expectedNetUsd: 0.003 },
      },
    ];
    writeFileSync(
      join(dir, "profit-loop-test.jsonl"),
      lines.map((o) => JSON.stringify(o)).join("\n") + "\n",
    );
    const sum = sumSwapBotRealizedPnlFromAutobot(dir);
    assert.equal(sum, 0.005);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-evaluator-runtime: local .artifacts autobot JSONL drives realized_pnl_usd > 0 (JSONL path)", () => {
  const pl = join(repoRoot, ".artifacts", "autobot", "profit-loop-2026-04-24.jsonl");
  if (!existsSync(pl)) {
    return;
  }
  execFileSync(
    process.execPath,
    [buildScript, repoRoot],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        EVALUATOR_SKIP_CHAIN: "1",
        EVALUATOR_SKIP_AUTOBOT_SPAWN: "1",
      },
    },
  );
  const out = JSON.parse(
    readFileSync(join(repoRoot, ".artifacts", "promotion-gate", "evaluator-runtime.json"), "utf8"),
  );
  assert.equal(out.critical_risk_breaches, 0);
  assert.equal(out.realized_pnl_usd > 0, true);
  assert.equal(out.overall_pass, true);
  assert.deepEqual(out.failed_criteria, []);
});
