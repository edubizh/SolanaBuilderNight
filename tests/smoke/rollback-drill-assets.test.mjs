import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const REQUIRED_FILES = [
  "infra/release/rollback-drill.sh",
  "docs/runbooks/release-rollback-drill.md",
  ".github/workflows/release-rollback-drill.yml",
];

test("rollback drill assets exist", () => {
  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = resolve(ROOT, relativePath);
    assert.ok(existsSync(absolutePath), `${relativePath} must exist`);
  }
});

test("release workflow wires drill script and smoke gate", () => {
  const workflowPath = resolve(ROOT, ".github/workflows/release-rollback-drill.yml");
  const content = readFileSync(workflowPath, "utf8");

  assert.ok(
    content.includes("bash infra/release/rollback-drill.sh"),
    "workflow must execute rollback drill script",
  );
  assert.ok(
    content.includes("bash infra/ci/run-quality-gate.sh smoke"),
    "workflow must execute smoke gate",
  );
  assert.ok(
    content.includes("docs/runbooks/release-rollback-drill.md"),
    "workflow failure issue must reference release runbook",
  );
});

test("runbook includes rollback trigger and recovery criteria", () => {
  const runbookPath = resolve(ROOT, "docs/runbooks/release-rollback-drill.md");
  const content = readFileSync(runbookPath, "utf8");

  const requiredSections = [
    "## Rollback Trigger Matrix",
    "## Drill Procedure",
    "## Recovery Exit Criteria",
    "## Evidence and Audit Trail",
  ];

  for (const section of requiredSections) {
    assert.ok(content.includes(section), `runbook must include ${section}`);
  }
});
