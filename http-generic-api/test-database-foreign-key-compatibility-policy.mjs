import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectOrderedMigrationChainForeignKeys } from "./databaseForeignKeyCompatibilityPolicyGuard.js";
import { compareMigrationFiles } from "./scripts/migration-order.mjs";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiRoot, "..");
const migrationsDir = path.join(apiRoot, "migrations");
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort(compareMigrationFiles);
const orderedFiles = migrationFiles.map((file) => `http-generic-api/migrations/${file}`);
const policy = JSON.parse(fs.readFileSync(path.join(apiRoot, "config", "staging-migration-contract-policy.json"), "utf8"));
const readFile = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

const inspect = (effectivePolicy, effectiveFiles = orderedFiles) => inspectOrderedMigrationChainForeignKeys({
  files: effectiveFiles,
  baselineFile: "http-generic-api/schema.sql",
  engine: "mariadb",
  policy: effectivePolicy,
  readFile,
});

const healthy = inspect(policy);
assert.equal(healthy.ok, true);
assert.equal(healthy.ready, true);
assert.equal(healthy.type_mismatches, 0);
assert.equal(healthy.unresolved_type_mismatches, 0);
assert.equal(healthy.missing_parent_tables, 0);
assert.equal(healthy.missing_parent_columns, 0);
assert.equal(healthy.missing_parent_indexes, 0);
assert.equal(healthy.compatibility_bridge_candidates, 4);
assert.equal(healthy.allowed_compatibility_bridges, 4);
assert.equal(healthy.database_connection_performed, false);
assert.equal(healthy.sql_mutation_performed, false);
assert.equal(healthy.provider_mutation_performed, false);
assert.equal(healthy.credential_access_performed, false);
assert.equal(healthy.data_export_performed, false);
assert.equal(healthy.runtime_mutation_performed, false);
assert.equal(healthy.secrets_included, false);

const withoutTenantGptBridge = structuredClone(policy);
withoutTenantGptBridge.foreign_key_compatibility_chain_contract.bridges = withoutTenantGptBridge.foreign_key_compatibility_chain_contract.bridges.filter((rule) => rule.table !== "tenant_gpt_sso_sessions");
const blocked = inspect(withoutTenantGptBridge, orderedFiles.filter((file) => !file.endsWith("20260812_zzzzzz_mariadb_foreign_key_compatibility_tenant_gpt_sso_sessions.sql")));
assert.equal(blocked.ok, false);
assert.equal(blocked.ready, false);
assert.equal(blocked.type_mismatches, 2);
assert.equal(blocked.unresolved_type_mismatches, 2);
assert.ok(blocked.findings.some((finding) => finding.code === "foreign_key_column_shape_mismatch" && finding.table === "tenant_gpt_sso_sessions"));

console.log(JSON.stringify({
  contract: healthy.contract,
  migration_files_checked: healthy.migration_files_checked,
  statements_checked: healthy.statements_checked,
  healthy: {
    ok: healthy.ok,
    ready: healthy.ready,
    type_mismatches: healthy.type_mismatches,
    missing_parent_indexes: healthy.missing_parent_indexes,
    allowed_compatibility_bridges: healthy.allowed_compatibility_bridges,
  },
  negative_fixture: {
    ok: blocked.ok,
    ready: blocked.ready,
    type_mismatches: blocked.type_mismatches,
    unresolved_type_mismatches: blocked.unresolved_type_mismatches,
  },
}, null, 2));
