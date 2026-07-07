import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runGovernedMigrationSchemaReadback } from "./governedMigrationSchemaReadbackTool.js";

const sql = [
  "ALTER TABLE operational_alerts ADD COLUMN IF NOT EXISTS operation_fingerprint_sha256 CHAR(64) NULL;",
  "CREATE TABLE IF NOT EXISTS operational_alert_lifecycle_events (event_id VARCHAR(36));",
  "UPDATE operational_alert_rule_registry SET condition_key = 'execution_status=failed AND no later success for the same operation and resource fingerprints' WHERE rule_key = 'alert_execution_failed';",
].join("\n");
const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
const executedSql = [];

const fakePool = {
  async query(query, params = []) {
    executedSql.push({ query, params });
    if (/FROM INFORMATION_SCHEMA\.TABLES/i.test(query)) {
      return [[{ TABLE_NAME: "operational_alert_lifecycle_events" }]];
    }
    if (/FROM INFORMATION_SCHEMA\.COLUMNS/i.test(query)) {
      return [[
        { TABLE_NAME: "operational_alerts", COLUMN_NAME: "operation_fingerprint_sha256", COLUMN_TYPE: "char(64)", IS_NULLABLE: "YES", COLUMN_DEFAULT: null },
        { TABLE_NAME: "operational_alerts", COLUMN_NAME: "resource_fingerprint_sha256", COLUMN_TYPE: "char(64)", IS_NULLABLE: "YES", COLUMN_DEFAULT: null },
        { TABLE_NAME: "operational_alerts", COLUMN_NAME: "lifecycle_revision", COLUMN_TYPE: "bigint(20) unsigned", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0" },
        { TABLE_NAME: "operational_alert_lifecycle_events", COLUMN_NAME: "event_id", COLUMN_TYPE: "varchar(36)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null },
        { TABLE_NAME: "operational_alert_lifecycle_events", COLUMN_NAME: "alert_id", COLUMN_TYPE: "varchar(36)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null },
        { TABLE_NAME: "operational_alert_lifecycle_events", COLUMN_NAME: "idempotency_key", COLUMN_TYPE: "varchar(191)", IS_NULLABLE: "YES", COLUMN_DEFAULT: null },
        { TABLE_NAME: "operational_alert_lifecycle_events", COLUMN_NAME: "secrets_included", COLUMN_TYPE: "tinyint(1)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0" },
      ]];
    }
    if (/FROM INFORMATION_SCHEMA\.STATISTICS/i.test(query)) {
      return [[
        { TABLE_NAME: "operational_alerts", INDEX_NAME: "idx_operational_alert_operation_resource", COLUMN_NAME: "operation_fingerprint_sha256", SEQ_IN_INDEX: 1, NON_UNIQUE: 1 },
        { TABLE_NAME: "operational_alerts", INDEX_NAME: "idx_operational_alert_lifecycle_revision", COLUMN_NAME: "alert_id", SEQ_IN_INDEX: 1, NON_UNIQUE: 1 },
        { TABLE_NAME: "operational_alert_lifecycle_events", INDEX_NAME: "uq_operational_alert_lifecycle_event_idempotency", COLUMN_NAME: "alert_id", SEQ_IN_INDEX: 1, NON_UNIQUE: 0 },
        { TABLE_NAME: "operational_alert_lifecycle_events", INDEX_NAME: "idx_operational_alert_lifecycle_event_operation_resource", COLUMN_NAME: "operation_fingerprint_sha256", SEQ_IN_INDEX: 1, NON_UNIQUE: 1 },
      ]];
    }
    if (/FROM governed_migration_ledger/i.test(query)) {
      return [[{
        run_id: "run-1",
        migration_file: "20260704_operational_alert_lifecycle_fingerprints.sql",
        migration_checksum_sha256: checksum,
        mode: "apply",
        applied_at: "2026-07-07T00:00:00.000Z",
        statement_count: 3,
        preflight_status: "pass",
        preflight_risk_count: 0,
        secrets_included: 0,
        capability_envelope_id: "env-1",
      }]];
    }
    if (/FROM operational_alert_rule_registry/i.test(query)) {
      return [[{
        rule_key: "alert_execution_failed",
        source_type: "execution_log",
        condition_key: "execution_status=failed AND no later success for the same operation and resource fingerprints",
        status: "active",
        updated_at: "2026-07-07T00:00:00.000Z",
      }]];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  },
};

const readFile = async () => sql;
const result = await runGovernedMigrationSchemaReadback({
  migration: "20260704_operational_alert_lifecycle_fingerprints.sql",
  expected_checksum_sha256: checksum,
  expected_statement_count: 3,
}, { pool: fakePool, readFile, migrationsDir: "/tmp" });

assert.equal(result.ok, true);
assert.equal(result.readback_status, "pass");
assert.equal(result.row_data_read, false);
assert.equal(result.freeform_sql_accepted, false);
assert.equal(result.provider_call_executed, false);
assert.equal(result.external_write_executed, false);
assert.equal(result.secrets_included, false);
assert.equal(result.ledger.found, true);
assert.deepEqual(result.expectations.missing, { tables: [], columns: [], indexes: [], rule_conditions: [] });
assert(executedSql.every(({ query }) => !/SELECT\s+\*/i.test(query)), "readback tool must not use SELECT *");
assert(executedSql.every(({ query }) => !/\bDELETE\b|\bUPDATE\b|\bINSERT\b|\bALTER\b|\bDROP\b/i.test(query)), "readback tool must not execute mutation SQL");

await assert.rejects(
  () => runGovernedMigrationSchemaReadback({
    migration: "20260704_operational_alert_lifecycle_fingerprints.sql",
    expected_checksum_sha256: "0".repeat(64),
    expected_statement_count: 3,
  }, { pool: fakePool, readFile, migrationsDir: "/tmp" }),
  /checksum/i
);

await assert.rejects(
  () => runGovernedMigrationSchemaReadback({
    migration: "20260704_operational_alert_lifecycle_fingerprints.sql",
    expected_checksum_sha256: checksum,
    expected_statement_count: 3,
    expected_columns: [{ table: "operational_alerts;DROP", column: "x" }],
  }, { pool: fakePool, readFile, migrationsDir: "/tmp" }),
  /expected_columns\.table/
);

const authorizationSource = readFileSync("governedMigrationAuthorizationBootstrap.js", "utf8");
const applyPolicySource = readFileSync("governedMigrationApplyPolicyBootstrap.js", "utf8");
assert.match(authorizationSource, /GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY as MIGRATION_EXECUTOR_APPLY_POLICY/);
assert.doesNotMatch(authorizationSource, /const MIGRATION_EXECUTOR_APPLY_POLICY = Object\.freeze/);
assert.match(applyPolicySource, /operation_intent:\s*"governed_migration_execute"/);
assert.match(applyPolicySource, /runtime_surface:\s*"auth_host"/);
assert.match(applyPolicySource, /governed_runner_only:\s*true/);
assert.doesNotMatch(applyPolicySource, /operation_intent:\s*"governed_migration_apply"/);
assert.doesNotMatch(applyPolicySource, /runtime_surface:\s*"governed_migration_execute"/);

const routesSource = readFileSync("routes/gptToolsRoutes.js", "utf8");
assert.match(routesSource, /name: "governed_migration_schema_readback"/);
assert.match(routesSource, /runGovernedMigrationSchemaReadback/);

console.log("governed migration schema readback tool tests passed");
