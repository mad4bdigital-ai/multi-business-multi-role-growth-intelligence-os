import assert from "node:assert/strict";
import path from "node:path";
import {
  collectRetailCommerceProductionSchemaBaseline,
  collectRetailCommerceProductionSchemaRuntimeBaseline,
} from "./scripts/retail-commerce-production-schema-baseline.mjs";

const migrationSql = new Map([
  ["029_sprint32_tenant_commercials.sql", [
    "CREATE TABLE IF NOT EXISTS `credit_balances` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `credit_ledger` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `usage_limits` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `tenant_usage` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `commercial_profiles` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
  ].join("\n")],
  ["319_sprint69_dynamic_container_authority_foundation.sql", [
    "CREATE TABLE IF NOT EXISTS `container_type_registry` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `containers` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `container_relationships` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
  ].join("\n")],
]);

const readFile = async (file) => {
  const source = migrationSql.get(path.basename(file));
  if (!source) throw new Error(`Unexpected migration file: ${file}`);
  return source;
};

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

const originalSha = process.env.GITHUB_SHA;
process.env.GITHUB_SHA = "a".repeat(40);
const directResult = await collectRetailCommerceProductionSchemaBaseline({
  pool: fakePool,
  readFile,
  now: () => new Date("2026-08-03T12:00:00.000Z"),
});
if (originalSha === undefined) delete process.env.GITHUB_SHA;
else process.env.GITHUB_SHA = originalSha;

assert.equal(directResult.contract, "mad4b.retail-commerce-production-schema-baseline.v1");
assert.equal(directResult.collection_source, "direct_database_metadata");
assert.equal(directResult.authoritative_database_connection_succeeded, true);
assert.equal(directResult.baseline_collected, true);
assert.equal(directResult.parity_status, "pass");
assert.equal(directResult.database_identity_sha256.length, 64);
assert.equal(JSON.stringify(directResult).includes("production_database_name_must_not_be_returned"), false);
assert.equal(directResult.migrations.length, 2);
assert(directResult.migrations.every((entry) => entry.checks.all_expected_tables_present === true));
assert(directResult.migrations.every((entry) => entry.checks.ledger_entry_found === true));
assert(directResult.migrations.every((entry) => entry.checks.ledger_checksum_matches_repository === true));
assert(directResult.migrations.every((entry) => entry.checks.ledger_statement_count_matches_repository === true));
assert(directResult.migrations.every((entry) => entry.ledger.capability_envelope_id_present === true));
assert.equal(JSON.stringify(directResult).includes("envelope-present-but-not-returned"), false);
assert.deepEqual(directResult.gaps, []);
assert.equal(directResult.safety.sql_execution, true);
assert.equal(directResult.safety.mutation_sql_execution, false);
assert.equal(directResult.safety.row_data_read, false);
assert.equal(directResult.safety.freeform_sql_accepted, false);
assert.equal(directResult.safety.migration_dry_run, false);
assert.equal(directResult.safety.migration_apply, false);
assert.equal(directResult.safety.database_mutation, false);
assert.equal(directResult.safety.provider_call, false);
assert.equal(directResult.safety.credential_values_returned, false);
assert.equal(directResult.safety.external_send, false);
assert.equal(directResult.safety.secrets_included, false);
assert(queries.length > 0);
assert(queries.every(({ sql }) => /^SELECT\b/iu.test(sql.trim())), "Every database statement must be SELECT-only");
assert(queries.every(({ sql }) => !/SELECT\s+\*/iu.test(sql)), "SELECT * is forbidden");
assert(queries.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE|CALL|GRANT|REVOKE|LOCK|UNLOCK|SET)\b/iu.test(sql)), "Mutation SQL is forbidden");

const runtimeRequests = [];
const backendApiKey = "backend-secret-must-never-be-returned";
const fakeFetch = async (url, init) => {
  runtimeRequests.push({ url, init });
  const body = JSON.parse(init.body);
  assert.equal(body.name, "governed_migration_schema_readback");
  const args = body.tool_args;
  const source = migrationSql.get(args.migration);
  assert(source, `Unexpected runtime migration: ${args.migration}`);
  assert.equal(args.expected_tables.length > 0, true);
  assert.equal(args.expected_columns.length, args.expected_tables.length);
  assert.equal(args.expected_indexes.length, args.expected_tables.length);
  const schema = {
    tables: args.expected_tables.map((table) => ({ TABLE_NAME: table })),
    columns: args.expected_columns.map(({ table, column }, index) => ({
      TABLE_NAME: table,
      COLUMN_NAME: column,
      ORDINAL_POSITION: index + 1,
      COLUMN_TYPE: "int",
      IS_NULLABLE: "NO",
      COLUMN_DEFAULT: null,
      EXTRA: "",
    })),
    indexes: args.expected_indexes.map(({ table, index }) => ({
      TABLE_NAME: table,
      INDEX_NAME: index,
      COLUMN_NAME: "id",
      SEQ_IN_INDEX: 1,
      NON_UNIQUE: 0,
    })),
    rule_conditions: [],
  };
  const readback = {
    ok: true,
    readback_status: "pass",
    migration: args.migration,
    migration_checksum_sha256: args.expected_checksum_sha256,
    statement_count: args.expected_statement_count,
    ledger: {
      found: true,
      run_id: `runtime-${args.migration}`,
      migration_file: args.migration,
      migration_checksum_sha256: args.expected_checksum_sha256,
      mode: "apply",
      applied_at: "2026-08-03T00:00:00.000Z",
      statement_count: args.expected_statement_count,
      preflight_status: "pass",
      preflight_risk_count: 0,
      secrets_included: false,
      capability_envelope_id: "runtime-envelope-must-not-be-returned",
    },
    schema,
    expectations: {
      tables: args.expected_tables,
      columns: args.expected_columns,
      indexes: args.expected_indexes,
      rule_conditions: [],
      missing: { tables: [], columns: [], indexes: [], rule_conditions: [] },
    },
    provider_call_executed: false,
    external_write_executed: false,
    row_data_read: false,
    freeform_sql_accepted: false,
    secrets_included: false,
  };
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ ok: true, result: { status: 200, body: readback } });
    },
  };
};

const runtimeResult = await collectRetailCommerceProductionSchemaRuntimeBaseline({
  readFile,
  fetchFn: fakeFetch,
  backendApiKey,
  runtimeBaseUrl: "https://auth.mad4b.com",
  now: () => new Date("2026-08-03T12:05:00.000Z"),
});

assert.equal(runtimeResult.contract, "mad4b.retail-commerce-production-schema-baseline.v1");
assert.equal(runtimeResult.collection_source, "governed_production_runtime_schema_readback");
assert.equal(runtimeResult.environment, "canonical_production_runtime");
assert.equal(runtimeResult.runtime_base_url, "https://auth.mad4b.com");
assert.equal(runtimeResult.authoritative_database_connection_succeeded, true);
assert.equal(runtimeResult.baseline_collected, true);
assert.equal(runtimeResult.parity_status, "pass");
assert.equal(runtimeResult.database_identity_disclosed, false);
assert.equal(runtimeResult.migrations.length, 2);
assert(runtimeResult.migrations.every((entry) => entry.checks.all_expected_tables_present === true));
assert(runtimeResult.migrations.every((entry) => entry.checks.all_expected_columns_present === true));
assert(runtimeResult.migrations.every((entry) => entry.checks.all_expected_indexes_present === true));
assert(runtimeResult.migrations.every((entry) => entry.checks.ledger_entry_found === true));
assert(runtimeResult.migrations.every((entry) => entry.ledger.capability_envelope_id_present === true));
assert.deepEqual(runtimeResult.gaps, []);
assert.equal(runtimeResult.safety.runtime_tool_calls, 2);
assert.equal(runtimeResult.safety.runtime_tool_name, "governed_migration_schema_readback");
assert.equal(runtimeResult.safety.runtime_api_request_executed, true);
assert.equal(runtimeResult.safety.local_sql_execution, false);
assert.equal(runtimeResult.safety.sql_execution, true);
assert.equal(runtimeResult.safety.mutation_sql_execution, false);
assert.equal(runtimeResult.safety.row_data_read, false);
assert.equal(runtimeResult.safety.migration_apply, false);
assert.equal(runtimeResult.safety.database_mutation, false);
assert.equal(runtimeResult.safety.provider_call, false);
assert.equal(runtimeResult.safety.credential_values_returned, false);
assert.equal(runtimeResult.safety.external_write, false);
assert.equal(runtimeResult.safety.secrets_included, false);
assert.equal(runtimeRequests.length, 2);
assert(runtimeRequests.every(({ url }) => url === "https://auth.mad4b.com/gpt/tools/call"));
assert(runtimeRequests.every(({ init }) => init.method === "POST"));
assert(runtimeRequests.every(({ init }) => init.headers.Authorization === `Bearer ${backendApiKey}`));
const runtimeSerialized = JSON.stringify(runtimeResult);
assert.equal(runtimeSerialized.includes(backendApiKey), false);
assert.equal(runtimeSerialized.includes("runtime-envelope-must-not-be-returned"), false);

await assert.rejects(
  () => collectRetailCommerceProductionSchemaRuntimeBaseline({ readFile, fetchFn: fakeFetch, backendApiKey: "" }),
  /BACKEND_API_KEY is required/u,
);
await assert.rejects(
  () => collectRetailCommerceProductionSchemaRuntimeBaseline({ readFile, fetchFn: fakeFetch, backendApiKey, runtimeBaseUrl: "https://example.com" }),
  /canonical https:\/\/auth\.mad4b\.com origin/u,
);

console.log(JSON.stringify({
  ok: true,
  test: "retail_commerce_production_schema_baseline",
  direct_query_count: queries.length,
  runtime_tool_calls: runtimeRequests.length,
  direct_and_runtime_sources_verified: true,
  select_only: true,
  row_data_read: false,
  migration_apply: false,
  database_mutation: false,
  secrets_included: false,
}));
