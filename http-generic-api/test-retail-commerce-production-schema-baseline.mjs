import assert from "node:assert/strict";
import path from "node:path";
import { collectRetailCommerceProductionSchemaBaseline } from "./scripts/retail-commerce-production-schema-baseline.mjs";

const migrationSql = new Map([
  ["029_sprint32_tenant_commercials.sql", [
    "CREATE TABLE IF NOT EXISTS `credit_balances` (`id` INT);",
    "CREATE TABLE IF NOT EXISTS `credit_ledger` (`id` INT);",
    "CREATE TABLE IF NOT EXISTS `usage_limits` (`id` INT);",
    "CREATE TABLE IF NOT EXISTS `tenant_usage` (`id` INT);",
    "CREATE TABLE IF NOT EXISTS `commercial_profiles` (`id` INT);",
  ].join("\n")],
  ["319_sprint69_dynamic_container_authority_foundation.sql", [
    "CREATE TABLE IF NOT EXISTS `dynamic_container_type_registry` (`id` INT);",
    "CREATE TABLE IF NOT EXISTS `dynamic_containers` (`id` INT);",
    "CREATE TABLE IF NOT EXISTS `dynamic_container_relationships` (`id` INT);",
  ].join("\n")],
]);

const queries = [];
const fakePool = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql === "SELECT DATABASE() AS database_name") return [[{ database_name: "production_database_name_must_not_be_returned" }]];
    if (/INFORMATION_SCHEMA\.TABLES/u.test(sql) && params.length === 1 && params[0] === "governed_migration_ledger") {
      return [[{ TABLE_NAME: "governed_migration_ledger" }]];
    }
    if (/INFORMATION_SCHEMA\.TABLES/u.test(sql)) {
      return [params.map((table) => ({ TABLE_NAME: table, ENGINE: "InnoDB", TABLE_COLLATION: "utf8mb4_unicode_ci" }))];
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/u.test(sql)) {
      return [params.map((table, index) => ({
        TABLE_NAME: table,
        COLUMN_NAME: "id",
        ORDINAL_POSITION: index + 1,
        COLUMN_TYPE: "int",
        IS_NULLABLE: "NO",
        COLUMN_DEFAULT: null,
        EXTRA: "",
      }))];
    }
    if (/INFORMATION_SCHEMA\.STATISTICS/u.test(sql)) {
      return [params.map((table) => ({
        TABLE_NAME: table,
        INDEX_NAME: "PRIMARY",
        COLUMN_NAME: "id",
        SEQ_IN_INDEX: 1,
        NON_UNIQUE: 0,
      }))];
    }
    if (/FROM governed_migration_ledger/u.test(sql)) {
      const migration = params[0];
      const source = migrationSql.get(migration);
      const { createHash } = await import("node:crypto");
      const { splitGovernedMigrationStatements } = await import("./governedMigrationExecutionTool.js");
      return [[{
        run_id: `run-${migration}`,
        migration_file: migration,
        migration_checksum_sha256: createHash("sha256").update(source, "utf8").digest("hex"),
        mode: "apply",
        applied_at: "2026-08-03T00:00:00.000Z",
        statement_count: splitGovernedMigrationStatements(source).length,
        preflight_status: "pass",
        preflight_risk_count: 0,
        secrets_included: 0,
        capability_envelope_id: "envelope-present-but-not-returned",
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
};

const readFile = async (file) => {
  const source = migrationSql.get(path.basename(file));
  if (!source) throw new Error(`Unexpected migration file: ${file}`);
  return source;
};

const originalSha = process.env.GITHUB_SHA;
process.env.GITHUB_SHA = "a".repeat(40);
const result = await collectRetailCommerceProductionSchemaBaseline({
  pool: fakePool,
  readFile,
  now: () => new Date("2026-08-03T12:00:00.000Z"),
});
if (originalSha === undefined) delete process.env.GITHUB_SHA;
else process.env.GITHUB_SHA = originalSha;

assert.equal(result.contract, "mad4b.retail-commerce-production-schema-baseline.v1");
assert.equal(result.authoritative_database_connection_succeeded, true);
assert.equal(result.baseline_collected, true);
assert.equal(result.parity_status, "pass");
assert.equal(result.database_identity_sha256.length, 64);
assert.equal(JSON.stringify(result).includes("production_database_name_must_not_be_returned"), false);
assert.equal(result.migrations.length, 2);
assert(result.migrations.every((entry) => entry.checks.all_expected_tables_present === true));
assert(result.migrations.every((entry) => entry.checks.ledger_entry_found === true));
assert(result.migrations.every((entry) => entry.checks.ledger_checksum_matches_repository === true));
assert(result.migrations.every((entry) => entry.checks.ledger_statement_count_matches_repository === true));
assert(result.migrations.every((entry) => entry.ledger.capability_envelope_id_present === true));
assert.equal(JSON.stringify(result).includes("envelope-present-but-not-returned"), false);
assert.deepEqual(result.gaps, []);
assert.equal(result.safety.row_data_read, false);
assert.equal(result.safety.freeform_sql_accepted, false);
assert.equal(result.safety.migration_dry_run, false);
assert.equal(result.safety.migration_apply, false);
assert.equal(result.safety.database_mutation, false);
assert.equal(result.safety.provider_call, false);
assert.equal(result.safety.credential_values_returned, false);
assert.equal(result.safety.external_send, false);
assert.equal(result.safety.secrets_included, false);
assert(queries.length > 0);
assert(queries.every(({ sql }) => /^SELECT\b/iu.test(sql.trim())), "Every database statement must be SELECT-only");
assert(queries.every(({ sql }) => !/SELECT\s+\*/iu.test(sql)), "SELECT * is forbidden");
assert(queries.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE|CALL|GRANT|REVOKE|LOCK|UNLOCK|SET)\b/iu.test(sql)), "Mutation SQL is forbidden");

console.log(JSON.stringify({
  ok: true,
  test: "retail_commerce_production_schema_baseline",
  query_count: queries.length,
  select_only: true,
  row_data_read: false,
  migration_apply: false,
  database_mutation: false,
  secrets_included: false,
}));
