import test from "node:test";
import assert from "node:assert/strict";

const DEFAULT_TIMEOUT_MS = 10_000;

function getStagingUrl() {
  return process.env.STAGING_SMOKE_URL ?? "";
}

test("staging smoke URL is configured", () => {
  assert.ok(
    getStagingUrl(),
    "STAGING_SMOKE_URL must be set for staging smoke pipeline runs",
  );
});

test("staging smoke endpoint returns HTTP 2xx/3xx", async () => {
  const url = getStagingUrl();
  assert.ok(url, "STAGING_SMOKE_URL is required");

  const timeoutMs = Number.parseInt(
    process.env.STAGING_SMOKE_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`,
    10,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "solana-builder-night-smoke/1.0",
      },
      signal: controller.signal,
    });

    assert.ok(
      response.status >= 200 && response.status < 400,
      `Expected 2xx/3xx response from ${url}, received ${response.status}`,
    );
  } finally {
    clearTimeout(timeout);
  }
});
