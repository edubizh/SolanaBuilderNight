import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());

test("ingestion service scaffold files exist", async () => {
  const requiredFiles = [
    "services/ingestion-gateway/package.json",
    "services/ingestion-gateway/tsconfig.json",
    "services/ingestion-gateway/src/index.ts",
    "services/ingestion-gateway/src/connectors/types.ts",
    "services/ingestion-gateway/src/connectors/connector-registry.ts",
    "services/state-normalizer/package.json",
    "services/state-normalizer/tsconfig.json",
    "services/state-normalizer/src/index.ts"
  ];

  await Promise.all(
    requiredFiles.map(async (relativePath) => {
      await access(path.join(root, relativePath), constants.F_OK);
    })
  );
});

test("ingestion gateway package metadata is present", async () => {
  const packagePath = path.join(root, "services/ingestion-gateway/package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(packageJson.name, "@solana-builder-night/ingestion-gateway");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
});
