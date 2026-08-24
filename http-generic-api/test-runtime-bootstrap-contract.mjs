import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  assertBaselineDatabaseEligible,
  buildPlan,
  classifyMysqlError,
  runBootstrap,
  normalizeMode,
  resolveRoleBootstrapCredentials,
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
  target_fingerprint: sha256Hex(`mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os:Production:${TARGET_KEY}:${TARGET_DATABASE}:${TARGET_DATABASE}:runtime_user:localhost`),
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

test("repository allowlist derives database binding from target key without caller database inputs", () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "dry_run");
  delete env.BOOTSTRAP_TARGET_DATABASE;
  delete env.MYSQL_BOOTSTRAP_DATABASE;
  const plan = buildPlan(env, contract);
  assert.equal(plan.target_key, TARGET_KEY);
  assert.equal(plan.target_binding.database_sha256, sha256Hex(TARGET_DATABASE));
  assert.equal(plan.target_binding.raw_values_exposed, false);
  assert.equal(plan.database_connection_performed, false);
});

function grantRows() {
  return TARGET ? [
    ...contract.grant_policy.required_tables.flatMap((table) => [
      { TABLE_SCHEMA: TARGET_DATABASE, TABLE_NAME: table, PRIVILEGE_TYPE: "SELECT", IS_GRANTABLE: "NO" },
      { TABLE_SCHEMA: TARGET_DATABASE, TABLE_NAME: table, PRIVILEGE_TYPE: "INSERT", IS_GRANTABLE: "NO" },
      { TABLE_SCHEMA: TARGET_DATABASE, TABLE_NAME: table, PRIVILEGE_TYPE: "UPDATE", IS_GRANTABLE: "NO" },
    ]),
  ] : [];
}

function fakeConnection({ tableCount = 7, missingTables = [], ledgerFound = false, failMutationAt = null, failGrantAt = null } = {}) {
  const queryCalls = [];
  const executeCalls = [];
  let mutationQueries = 0;
  let grantsIssued = 0;
  let recordedLedger = ledgerFound;
  const requiredTables = new Set([
    "admin_platform_endpoint_tools",
    "tenant_platform_endpoint_tools",
    "governed_migration_ledger",
    "capability_resolution_envelope_ledger",
    "governed_tool_response_chunks",
    "platform_runtime_config",
    ...contract.grant_policy.required_tables,
  ]);
  const currentGrantRows = grantRows();
  const connection = {
    query: async (sql) => {
      const text = String(sql).trim();
      queryCalls.push(text);
      if (/^GRANT /i.test(text)) {
        grantsIssued += 1;
        if (failGrantAt === grantsIssued) {
          const error = new Error("simulated grant failure");
          error.code = "ER_TABLEACCESS_DENIED_ERROR";
          throw error;
        }
      } else if (/^(?:CREATE|ALTER|UPDATE|INSERT|DELETE|REPLACE|SET|PREPARE|EXECUTE|DEALLOCATE)\b/i.test(text)) {
        mutationQueries += 1;
        if (failMutationAt === mutationQueries) {
          const error = new Error("simulated mutation failure");
          error.code = "ER_UNKNOWN_ERROR";
          throw error;
        }
      }
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
      if (text.includes("information_schema.COLUMNS")) return [[{ COLUMN_NAME: String(params[2] || "mcp_catalog_level") }]];
      if (text.includes("information_schema.STATISTICS")) return [[{ INDEX_NAME: String(params[2] || "idx_enabled_mcp_level_sort") }]];
      if (text.includes("INSERT INTO governed_migration_ledger")) {
        recordedLedger = true;
        return [{ affectedRows: 1 }];
      }
      if (text.includes("FROM governed_migration_ledger")) {
        const requestedMigration = String(params[0] || "20260815_custom_gpt_mcp_catalog_levels.sql");
        return recordedLedger ? [[{ run_id: "existing-run", migration_checksum_sha256: contract.migrations[requestedMigration].sha256, mode: "apply", applied_at: "2026-08-15T00:00:00.000Z" }]] : [[]];
      }
      if (text.includes("v_governed_response_chunk_transport_schema_readiness")) return [[{ observed_value: "ready" }]];
      if (text.includes("FROM `platform_runtime_config`")) return [[{ observed_value: String(params[0] || "capability_resolution_envelope_ledger_policy_v1") }]];
      if (text.includes("FROM `admin_platform_endpoint_tools`")) return [[{ observed_value: "capability_resolution_envelope_create" }]];
      if (text.includes("SELECT `mcp_catalog_level` AS observed_value")) return [[{ observed_value: "growth_feedback" }]];
      if (text.includes("USER_PRIVILEGES")) return [[]];
      if (text.includes("SCHEMA_PRIVILEGES")) return [[]];
      if (text.includes("TABLE_PRIVILEGES")) return [currentGrantRows];
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
    if (hostinger.role === "verification_only") {
      assert.deepEqual(hostinger.allowed_modes, ["dry_run"]);
      assert.deepEqual(github.allowed_modes, ["dry_run"]);
    } else {
      assert.deepEqual([...hostinger.allowed_modes].sort(), ["dry_run", "apply_grants", "apply_migration"].sort());
      assert.deepEqual([...github.allowed_modes].sort(), ["dry_run", "apply"].sort());
    }
    assert.equal(hostinger.role, github.incident_role);
  }
  assert.deepEqual(contract.grant_policy.required_tables, recoveryContract.grant_policy.required_tables);
  assert.deepEqual(contract.grant_policy.required_operations, recoveryContract.grant_policy.required_operations);
});

test("every non-plan bootstrap mode requires exact SHA metadata", () => {
  const allowedModes = new Set(contract.execution_policy.allowed_modes);
  const exactShaModes = new Set(contract.source_binding.exact_sha_required_for);
  assert.deepEqual([...exactShaModes].sort(), ["apply_grants", "apply_migration", "dry_run"]);
  for (const mode of allowedModes) {
    if (mode !== "plan") assert.equal(exactShaModes.has(mode), true, `missing exact SHA requirement for ${mode}`);
  }
  assert.equal(exactShaModes.has("apply"), false);
});

test("runtime_env target discovery derives a no-secret binding for dry_run without repository target JSON", () => {
  const env = envFor();
  env.BOOTSTRAP_TARGET_SOURCE = "runtime_env";
  env.DB_NAME = TARGET_DATABASE;
  env.DB_HOST = "db.internal";
  env.DB_USER = TARGET.principal;
  delete env.BOOTSTRAP_TARGET_KEY;
  delete env.RUNTIME_BOOTSTRAP_TARGETS_JSON;
  delete env.BOOTSTRAP_TARGET_DATABASE;
  delete env.MYSQL_BOOTSTRAP_DATABASE;
  const result = buildPlan(env, contract);
  assert.equal(result.ok, true);
  assert.equal(result.target_binding.source, "runtime_env");
  assert.equal(result.target_binding.target_key, TARGET_KEY);
  assert.equal(result.target_binding.database_sha256, sha256Hex(TARGET_DATABASE));
  assert.equal(result.target_binding.raw_values_exposed, false);
  assert.equal(result.target_binding.secrets_included, false);
  assert.equal(result.database_connection_performed, false);
});

test("runtime_env read-only dry-run reuses centralized DB credentials without granting mutation authority", () => {
  const env = envFor();
  env.BOOTSTRAP_TARGET_SOURCE = "runtime_env";
  env.DB_NAME = TARGET_DATABASE;
  env.DB_HOST = "db.internal";
  env.DB_PORT = "3307";
  env.DB_USER = TARGET.principal;
  delete env.BOOTSTRAP_TARGET_DATABASE;
  delete env.RUNTIME_BOOTSTRAP_TARGETS_JSON;
  delete env.MYSQL_BOOTSTRAP_HOST;
  delete env.MYSQL_BOOTSTRAP_PORT;
  delete env.MYSQL_BOOTSTRAP_DATABASE;
  delete env.MYSQL_BOOTSTRAP_USER;
  delete env.MYSQL_BOOTSTRAP_PASSWORD;
  const result = buildPlan(env, contract);
  assert.equal(result.operation, "read_only");
  assert.equal(result.credentials.credential_source, "runtime_read_only");
  assert.equal(result.credentials.separate_from_runtime, false);
  assert.equal(result.database_connection_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.migration_apply_performed, false);
  assert.equal(result.grant_mutation_performed, false);

  env.BOOTSTRAP_MODE = "apply_migration";
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_runtime_target_source_mode_denied");
});

test("runtime_env target discovery is denied for apply modes", () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_migration");
  env.BOOTSTRAP_TARGET_SOURCE = "runtime_env";
  env.DB_NAME = TARGET_DATABASE;
  env.DB_USER = TARGET.principal;
  delete env.RUNTIME_BOOTSTRAP_TARGETS_JSON;
  delete env.BOOTSTRAP_TARGET_DATABASE;
  delete env.MYSQL_BOOTSTRAP_DATABASE;
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_runtime_target_source_mode_denied");
});


function hostLocalRoleEnv(mode = "dry_run", operation = "database.repair") {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", mode);
  for (const key of ["RUNTIME_BOOTSTRAP_TARGETS_JSON", "BOOTSTRAP_TARGET_DATABASE", "MYSQL_BOOTSTRAP_HOST", "MYSQL_BOOTSTRAP_PORT", "MYSQL_BOOTSTRAP_USER", "MYSQL_BOOTSTRAP_PASSWORD", "MYSQL_BOOTSTRAP_DATABASE"]) delete env[key];
  return {
    ...env,
    BOOTSTRAP_TARGET_SOURCE: "host_local_role_env",
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: "true",
    HOST_BREAKGLASS_OPERATION: operation,
    DB_NAME: TARGET_DATABASE,
    DB_HOST: "db.internal",
    DB_PORT: "3306",
    DB_USER: TARGET.principal,
    DB_PASSWORD: "runtime-secret-for-test-only",
    GOVERNANCE_DB_NAME: "growth_governance",
    GOVERNANCE_DB_USER: "governance_user",
    GOVERNANCE_DB_PASSWORD: "governance-secret-for-test-only",
    RUNTIME_PERSISTENCE_DB_NAME: "growth_persistence",
    RUNTIME_PERSISTENCE_DB_USER: "persistence_user",
    RUNTIME_PERSISTENCE_DB_PASSWORD: "persistence-secret-for-test-only",
  };
}

test("host-local role discovery binds three existing Hostinger identities without copying secrets to GitHub", () => {
  const env = hostLocalRoleEnv();
  const result = buildPlan(env, contract);
  assert.equal(result.target_binding.source, "host_local_role_env");
  assert.equal(result.credentials.credential_source, "host_local_role_scoped");
  assert.deepEqual(result.credentials.role_credentials.map((entry) => entry.role), ["runtime", "governance", "runtime_persistence"]);
  assert.equal(result.target_binding.governance_database_sha256, sha256Hex("growth_governance"));
  assert.equal(result.target_binding.runtime_persistence_database_sha256, sha256Hex("growth_persistence"));
  const evidence = JSON.stringify(result);
  for (const value of [env.DB_USER, env.GOVERNANCE_DB_USER, env.RUNTIME_PERSISTENCE_DB_USER, env.DB_PASSWORD, env.GOVERNANCE_DB_PASSWORD, env.RUNTIME_PERSISTENCE_DB_PASSWORD]) assert.equal(evidence.includes(value), false);
});

test("host-local role recovery requires explicit authorization, a bounded operation, and host-side execution", () => {
  const unauthorized = hostLocalRoleEnv();
  delete unauthorized.HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS;
  assert.throws(() => buildPlan(unauthorized, contract), (error) => error.code === "bootstrap_host_local_role_authorization_missing");
  const arbitrary = hostLocalRoleEnv("dry_run", "host.command_capsule");
  assert.throws(() => buildPlan(arbitrary, contract), (error) => error.code === "bootstrap_host_local_role_operation_denied");
  const github = hostLocalRoleEnv();
  github.GITHUB_ACTIONS = "true";
  assert.throws(() => buildPlan(github, contract), (error) => error.code === "bootstrap_host_local_role_transport_denied");
});

test("host-local access repair allows grants only with an independent typed grant confirmation", () => {
  const env = hostLocalRoleEnv("apply_grants");
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_confirmation_mismatch");
  env.BOOTSTRAP_GRANTS_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_GRANTS:${EXPECTED_SHA}:${TARGET_KEY}:${TARGET.principal}:localhost`;
  const plan = buildPlan(env, contract);
  assert.equal(plan.operation, "grants");
  assert.equal(plan.credentials.credential_source, "host_local_role_scoped");
  const rebuild = hostLocalRoleEnv("apply_grants", "database.rebuild_empty");
  rebuild.BOOTSTRAP_GRANTS_CONFIRMATION = env.BOOTSTRAP_GRANTS_CONFIRMATION;
  assert.throws(() => buildPlan(rebuild, contract), (error) => error.code === "bootstrap_host_local_grant_operation_denied");
});


test("host-local grant exception executes only repository-allowlisted privileges under separate approval", async () => {
  const env = hostLocalRoleEnv("apply_grants");
  env.BOOTSTRAP_GRANTS_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_GRANTS:${EXPECTED_SHA}:${TARGET_KEY}:${TARGET.principal}:localhost`;
  const opened = new Map();
  const result = await runBootstrap({ env, contract, connectionFactory: async ({ role }) => {
    const connection = fakeConnection({ ledgerFound: true });
    opened.set(role, connection);
    return connection;
  } });
  assert.equal(result.status, "apply_grants_complete");
  assert.equal(result.grant_mutation_performed, true);
  assert.equal(result.migration_apply_performed, false);
  const grants = opened.get("runtime").queryCalls.filter((sql) => /^GRANT /i.test(sql));
  assert.equal(grants.length, contract.grant_policy.required_tables.length);
  for (const statement of grants) {
    assert.match(statement, /^GRANT SELECT, INSERT, UPDATE ON /i);
    assert.doesNotMatch(statement, /GRANT OPTION|ALL PRIVILEGES/i);
  }
  assert.equal(opened.get("governance").queryCalls.some((sql) => /^GRANT /i.test(sql)), false);
  assert.equal(opened.get("runtime_persistence").queryCalls.some((sql) => /^GRANT /i.test(sql)), false);
});

test("host-local role credentials fail closed before the first connection when an identity is incomplete or shared", async () => {
  const missing = hostLocalRoleEnv();
  delete missing.GOVERNANCE_DB_PASSWORD;
  let opened = false;
  await assert.rejects(() => runBootstrap({ env: missing, contract, connectionFactory: async () => { opened = true; return fakeConnection(); } }), (error) => error.code === "bootstrap_role_credentials_missing" && error.details.role === "governance");
  assert.equal(opened, false);
  const reused = hostLocalRoleEnv();
  reused.RUNTIME_PERSISTENCE_DB_USER = reused.GOVERNANCE_DB_USER;
  assert.throws(() => buildPlan(reused, contract), (error) => error.code === "bootstrap_role_identity_reuse_denied");
});

test("host-local dry-run opens each database only with its own existing role credentials", async () => {
  const env = hostLocalRoleEnv();
  const opened = [];
  const result = await runBootstrap({ env, contract, connectionFactory: async ({ role, database, credentials }) => {
    opened.push({ role, database, user: credentials.user });
    return fakeConnection();
  } });
  assert.equal(result.status, "dry_run_complete");
  assert.deepEqual(opened, [
    { role: "runtime", database: TARGET_DATABASE, user: TARGET.principal },
    { role: "governance", database: "growth_governance", user: "governance_user" },
    { role: "runtime_persistence", database: "growth_persistence", user: "persistence_user" },
  ]);
  assert.equal(result.database_mutation_performed, false);
});

test("role credential resolution never substitutes a different role database", () => {
  const env = hostLocalRoleEnv();
  const target = { database: TARGET_DATABASE, governance_database: "growth_governance", runtime_persistence_database: "growth_persistence" };
  env.RUNTIME_PERSISTENCE_DB_NAME = "other_database";
  assert.throws(() => resolveRoleBootstrapCredentials(env, "runtime_persistence", target), (error) => error.code === "bootstrap_role_database_mismatch");
});

test("Host Breakglass empty rebuild contract is represented as a zero-table-only capability", () => {
  const catalog = JSON.parse(fs.readFileSync(new URL("./config/host-breakglass-catalog.json", import.meta.url), "utf8"));
  const rebuild = catalog.operations.find((entry) => entry.key === "database.rebuild_empty");
  assert.equal(catalog.database_independent, true);
  assert.equal(rebuild.requires_zero_table_database, true);
  assert.equal(catalog.destructive_nonempty_rebuild.supported, false);
});

test("CLI loads an explicit env file only for runtime_env dry_run and still fails before DB without bootstrap credentials", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-bootstrap-env-test-"));
  const envFile = path.join(tempDir, ".env");
  const cli = new URL("./scripts/hostinger-runtime-bootstrap.mjs", import.meta.url);
  fs.writeFileSync(envFile, [
    `BOOTSTRAP_EXPECTED_SHA=${EXPECTED_SHA}`,
    "BOOTSTRAP_EXPECTED_BRANCH=Production",
    "BOOTSTRAP_EXPECTED_REPOSITORY=mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    `BOOTSTRAP_TARGET_KEY=${TARGET_KEY}`,
    `BOOTSTRAP_MIGRATION=20260815_custom_gpt_mcp_catalog_levels.sql`,
    `DB_NAME=${TARGET_DATABASE}`,
    "DB_HOST=db.internal",
    `DB_USER=${TARGET.principal}`,
  ].join("\n") + "\n", "utf8");
  const result = spawnSync(process.execPath, [
    cli.pathname,
    "--dry-run",
    "--target-source", "runtime_env",
    "--env-file", envFile,
  ], { encoding: "utf8", env: { PATH: process.env.PATH || "", NODE_NO_WARNINGS: "1" } });
  try {
    assert.equal(result.status, 1);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.error.code, "bootstrap_credentials_missing");
    assert.equal(evidence.database_connection_performed, false);
    assert.equal(evidence.database_mutation_performed, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

test("bootstrap principal separation is enforced without DB_USER and target tampering breaks fingerprint", () => {
  const collision = envFor();
  delete collision.DB_USER;
  collision.MYSQL_BOOTSTRAP_USER = TARGET.principal;
  assert.throws(() => buildPlan(collision, contract), (error) => error.code === "bootstrap_principal_collision_denied");

  const tampered = envFor();
  const target = { ...TARGET, principal: "other_runtime_user" };
  tampered.RUNTIME_BOOTSTRAP_TARGETS_JSON = JSON.stringify([target]);
  assert.throws(() => buildPlan(tampered, contract), (error) => error.code === "bootstrap_target_fingerprint_mismatch");
});

test("combined apply mode is denied", () => {
  assert.throws(() => normalizeMode("apply"), (error) => error.code === "bootstrap_mode_invalid");
});

test("verification-only migrations cannot be applied", () => {
  for (const mode of ["apply_migration", "apply_grants"]) {
    assert.throws(
      () => selectMigration(contract, "225_sprint67_capability_resolution_envelope_ledger.sql", mode),
      (error) => error.code === "bootstrap_migration_mode_denied",
    );
    assert.throws(
      () => selectMigration(contract, "1048_transport_response_chunk_schema_recovery.sql", mode),
      (error) => error.code === "bootstrap_migration_mode_denied",
    );
  }
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
    target_fingerprint: sha256Hex(`mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os:Production:${TARGET_KEY}:${TARGET_DATABASE}:growth_governance:runtime_user:localhost`),
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

test("dry-run binds an explicitly allowlisted runtime persistence database to its own connection", async () => {
  const env = envFor();
  const persistenceDatabase = "growth_persistence";
  const splitTarget = {
    ...TARGET,
    runtime_persistence_database: persistenceDatabase,
    runtime_persistence_database_sha256: sha256Hex(persistenceDatabase),
  };
  env.RUNTIME_BOOTSTRAP_TARGETS_JSON = JSON.stringify([splitTarget]);
  env.RUNTIME_PERSISTENCE_DB_NAME = persistenceDatabase;
  const opened = [];
  const connections = [fakeConnection(), fakeConnection()];
  const result = await runBootstrap({
    env,
    contract,
    connectionFactory: async (request) => {
      opened.push({ role: request.role, database: request.database });
      return connections[opened.length - 1];
    },
  });
  assert.deepEqual(opened, [
    { role: "runtime", database: TARGET_DATABASE },
    { role: "runtime_persistence", database: persistenceDatabase },
  ]);
  assert.equal(result.target_binding.runtime_persistence_database_sha256, sha256Hex(persistenceDatabase));
  assert.equal(connections[1].queryCalls.includes(`USE \`${persistenceDatabase}\``), true);
  assert.equal(result.database_mutation_performed, false);
});

test("runtime persistence databases reject missing allowlist binding, wrong hash, and cross-target substitution", () => {
  const env = envFor();
  env.RUNTIME_PERSISTENCE_DB_NAME = "growth_persistence";
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_persistence_database_not_allowlisted");

  const splitTarget = {
    ...TARGET,
    runtime_persistence_database: "growth_persistence",
    runtime_persistence_database_sha256: "0".repeat(64),
  };
  env.RUNTIME_BOOTSTRAP_TARGETS_JSON = JSON.stringify([splitTarget]);
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_persistence_database_fingerprint_mismatch");

  splitTarget.runtime_persistence_database_sha256 = sha256Hex("growth_persistence");
  env.RUNTIME_BOOTSTRAP_TARGETS_JSON = JSON.stringify([splitTarget]);
  env.RUNTIME_PERSISTENCE_DB_NAME = "different_persistence";
  assert.throws(() => buildPlan(env, contract), (error) => error.code === "bootstrap_persistence_database_mismatch");
});

test("nonempty runtime persistence target blocks split-role baseline before any mutation", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_migration");
  const persistenceDatabase = "growth_persistence";
  env.BOOTSTRAP_MIGRATION_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_MIGRATION:${EXPECTED_SHA}:${TARGET_KEY}:20260815_custom_gpt_mcp_catalog_levels.sql`;
  env.RUNTIME_PERSISTENCE_DB_NAME = persistenceDatabase;
  env.RUNTIME_BOOTSTRAP_TARGETS_JSON = JSON.stringify([{
    ...TARGET,
    runtime_persistence_database: persistenceDatabase,
    runtime_persistence_database_sha256: sha256Hex(persistenceDatabase),
  }]);
  const runtime = fakeConnection({ tableCount: 0 });
  const persistence = fakeConnection({ tableCount: 1 });
  await assert.rejects(
    () => runBootstrap({ env, contract, connectionFactory: async ({ role }) => role === "runtime_persistence" ? persistence : runtime }),
    (error) => error.code === "bootstrap_persistence_rebuild_nonempty_denied" && error.details.database_mutation_performed === false,
  );
  assert.equal(runtime.queryCalls.some((sql) => /CREATE|ALTER|UPDATE|INSERT|GRANT/i.test(sql)), false);
  assert.equal(persistence.queryCalls.some((sql) => /CREATE|ALTER|UPDATE|INSERT|GRANT/i.test(sql)), false);
});

test("dry-run verifies 225 envelope schema/policy/tool and 1048 response-chunk readiness", async () => {
  for (const migration of [
    "225_sprint67_capability_resolution_envelope_ledger.sql",
    "1048_transport_response_chunk_schema_recovery.sql",
  ]) {
    const env = envFor(migration, "dry_run");
    const result = await runBootstrap({ env, contract, connectionFactory: async () => fakeConnection({ tableCount: 7, ledgerFound: true }) });
    assert.equal(result.status, "dry_run_complete");
    assert.equal(result.ledger.found, true);
    assert.equal(result.postconditions.ready, true);
    assert.equal(result.postconditions.checks.length, contract.postconditions[migration].length);
  }
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

test("migration apply is independently confirmed and never applies grants", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_migration");
  env.BOOTSTRAP_MIGRATION_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_MIGRATION:${EXPECTED_SHA}:${TARGET_KEY}:20260815_custom_gpt_mcp_catalog_levels.sql`;
  const connection = fakeConnection({ tableCount: 7 });
  const result = await runBootstrap({ env, contract, connectionFactory: async () => connection });
  assert.equal(result.status, "apply_migration_complete");
  assert.equal(result.database_mutation_performed, true);
  assert.equal(result.migration_apply_performed, true);
  assert.equal(result.grant_mutation_performed, false);
  assert.equal(result.postconditions.ready, true);
  assert.deepEqual(connection.queryCalls.filter((sql) => /^GRANT /i.test(sql)), []);
  assert.equal(result.mutation_evidence.grants.attempted, false);
});

test("grants apply requires independent confirmation and migration readiness", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_grants");
  env.BOOTSTRAP_GRANTS_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_GRANTS:${EXPECTED_SHA}:${TARGET_KEY}:runtime_user:localhost`;
  const connection = fakeConnection({ tableCount: 7, ledgerFound: true });
  const result = await runBootstrap({ env, contract, connectionFactory: async () => connection });
  assert.equal(result.status, "apply_grants_complete");
  assert.equal(result.migration_apply_performed, false);
  assert.equal(result.grant_mutation_performed, true);
  assert.equal(result.grants.grant_readback.ready, true);
  assert.equal(result.mutation_evidence.migration.attempted, false);
  const grants = connection.queryCalls.filter((sql) => /^GRANT /i.test(sql));
  assert.equal(grants.length, contract.grant_policy.required_tables.length);
  assert.equal(grants.every((sql) => /^GRANT SELECT, INSERT, UPDATE ON /i.test(sql)), true);
});

test("grant preflight checks every table before the first GRANT", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_grants");
  env.BOOTSTRAP_GRANTS_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_GRANTS:${EXPECTED_SHA}:${TARGET_KEY}:runtime_user:localhost`;
  const connection = fakeConnection({ tableCount: 7, ledgerFound: true, missingTables: ["execution_log"] });
  await assert.rejects(
    () => runBootstrap({ env, contract, connectionFactory: async () => connection }),
    (error) => error.code === "bootstrap_grant_table_missing",
  );
  assert.equal(connection.queryCalls.some((sql) => /^GRANT /i.test(sql)), false);
});

test("partial migration and grant failures report unknown/partial mutation evidence", async () => {
  const migrationEnv = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_migration");
  migrationEnv.BOOTSTRAP_MIGRATION_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_MIGRATION:${EXPECTED_SHA}:${TARGET_KEY}:20260815_custom_gpt_mcp_catalog_levels.sql`;
  const migrationConnection = fakeConnection({ tableCount: 7, failMutationAt: 2 });
  await assert.rejects(
    () => runBootstrap({ env: migrationEnv, contract, connectionFactory: async () => migrationConnection }),
    (error) => {
      assert.equal(error.code, "bootstrap_migration_mutation_failed");
      assert.equal(error.details.database_mutation_performed, "unknown");
      assert.equal(error.details.mutation_evidence.mutation_state, "partial_possible");
      assert.equal(error.details.mutation_evidence.migration.statements_completed, 1);
      return true;
    },
  );

  const grantsEnv = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_grants");
  grantsEnv.BOOTSTRAP_GRANTS_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_GRANTS:${EXPECTED_SHA}:${TARGET_KEY}:runtime_user:localhost`;
  const grantsConnection = fakeConnection({ tableCount: 7, ledgerFound: true, failGrantAt: 3 });
  await assert.rejects(
    () => runBootstrap({ env: grantsEnv, contract, connectionFactory: async () => grantsConnection }),
    (error) => {
      assert.equal(error.code, "bootstrap_grant_mutation_failed");
      assert.equal(error.details.database_mutation_performed, "unknown");
      assert.equal(error.details.mutation_evidence.mutation_state, "partial_possible");
      assert.deepEqual(error.details.mutation_evidence.grants.tables_completed, contract.grant_policy.required_tables.slice(0, 2));
      return true;
    },
  );
});

test("migration confirmation is exact and blocks before opening a connection", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_migration");
  env.BOOTSTRAP_MIGRATION_CONFIRMATION = "APPLY_HOSTINGER_RUNTIME_MIGRATION:wrong:production-runtime:20260815_custom_gpt_mcp_catalog_levels.sql";
  let connectionOpened = false;
  await assert.rejects(
    () => runBootstrap({ env, contract, connectionFactory: async () => { connectionOpened = true; return fakeConnection(); } }),
    (error) => error.code === "bootstrap_confirmation_mismatch",
  );
  assert.equal(connectionOpened, false);
});

test("zero-table migration apply stops before mutation when canonical bundle is absent", async () => {
  const env = envFor("20260815_custom_gpt_mcp_catalog_levels.sql", "apply_migration");
  env.BOOTSTRAP_MIGRATION_CONFIRMATION = `APPLY_HOSTINGER_RUNTIME_MIGRATION:${EXPECTED_SHA}:${TARGET_KEY}:20260815_custom_gpt_mcp_catalog_levels.sql`;
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

test("runtime persistence rebuild requires its exact-SHA repository bundle, required table, and pinned checksum", () => {
  const directory = fs.mkdtempSync(path.join("/tmp", "runtime-persistence-bootstrap-test-"));
  const bundlePath = path.join(directory, "persistence.schema.sql.gz");
  const bundle = zlib.gzipSync("CREATE TABLE `governed_tool_response_chunks` (`chunk_id` VARCHAR(128));\n");
  fs.writeFileSync(bundlePath, bundle);
  const tables = contract.baseline_bundle.required_runtime_persistence_tables;
  const manifestPath = path.join(directory, "staging-schema-bundle-manifest.json");
  const manifest = {
    contract: "mad4b.staging.schema-bundle-output.v1",
    source_commit: EXPECTED_SHA,
    schema_only: true,
    production_accessed: false,
    provider_accessed: false,
    data_exported: false,
    secrets_included: false,
    roles: { runtime_persistence: { bundle_file: "persistence.schema.sql.gz", tables, table_count: tables.length, sha256: createHash("sha256").update(bundle).digest("hex") } },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const validated = validateSchemaBundleManifest(manifestPath, EXPECTED_SHA, contract, "runtime_persistence");
  assert.equal(validated.role.file, "persistence.schema.sql.gz");
  assert.equal(validated.role.tables.includes("governed_tool_response_chunks"), true);
  assert.throws(() => validateSchemaBundleManifest(manifestPath, "a".repeat(40), contract, "runtime_persistence"), (error) => error.code === "bootstrap_bundle_source_mismatch");
  manifest.roles.runtime_persistence.sha256 = "0".repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => validateSchemaBundleManifest(manifestPath, EXPECTED_SHA, contract, "runtime_persistence"), (error) => error.code === "bootstrap_bundle_checksum_mismatch");
  fs.rmSync(directory, { recursive: true, force: true });
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
