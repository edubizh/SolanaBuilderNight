import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const ALERT_POLICY = "infra/observability/alerts/alert-policies.yaml";
const DASHBOARD = "infra/observability/dashboards/metrics-overview.dashboard.json";
const RUNBOOK = "docs/runbooks/prediction-stage-a-observability.md";

function read(relativePath) {
  const absolutePath = resolve(ROOT, relativePath);
  assert.ok(existsSync(absolutePath), `${relativePath} must exist`);
  return readFileSync(absolutePath, "utf8");
}

test("stage-a metrics dashboard includes ingestion + quote integrity panels", () => {
  const dashboard = JSON.parse(read(DASHBOARD));
  const panelExpressions = dashboard.panels
    .flatMap((panel) => panel.targets ?? [])
    .map((target) => target.expr ?? "");

  const requiredExpressions = [
    "ingestion_lag_ms_bucket{pipeline=\"prediction_markets\"}",
    "quote_integrity_failures_total",
    "quote_integrity_checks_total",
    "stale_quote_rejections_total",
  ];

  for (const expr of requiredExpressions) {
    assert.ok(
      panelExpressions.some((candidate) => candidate.includes(expr)),
      `dashboard must include expression fragment: ${expr}`,
    );
  }
});

test("stage-a alert policies include runbook-linked ingestion/quote controls", () => {
  const policy = read(ALERT_POLICY);

  const requiredPolicyIds = [
    "prediction_ingestion_lag_breach",
    "prediction_quote_integrity_failure_spike",
    "prediction_stale_quote_rejection_spike",
  ];

  for (const id of requiredPolicyIds) {
    assert.ok(policy.includes(`id: ${id}`), `missing alert policy id: ${id}`);
  }

  assert.ok(
    policy.includes("docs/runbooks/prediction-stage-a-observability.md#ingestion-lag-triage"),
    "ingestion lag policy must reference runbook triage section",
  );
  assert.ok(
    policy.includes("docs/runbooks/prediction-stage-a-observability.md#quote-integrity-failure-triage"),
    "quote integrity policy must reference runbook triage section",
  );
});

test("stage-a runbook documents audit evidence requirements", () => {
  const runbook = read(RUNBOOK);
  assert.ok(runbook.includes("## Audit Evidence Capture"), "runbook must contain audit evidence section");
  assert.ok(
    runbook.includes("prediction-stage-a-integrity"),
    "runbook must document CI artifact source",
  );
});
