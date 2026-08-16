#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessMigrationPreflight,
  buildReadbackContract,
  buildRollbackMatrix,
  buildTrackBManifest,
} from "../databaseLifecycleReadiness.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.resolve(API_DIR, "../docs/agent-tracks/track-b-migration-readiness-manifest.json");
const TARGETS = Object.freeze([
  {
    file: "migrations/1043_sprint69_tenant_managed_execution_lifecycle.sql",
    expectedTables: [],
    purpose: "Tenant Managed Execution 017 readiness authorization and preflight; apply disabled.",
  },
  {
    file: "migrations/20260812_deployment_attestation_runtime_integrity_v1.sql",
    expectedTables: [],
    purpose: "Environment Promotion 018 runtime integrity support; apply disabled.",
  },
]);

function outputPath(argv) {
  const value = argv.find((item) => item.startsWith("--output="));
  return value ? path.resolve(value.slice("--output=".length)) : DEFAULT_OUTPUT;
}

export async function buildTrackBReadinessManifest({ apiDir = API_DIR } = {}) {
  const migrations = [];
  const readbacks = [];
  for (const target of TARGETS) {
    const sql = await readFile(path.join(apiDir, target.file), "utf8");
    const migration = assessMigrationPreflight({ file: target.file, sql, expectedTables: target.expectedTables, environment: "non-production" });
    migrations.push({ ...migration, purpose: target.purpose });
    readbacks.push(buildReadbackContract({ migration, observed: {} }));
  }
  return buildTrackBManifest({
    migrations,
    readbacks,
    rollback: buildRollbackMatrix([
      { operation: "environment_promotion_runtime_integrity" },
      { operation: "tenant_managed_execution_lifecycle" },
      { operation: "context_ownership_additive_persistence" },
    ]),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = outputPath(process.argv.slice(2));
  buildTrackBReadinessManifest()
    .then(async (manifest) => {
      await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify({ ok: true, output, migration_applied: false, database_mutated: false, secrets_included: false }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
