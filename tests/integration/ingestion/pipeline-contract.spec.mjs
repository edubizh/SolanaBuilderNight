import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeSnapshot } from "../../../services/state-normalizer/src/index.ts";

const root = path.resolve(process.cwd());

test("ingestion and normalizer expose expected scaffold scripts", async () => {
  const ingestionPackagePath = path.join(root, "services/ingestion-gateway/package.json");
  const normalizerPackagePath = path.join(root, "services/state-normalizer/package.json");

  const ingestionPackage = JSON.parse(await readFile(ingestionPackagePath, "utf8"));
  const normalizerPackage = JSON.parse(await readFile(normalizerPackagePath, "utf8"));

  for (const packageJson of [ingestionPackage, normalizerPackage]) {
    assert.ok(packageJson.scripts.build, "build script must exist");
    assert.ok(packageJson.scripts.typecheck, "typecheck script must exist");
    assert.equal(packageJson.type, "module");
  }
});

test("normalization pipeline emits canonical decimal, time, and event identity fields", () => {
  const normalized = normalizeSnapshot(
    {
      source: "coingecko",
      symbol: "BONK/USD",
      priceAtomic: 12_300n,
      decimals: 4,
      observedAt: "2026-04-21T16:00:00Z",
      externalEventId: "coingecko:BONK:tick-1"
    },
    1_776_788_000_250
  );

  assert.equal(normalized.price, "1.2300");
  assert.equal(normalized.observedAtMs, 1_776_787_200_000);
  assert.equal(normalized.eventId, "coingecko:coingecko:BONK:tick-1");
  assert.equal(normalized.traceId, "coingecko:coingecko:BONK:tick-1");
});
