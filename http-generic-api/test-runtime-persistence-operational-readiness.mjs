import assert from "node:assert/strict";
import {
  RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT,
  inspectRuntimePersistenceConfiguration,
  runRuntimePersistenceOperationalReadiness,
  runRuntimePersistenceOperationalReadinessCli,
} from "./scripts/runtime-persistence-operational-readiness.mjs";

const configuredEnv = {
  RUNTIME_PERSISTENCE_DB_HOST: "db.internal",
  RUNTIME_PERSISTENCE_DB_NAME: "growthOS_persistence",
  RUNTIME_PERSISTENCE_DB_USER: "runtime_persistence_writer",
  RUNTIME_PERSISTENCE_DB_PASSWORD: "test-only-secret",
};

const readyAuthority = async () => ({
  ready: true,
  table_name: "governed_tool_response_chunks",
  required_operations: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  missing_required: [],
  secrets_included: false,
});
const readySchema = async () => ({
  ready: true,
  table_name: "governed_tool_response_chunks",
  required_column_count: 16,
  missing_columns: [],
  secrets_included: false,
});
const readyCollation = async () => ({
  ready: true,
  reason: "runtime_persistence_collation_ready",
  violations: [],
  secrets_included: false,
});

const missing = inspectRuntimePersistenceConfiguration({});
assert.equal(missing.configured, false);
assert.deepEqual(missing.missing_keys, [
  "RUNTIME_PERSISTENCE_DB_HOST",
  "RUNTIME_PERSISTENCE_DB_NAME",
  "RUNTIME_PERSISTENCE_DB_USER",
  "RUNTIME_PERSISTENCE_DB_PASSWORD",
]);
assert.equal(missing.fallback_to_db_user, false);
assert.equal(missing.secrets_included, false);

const missingResult = await runRuntimePersistenceOperationalReadiness({ env: {} });
assert.equal(missingResult.ok, false);
assert.equal(missingResult.status, "blocked");
assert.equal(missingResult.reason, "runtime_persistence_configuration_missing");
assert.equal(missingResult.credential_payload_reads, 0);
assert.equal(missingResult.external_writes, 0);
assert.equal(missingResult.read_only_probe, true);
assert.equal(missingResult.database_connection_performed, false);
assert.equal(missingResult.sql_readback_performed, false);
assert.equal(missingResult.sql_mutation_performed, false);
assert.equal(missingResult.migration_apply_performed, false);
assert.equal(missingResult.provider_mutation_performed, false);
assert.equal(missingResult.deployment_performed, false);
assert.equal(missingResult.secrets_included, false);
assert.equal(JSON.stringify(missingResult).includes("test-only-secret"), false);

const sentinelPool = {};
let authorityDeps = null;
let schemaDeps = null;
let collationDeps = null;
const readyResult = await runRuntimePersistenceOperationalReadiness({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => sentinelPool,
  inspectAuthority: async (input, deps) => {
    authorityDeps = { input, deps };
    return readyAuthority();
  },
  inspectSchema: async (deps) => {
    schemaDeps = deps;
    return readySchema();
  },
  inspectCollation: async (deps) => {
    collationDeps = deps;
    return readyCollation();
  },
});
assert.equal(readyResult.ok, true);
assert.equal(readyResult.status, "ready");
assert.equal(readyResult.reason, "runtime_persistence_ready");
assert.equal(authorityDeps.input.table, "governed_tool_response_chunks");
assert.equal(authorityDeps.deps.runtimePersistencePool, sentinelPool);
assert.equal(schemaDeps.runtimePersistencePool, sentinelPool);
assert.equal(collationDeps.runtimePersistencePool, sentinelPool);
assert.equal(readyResult.activation_contract.migration_file, "1048_transport_response_chunk_schema_recovery.sql");
assert.equal(readyResult.activation_contract.collation_policy.table_collation, "utf8mb4_unicode_ci");
assert.deepEqual(readyResult.activation_contract.required_operations, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
assert.equal(readyResult.read_only_probe, true);
assert.equal(readyResult.database_connection_performed, true);
assert.equal(readyResult.sql_readback_performed, true);
assert.equal(readyResult.sql_mutation_performed, false);
assert.equal(readyResult.migration_apply_performed, false);
assert.equal(readyResult.provider_mutation_performed, false);
assert.equal(readyResult.deployment_performed, false);
assert.equal(readyResult.secrets_included, false);

const blockedResult = await runRuntimePersistenceOperationalReadiness({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => sentinelPool,
  inspectAuthority: async () => ({ ready: false, missing_required: ["INSERT"], secrets_included: false }),
  inspectSchema: readySchema,
  inspectCollation: readyCollation,
});
assert.equal(blockedResult.ok, false);
assert.equal(blockedResult.status, "blocked");
assert.equal(blockedResult.reason, "runtime_persistence_authority_schema_or_collation_not_ready");
assert.equal(blockedResult.authority.missing_required[0], "INSERT");
assert.equal(blockedResult.read_only_probe, true);
assert.equal(blockedResult.sql_mutation_performed, false);
assert.equal(blockedResult.secrets_included, false);

const errorResult = await runRuntimePersistenceOperationalReadiness({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => {
    const error = new Error("connection refused");
    error.code = "ECONNREFUSED";
    throw error;
  },
});
assert.equal(errorResult.ok, false);
assert.equal(errorResult.status, "blocked");
assert.equal(errorResult.reason, "runtime_persistence_readiness_probe_failed");
assert.equal(errorResult.error.code, "ECONNREFUSED");
assert.deepEqual(errorResult.activation_contract, RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT);
assert.equal(errorResult.read_only_probe, true);
assert.equal(errorResult.database_connection_performed, false);
assert.equal(errorResult.sql_readback_performed, false);
assert.equal(errorResult.sql_mutation_performed, false);
assert.equal(errorResult.secrets_included, false);

let readyPoolEndCalls = 0;
let readyCliOutput = "";
let readyCliExitCode = null;
const readyCliPool = {
  end: async () => {
    readyPoolEndCalls += 1;
  },
};
const readyCliResult = await runRuntimePersistenceOperationalReadinessCli({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => readyCliPool,
  inspectAuthority: readyAuthority,
  inspectSchema: readySchema,
  inspectCollation: readyCollation,
  writeOutput: (text) => {
    readyCliOutput += text;
  },
  setExitCode: (code) => {
    readyCliExitCode = code;
  },
});
assert.equal(readyCliResult.ok, true);
assert.equal(readyCliResult.status, "ready");
assert.equal(readyCliResult.cli_resource_cleanup.attempted, true);
assert.equal(readyCliResult.cli_resource_cleanup.completed, true);
assert.equal(readyCliResult.cli_resource_cleanup.pool_end_called, true);
assert.equal(readyCliResult.cli_resource_cleanup.error, null);
assert.equal(readyPoolEndCalls, 1);
assert.equal(readyCliExitCode, null);
assert.equal(JSON.parse(readyCliOutput).ok, true);
assert.equal(readyCliOutput.includes("test-only-secret"), false);

let blockedPoolEndCalls = 0;
let blockedCliExitCode = null;
const blockedCliResult = await runRuntimePersistenceOperationalReadinessCli({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => ({
    end: async () => {
      blockedPoolEndCalls += 1;
    },
  }),
  inspectAuthority: async () => ({ ready: false, missing_required: ["INSERT"], secrets_included: false }),
  inspectSchema: readySchema,
  inspectCollation: readyCollation,
  writeOutput: () => {},
  setExitCode: (code) => {
    blockedCliExitCode = code;
  },
});
assert.equal(blockedCliResult.ok, false);
assert.equal(blockedCliResult.reason, "runtime_persistence_authority_schema_or_collation_not_ready");
assert.equal(blockedCliResult.cli_resource_cleanup.completed, true);
assert.equal(blockedCliResult.cli_resource_cleanup.pool_end_called, true);
assert.equal(blockedPoolEndCalls, 1);
assert.equal(blockedCliExitCode, 1);

let cleanupFailureExitCode = null;
const cleanupFailureResult = await runRuntimePersistenceOperationalReadinessCli({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => ({
    end: async () => {
      const error = new Error("close failed");
      error.code = "ECLOSE";
      throw error;
    },
  }),
  inspectAuthority: readyAuthority,
  inspectSchema: readySchema,
  inspectCollation: readyCollation,
  writeOutput: () => {},
  setExitCode: (code) => {
    cleanupFailureExitCode = code;
  },
});
assert.equal(cleanupFailureResult.ok, false);
assert.equal(cleanupFailureResult.status, "blocked");
assert.equal(cleanupFailureResult.reason, "runtime_persistence_cli_resource_cleanup_failed");
assert.equal(cleanupFailureResult.cli_resource_cleanup.attempted, true);
assert.equal(cleanupFailureResult.cli_resource_cleanup.completed, false);
assert.equal(cleanupFailureResult.cli_resource_cleanup.pool_end_called, true);
assert.equal(cleanupFailureResult.cli_resource_cleanup.error.code, "ECLOSE");
assert.equal(cleanupFailureExitCode, 1);
assert.equal(JSON.stringify(cleanupFailureResult).includes("close failed"), false);

let missingEndExitCode = null;
const missingEndResult = await runRuntimePersistenceOperationalReadinessCli({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => ({}),
  inspectAuthority: readyAuthority,
  inspectSchema: readySchema,
  inspectCollation: readyCollation,
  writeOutput: () => {},
  setExitCode: (code) => {
    missingEndExitCode = code;
  },
});
assert.equal(missingEndResult.ok, false);
assert.equal(missingEndResult.status, "blocked");
assert.equal(missingEndResult.reason, "runtime_persistence_cli_resource_cleanup_failed");
assert.equal(missingEndResult.cli_resource_cleanup.attempted, true);
assert.equal(missingEndResult.cli_resource_cleanup.completed, false);
assert.equal(missingEndResult.cli_resource_cleanup.pool_end_called, false);
assert.equal(missingEndResult.cli_resource_cleanup.error.code, "runtime_persistence_cli_pool_end_unavailable");
assert.equal(missingEndExitCode, 1);

console.log("runtime persistence operational readiness contract tests passed");
