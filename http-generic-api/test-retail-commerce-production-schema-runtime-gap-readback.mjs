import assert from "node:assert/strict";
import path from "node:path";
import { collectRetailCommerceProductionSchemaRuntimeBaseline } from "./scripts/retail-commerce-production-schema-baseline.mjs";

const fixtureMigrations = new Map([
  ["029_sprint32_tenant_commercials.sql", [
    "CREATE TABLE IF NOT EXISTS `credit_balances` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `commercial_profiles` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
  ].join("\n")],
  ["319_sprint69_dynamic_container_authority_foundation.sql", [
    "CREATE TABLE IF NOT EXISTS `container_type_registry` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "CREATE TABLE IF NOT EXISTS `containers` (`id` INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
  ].join("\n")],
]);

const fixtureReadFile = async (file) => {
  const source = fixtureMigrations.get(path.basename(file));
  if (!source) throw new Error(`Unexpected migration file: ${file}`);
  return source;
};

function buildReadback(args, { gap = false } = {}) {
  const missingTable = gap ? args.expected_tables[0] : null;
  const tables = args.expected_tables
    .filter((table) => table !== missingTable)
    .map((table) => ({ TABLE_NAME: table }));
  const columns = args.expected_columns
    .filter(({ table }) => table !== missingTable)
    .map(({ table, column }, index) => ({
      TABLE_NAME: table,
      COLUMN_NAME: column,
      ORDINAL_POSITION: index + 1,
      COLUMN_TYPE: "int",
      IS_NULLABLE: "NO",
      COLUMN_DEFAULT: null,
      EXTRA: "",
    }));
  const indexes = args.expected_indexes
    .filter(({ table }) => table !== missingTable)
    .map(({ table, index }) => ({
      TABLE_NAME: table,
      INDEX_NAME: index,
      COLUMN_NAME: "id",
      SEQ_IN_INDEX: 1,
      NON_UNIQUE: 0,
    }));
  return {
    ok: !gap,
    readback_status: gap ? "fail" : "pass",
    migration: args.migration,
    migration_checksum_sha256: args.expected_checksum_sha256,
    statement_count: args.expected_statement_count,
    ledger: gap ? { found: false } : {
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
      capability_envelope_id: "raw-envelope-id-must-not-be-returned",
    },
    schema: { tables, columns, indexes, rule_conditions: [] },
    expectations: {
      tables: args.expected_tables,
      columns: args.expected_columns,
      indexes: args.expected_indexes,
      rule_conditions: [],
      missing: {
        tables: missingTable ? [missingTable] : [],
        columns: missingTable ? args.expected_columns.filter(({ table }) => table === missingTable) : [],
        indexes: missingTable ? args.expected_indexes.filter(({ table }) => table === missingTable) : [],
        rule_conditions: [],
      },
    },
    provider_call_executed: false,
    external_write_executed: false,
    row_data_read: false,
    freeform_sql_accepted: false,
    secrets_included: false,
  };
}

const gapRequests = [];
const gapFetch = async (url, init) => {
  const request = JSON.parse(init.body);
  const args = request.tool_args;
  const gap = gapRequests.length === 0;
  gapRequests.push({ url, request, authorization: init.headers.Authorization });
  const readback = buildReadback(args, { gap });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        ok: !gap,
        result: { status: 200, body: readback },
      });
    },
  };
};

const backendApiKey = "runtime-gap-secret-must-not-be-returned";
const gapResult = await collectRetailCommerceProductionSchemaRuntimeBaseline({
  readFile: fixtureReadFile,
  fetchFn: gapFetch,
  backendApiKey,
  runtimeBaseUrl: "https://auth.mad4b.com",
  now: () => new Date("2026-08-03T12:10:00.000Z"),
});

assert.equal(gapRequests.length, 2);
assert.equal(gapResult.authoritative_database_connection_succeeded, true);
assert.equal(gapResult.baseline_collected, true);
assert.equal(gapResult.parity_status, "gaps_detected");
assert(gapResult.gaps.some((entry) => entry.code === "missing_expected_tables"));
assert(gapResult.gaps.some((entry) => entry.code === "migration_ledger_entry_missing"));
assert.equal(gapResult.migrations[0].runtime_readback_status, "fail");
assert.equal(gapResult.migrations[1].runtime_readback_status, "pass");
assert.equal(gapResult.safety.sql_execution, true);
assert.equal(gapResult.safety.local_sql_execution, false);
assert.equal(gapResult.safety.mutation_sql_execution, false);
assert.equal(gapResult.safety.row_data_read, false);
assert.equal(gapResult.safety.migration_apply, false);
assert.equal(gapResult.safety.database_mutation, false);
assert.equal(gapResult.safety.provider_call, false);
assert.equal(gapResult.safety.external_write, false);
assert.equal(gapResult.safety.secrets_included, false);
const gapSerialized = JSON.stringify(gapResult);
assert.equal(gapSerialized.includes(backendApiKey), false);
assert.equal(gapSerialized.includes("raw-envelope-id-must-not-be-returned"), false);

await assert.rejects(
  () => collectRetailCommerceProductionSchemaRuntimeBaseline({
    readFile: fixtureReadFile,
    backendApiKey,
    runtimeBaseUrl: "https://auth.mad4b.com",
    fetchFn: async () => ({
      ok: false,
      status: 503,
      async text() {
        return JSON.stringify({ ok: false, error: { code: "runtime_unavailable" } });
      },
    }),
  }),
  /failed with HTTP 503/u,
);

const realMigrationRequests = [];
const mirrorFetch = async (url, init) => {
  const request = JSON.parse(init.body);
  const args = request.tool_args;
  realMigrationRequests.push({ url, args });
  const readback = buildReadback(args);
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ ok: true, result: { status: 200, body: readback } });
    },
  };
};

const realMigrationResult = await collectRetailCommerceProductionSchemaRuntimeBaseline({
  fetchFn: mirrorFetch,
  backendApiKey,
  runtimeBaseUrl: "https://auth.mad4b.com",
  now: () => new Date("2026-08-03T12:15:00.000Z"),
});

assert.equal(realMigrationResult.parity_status, "pass");
assert.equal(realMigrationRequests.length, 2);
const commercialRequest = realMigrationRequests.find(({ args }) => args.migration === "029_sprint32_tenant_commercials.sql");
const containerRequest = realMigrationRequests.find(({ args }) => args.migration === "319_sprint69_dynamic_container_authority_foundation.sql");
assert(commercialRequest);
assert(containerRequest);
assert.equal(commercialRequest.args.expected_tables.length, 5);
assert(commercialRequest.args.expected_columns.length > commercialRequest.args.expected_tables.length);
assert(commercialRequest.args.expected_indexes.length >= commercialRequest.args.expected_tables.length);
assert(containerRequest.args.expected_tables.length > 10);
assert(containerRequest.args.expected_columns.length > containerRequest.args.expected_tables.length);
assert(containerRequest.args.expected_indexes.length > containerRequest.args.expected_tables.length);
assert(realMigrationRequests.every(({ url }) => url === "https://auth.mad4b.com/gpt/tools/call"));

console.log(JSON.stringify({
  ok: true,
  test: "retail_commerce_production_schema_runtime_gap_readback",
  authoritative_gap_readback_preserved: true,
  transport_failure_without_readback_rejected: true,
  real_migration_contracts_parsed: true,
  runtime_tool_calls: realMigrationRequests.length,
  row_data_read: false,
  migration_apply: false,
  database_mutation: false,
  secrets_included: false,
}));
