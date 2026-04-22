import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const DASHBOARDS = [
  "infra/observability/dashboards/metrics-overview.dashboard.json",
  "infra/observability/dashboards/logs-health.dashboard.json",
  "infra/observability/dashboards/traces-funnel.dashboard.json",
];

const ALERT_POLICY = "infra/observability/alerts/alert-policies.yaml";

test("observability dashboards exist and parse as JSON", () => {
  for (const relativePath of DASHBOARDS) {
    const absolutePath = resolve(ROOT, relativePath);
    assert.ok(existsSync(absolutePath), `${relativePath} must exist`);

    const content = readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(content);

    assert.equal(typeof parsed.title, "string", `${relativePath} must contain a title`);
    assert.ok(Array.isArray(parsed.panels), `${relativePath} must contain panels array`);
    assert.ok(parsed.panels.length > 0, `${relativePath} must contain at least one panel`);
  }
});

test("alert policy includes all required PRD categories", () => {
  const policyPath = resolve(ROOT, ALERT_POLICY);
  assert.ok(existsSync(policyPath), `${ALERT_POLICY} must exist`);

  const content = readFileSync(policyPath, "utf8");

  const requiredPolicyIds = [
    "kill_switch_activated",
    "hard_risk_breach",
    "data_staleness_breach",
    "provider_error_spike",
    "settlement_backlog_breach",
  ];

  for (const policyId of requiredPolicyIds) {
    assert.ok(
      content.includes(`id: ${policyId}`),
      `alert policy must include ${policyId}`,
    );
  }

  assert.ok(
    content.includes("decision_latency_slo_breach"),
    "alert policy must include decision latency SLO alert",
  );
  assert.ok(
    content.includes("dispatch_latency_slo_breach"),
    "alert policy must include dispatch latency SLO alert",
  );
});
