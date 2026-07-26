import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationName = "20260720_credential_intake_platform_secret_governance_hardening.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert(migration.includes("COLLATE utf8mb4_unicode_ci"));
assert(migration.includes("credential_intake_auto_platform_secret_promotion"));
assert(migration.includes("credential_intake_platform_secret_promotion"));
assert(migration.includes("platform_secret_reference_provisioning_state_stale"));
assert(migration.includes("ambiguous_platform_secret_reference"));
assert(migration.includes("provisioned_pending_validation"));
assert(runner.includes(migrationName));
assert(readiness.includes(migrationName));

const reviewedPreflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(reviewedPreflight.status, "pass", JSON.stringify(reviewedPreflight.risks));
assert.equal(reviewedPreflight.counts.alter_table, 1);
assert.equal(reviewedPreflight.counts.alter_table_idempotent, 1);

const unrelatedAlter = assessMigrationSqlPreflight(
  "unsafe_unrelated_alter.sql",
  "ALTER TABLE secret_references MODIFY COLUMN owner_id VARCHAR(255) NOT NULL;"
);
assert.equal(unrelatedAlter.status, "warn");
assert(unrelatedAlter.risks.some((risk) => risk.code === "alter_table_requires_manual_idempotency_review"));

console.log("platform secret promotion monitoring hardening tests passed");
