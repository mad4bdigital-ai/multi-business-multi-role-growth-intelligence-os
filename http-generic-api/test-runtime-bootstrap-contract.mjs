import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  assertBaselineDatabaseEligible,
  buildPlan,
  classifyMysqlError,
  runBootstrap,
  sanitizeBootstrapError,
  selectMigration,
  validateSchemaBundleManifest,
  sha256Hex,
} from "./runtimeBootstrapContract.js";
import { getRuntimeBootstrapStatus as readStartupStatus } from "./runtimeBootstrapStatus.js";

const contract = JSON.parse(fs.readFileSync(new URL("./config/runtime-bootstrap-contract.json", import.meta.url), "utf8"));
const recoveryContract = JSON.parse(fs.readFileSync(new URL("../.github/ops/production-runtime-recovery-routes.json", import.meta.url), "utf8"));
const EXPECTED_SHA = "f47024b57098c7a1e236968b5ee238618cf5153f";
const TARGET_DATABASE = "growth_runtime";
const TARGET_KEY = "production-runtime";
const TARGET = {
  key: TARGET_KEY,
  database: TARGET_DATABASE,
  database_sha256: sha256Hex(TARGET_DATABASE),
  target_fingerprint: sha256Hex(`mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os:Production:${TARGET_KEY}:${TARGET_DATABASE}`),
  repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  branch: "Production",
  environment: "production",
  principal: "runtime_user",
  principal_host: "localhost",
};

function envFor(migration = "20260815_custom_gpt_mcp_catalog_levels.sql", mode = "dry_run") {
  return {
    BOOTSTRAP_MODE: mode,
    BOOTSTRAP_EXPECTED_SHA: EXPECTED_SHA,
    BOOTSTRAP_EXPECTED_BRANCH: "Production",
    BOOTSTRAP_EXPECTED_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    BOOTSTRAP_TARGET_KEY: TARGET_KEY,
    BOOTSTRAP_TARGET_DATABASE: TARGET_DATABASE,
    BOOTSTRAP_MIGRATION: migration,
    RUNTIME_BOOTSTRAP_TARGETS_JSON: JSON.stringify([TARGET]),
    MYSQL_BOOTSTRAP_HOST: "db.internal",
    MYSQL_BOOTSTRAP_USER: "bootstrap_operator",
    MYSQL_BOOTSTRAP_PASSWORD: "bootstrap-secret-for-test-only",
    MYSQL_BOOTSTRAP_DATABASE: TARGET_DATABASE,
    MYSQL_BOOTSTRAP_PORT: "3306",
    DB_USER: "runtime_user",
    DB_PASSWORD: "runtime-secret-for-test-only",
  };
}

function grantRows() {
  return TARGET ? [
    ...contract.grant_policy.required_tables.flatMap((table) => [
      { TABLE_SCHEMA: TARGET_DATABASE, TABLE_NAME: table, PRIVILEGE_TYPE: "SELECT", IS_GRANTABLE: "NO" },
      { TABLE_SCHEMA: TARGET_DATABASE, TABLE_NAME: table, PRIVILEGE_TYPE: "INSERT", IS_GRANTABLE: "NO" },
      { TABLE_SCHEMA: TARGET_DATABASE, TABLE_NAME: table, PRIVILEGE_TYPE: "UPDATE", IS_GRANTABLE: "NO" },
    ]),
  ] : [];
}

function fakeConnection({ tableCount = 7, missingTables = [] } = {}) {
  const queryCalls = [];
  const executeCalls = [];
  const requiredTables = new Set([
    "admin_platform_endpoint_tools",
    "tenant_platform_endpoint_tools",
    "governed_migration_ledger",
    ...contract.grant_policy.required_tables,
  ]);
  const connection = {
    query: async (sql) => {
      queryCalls.push(String(sql));
      return [[]];
    },
    execute: async (sql, params = []) => {
      executeCalls.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes("SCHEMATA")) return [[{ SCHEMA_NAME: TARGET_DATABASE }]];
      if (text.includes("COUNT(*) AS table_count")) return [[{ table_count: String(tableCount) }]];
      if (text.includes("TABLE_NAME = 'governed_migration_ledger'") && text.includes("information_schema.TABLES")) return [[{ TABLE_NAME: "governed_migration_ledger" }]];
      if (text.includes("TABLE_NAME = ?") && text.includes("information_schema.TABLES")) {
        const table = String(params[1] || "");
        return [...requiredTables].includes(table) && !missingTables.includes(table)
          ? [[{ TABLE_NAME: table }]]
          : [[]];
      }
      if (text.includes("TABLE_NAME = 'governed_migration_ledger'") && text.includes("information_schema.COLUMNS")) {
        return [["run_id", "migration_file", "migration_checksum_sha256", "applied_at", "applied_by", "runner_version", "mode", "statement_count", "preflight_status", "preflight_risk_count", "requirements_json", "results_json", "before_schema_objects_json", "after_schema_objects_json", "metadata_json", "secrets_included"].map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      }
      if (text.includes("information_schema.COLUMNS") && text.includes("COLUMN_NAME IN")) {
        return [contract.postconditions["20260815_custom_gpt_mcp_catalog_levels.sql"].map((check) => ({ COLUMN_NAME: check.column || check.key_column || check.value_column })).filter((row) => row.COLUMN_NAME)];
      }
      if (text.includes("information_schema.COLUMNS")) return [[{ COLUMN_NAME: String(params[2] || "mcp_catalog_level") }]];
      if (text.includes("information_schema.STATISTICS")) return [[{ INDEX_NAME: String(params[2] || "idx_enabled_mcp_level_sort") }]];
      if (text.includes("FROM governed_migration_ledger")) return [[]];
      if (text.includes("SELECT `mcp_catalog_level` AS observed_value")) return [[{ observed_value: "growth_feedback" }]];
      if (text.includes("USER_PRIVILEGES")) return [[]];
      if (text.includes("SCHEMA_PRIVILEGES")) return [[]];
      if (text.includes("TABLE_PRIVILEGES")) return [grantRows()];
      return [[]];
    },
    escape(value) { return `'${String(value).replaceAll("'", "\\'")}'`; },
    async end() {},
    queryCalls,
    executeCalls,
  };
  return connection;
}

test("Hostinger and GitHub recovery contracts share migration and grant pins", () => {
  for (const migration of ["225_sprint67_capability_resolution_envelope_ledger.sql", "1048_transport_response_chunk_schema_recovery.sql", "20260815_custom_gpt_mcp_catalog_levels.sql"]) {
    const hostinger = contract.migrations[migration];
    const github = recoveryContract.recovery_migrations[migration];
    assert.equal(hostinger.sha256, github.sha256);
    assert.equal(hostinger.statement_count, github.statement_count);
    assert.deepEqual(hostinger.allowed_modes, github.allowed_modes);
    assert.equal(hostinger.role, github.incident_role);
  }
  assert.deepEqual(contract.grant_policy.required_tables, recoveryContract.grant_policy.required_tables);
  assert.deepEqual(contract.grant_policy.required_operations, recoveryContract.grant_policy.required_operations);
});

test("plan mode is the default and performs no DB connection or mutation", () => {
  const result = buildPlan({ BOOTSTRAP_MODE: "plan" }, contract);
  assert.equal(result.status, "bootstrap_not_executed");
  assert.equal(result.database_connection_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.auto_apply, false);
});

test("start, prestart, and Docker remain free of automatic bootstrap execution", () => {
  const apiPackage = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const rootPackage = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const dockerfile = fs.readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
  assert.equal(apiPackage.scripts.start, "node server.js");
  assert.doesNotMatch(String(apiPackage.scripts.prestart || ""), /runtime-bootstrap|migration.*apply|grant/i);
  assert.doesNotMatch(String(rootPackage.scripts.start || ""), /runtime-bootstrap|migration.*apply|grant/i);
  assert.doesNotMatch(dockerfile, /runtime-bootstrap|migration.*apply|grant/i);
});

test("runtime credentials cannot substitute for dedicated bootstrap credentials", () => {
  const env = envFor();
  env.MYSQL_BOOTSTRAP_USER = env.DB_USER;
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_credential_reuse_denied");
});

test("verification-only migrations cannot be applied", () => {
  assert.throws(
    () => selectMigration(contract, "225_sprint67_capability_resolution_envelope_ledger.sql", "apply"),
    (error) => error.code === "bootstrap_migration_mode_denied",
  );
  assert.throws(
    () => selectMigration(contract, "1048_transport_response_chunk_schema_recovery.sql", "apply"),
    (error) => error.code === "bootstrap_migration_mode_denied",
  );
});

test("baseline eligibility is zero-table-only", () => {
  assert.equal(assertBaselineDatabaseEligible(0), true);
  assert.throws(() => assertBaselineDatabaseEligible(1), (error) => error.code === "bootstrap_baseline_nonempty_denied");
});

test("20260815 requires both catalog prerequisite tables on a nonempty database", async () => {
  const env = envFor();
  const connection = fakeConnection({ tableCount: 7, missingTables: ["tenant_platform_endpoint_tools"] });
  await assert.rejects(
    () => runBootstrap({ env, contract, connectionFactory: async () => connection }),
    (error) => error.code === "bootstrap_migration_prerequisite_missing",
  );
  assert.equal(connection.queryCalls.some((sql) => /ALTER TABLE|UPDATE|INSERT/i.test(sql)), false);
});

test("dry-run returns structured schema, ledger, and grant evidence without mutation", async () => {
  const env = envFor();
  const connection = fakeConnection();
  const result = await runBootstrap({ env, contract, connectionFactory: async () => connection });
  assert.equal(result.status, "dry_run_complete");
  assert.equal(result.database_connection_performed, true);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.migration_apply_performed, false);
  assert.equal(result.grant_mutation_performed, false);
  assert.equal(result.ledger.found, false);
  assert.equal(result.postconditions.ready, true);
  assert.equal(result.grant_readback.ready, true);
  assert.equal(connection.queryCalls.some((sql) => /ALTER TABLE|UPDATE|INSERT|GRANT/i.test(sql)), false);
});

test("dry-run supports an explicitly allowlisted separate governance database", async () => {
  const env = envFor();
  const splitTarget = {
    ...TARGET,
    governance_database: "growth_governance",
    governance_database_sha256: sha256Hex("growth_governance"),
  };
  env.RUNTIME_BOOTSTRAP_TARGETS_JSON = JSON.stringify([splitTarget]);
  env.BOOTSTRAP_GOVERNANCE_DATABASE = "growth_governance";
  const connections = [fakeConnection(), fakeConnection()];
  let opened = 0;
  const result = await runBootstrap({ env, contract, connectionFactory: async () => connections[opened++] });
  assert.equal(opened, 2);
  assert.equal(result.status, "dry_run_complete");
  assert.equal(result.grant_readback.ready, true);
  assert.equal(result.database_mutation_performed, false);
});

test("schema-ready without ledger remains apply-required and is never record-only reconciled", async () => {
  const env = envFor();
  const connection = fakeConnection();
  const result = await runBootstrap({ env, contract, connectionFactory: async () => connection });
  assert.equal(result.ledger.found, false);
  assert.equal(result.postconditions.ready, true);
  assert.equal(result.migration_apply_performed, false);
  assert.equal(result.status, "dry_run_complete");
});

test("explicit apply executes only 20260815 and six-table least-privilege grants with postcondition readback", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply");
  env.BOOTSTRAP_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_BOOTSTRAP:${EXPECTED_SHA}:${TARGET_KEY}`;
  const connection = fakeConnection({ tableCount: 7 });
  const result = await runBootstrap({ env, contract, connectionFactory: async () => connection });
  assert.equal(result.status, "apply_complete");
  assert.equal(result.database_mutation_performed, true);
  assert.equal(result.migration_apply_performed, true);
  assert.equal(result.grant_mutation_performed, true);
  assert.equal(result.postconditions.ready, true);
  assert.equal(result.grants.grant_readback.ready, true);
  const grants = connection.queryCalls.filter((sql) => /^GRANT /i.test(sql));
  assert.equal(grants.length, contract.grant_policy.required_tables.length);
  for (const table of contract.grant_policy.required_tables) {
    const quotedTable = "`" + table + "`";
    assert.equal(grants.filter((sql) => sql.includes(quotedTable)).length, 1);
  }
  assert.equal(grants.every((sql) => /^GRANT SELECT, INSERT, UPDATE ON /i.test(sql)), true);
});

test("apply confirmation is exact and blocks before opening a connection", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply");
  env.BOOTSTRAP_CONFIRMATION = "APPLY_HOSTINGER_RUNTIME_BOOTSTRAP:wrong:production-runtime";
  let connectionOpened = false;
  await assert.rejects(
    () => runBootstrap({ env, contract, connectionFactory: async () => { connectionOpened = true; return fakeConnection(); } }),
    (error) => error.code === "bootstrap_confirmation_mismatch",
  );
  assert.equal(connectionOpened, false);
});

test("zero-table apply stops before mutation when canonical bundle is absent", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply");
  env.BOOTSTRAP_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_BOOTSTRAP:${EXPECTED_SHA}:${TARGET_KEY}`;
  const connection = fakeConnection({ tableCount: 0 });
  await assert.rejects(
    () => runBootstrap({ env, contract, connectionFactory: async () => connection }),
    (error) => error.code === "bootstrap_bundle_manifest_unreadable",
  );
  assert.equal(connection.queryCalls.some((sql) => /CREATE|ALTER|UPDATE|INSERT|GRANT/i.test(sql)), false);
});

test("empty-database bundle is blocked when manifest or pinned artifact is absent/mismatched", () => {
  const missingPath = path.join(fs.mkdtempSync(path.join("/tmp", "runtime-bootstrap-test-")), "staging-schema-bundle-manifest.json");
  assert.throws(() => validateSchemaBundleManifest(missingPath, EXPECTED_SHA, contract), (error) => error.code === "bootstrap_bundle_manifest_unreadable");

  const directory = fs.mkdtempSync(path.join("/tmp", "runtime-bootstrap-test-"));
  const bundlePath = path.join(directory, "runtime.schema.sql.gz");
  fs.writeFileSync(bundlePath, zlib.gzipSync("CREATE TABLE `safe_runtime_fixture` (`id` INT);\n"));
  const tables = contract.baseline_bundle.required_runtime_tables;
  const manifestPath = path.join(directory, "staging-schema-bundle-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    contract: "mad4b.staging.schema-bundle-output.v1",
    source_commit: EXPECTED_SHA,
    schema_only: true,
    production_accessed: false,
    provider_accessed: false,
    data_exported: false,
    secrets_included: false,
    roles: { runtime: { bundle_file: "runtime.schema.sql.gz", tables, table_count: tables.length, sha256: "0".repeat(64) } },
  }));
  assert.throws(() => validateSchemaBundleManifest(manifestPath, EXPECTED_SHA, contract), (error) => error.code === "bootstrap_bundle_checksum_mismatch");
});

test("error taxonomy separates missing schema from privilege denied", () => {
  assert.equal(classifyMysqlError({ code: "ER_BAD_FIELD_ERROR" }), "missing_schema");
  assert.equal(classifyMysqlError({ code: "ER_NO_SUCH_TABLE" }), "missing_schema");
  assert.equal(classifyMysqlError({ code: "ER_TABLEACCESS_DENIED_ERROR" }), "privilege_denied");
  const sanitized = sanitizeBootstrapError({ code: "ER_TABLEACCESS_DENIED_ERROR", message: "denied", details: { password: "hidden", mysql_code: "ER_TABLEACCESS_DENIED_ERROR" } });
  assert.equal(sanitized.category, "privilege_denied");
  assert.equal(sanitized.details.password, undefined);
  assert.equal(sanitized.secrets_included, false);
});

test("startup status is DB-independent and distinguishes hook absence from bootstrap required", () => {
  const absent = readStartupStatus({});
  assert.equal(absent.status, "bootstrap_not_configured");
  assert.equal(absent.database_connection_performed, false);
  assert.equal(absent.migration_apply_performed, false);
  const required = readStartupStatus({ RUNTIME_BOOTSTRAP_HOOK: "hostinger-runtime-bootstrap-v1" });
  assert.equal(required.status, "bootstrap_required");
  assert.equal(required.hook.auto_apply, false);
  assert.equal(required.bootstrap_credentials.values_exposed, false);
});

test("normal GPT tools remain protected and catalog DB-backed", () => {
  const source = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
  assert.match(source, /requireBackendApiKey/);
  assert.match(source, /mcp_catalog_level/);
  assert.match(source, /getPool/);
});

console.log("runtime bootstrap contract tests loaded");
