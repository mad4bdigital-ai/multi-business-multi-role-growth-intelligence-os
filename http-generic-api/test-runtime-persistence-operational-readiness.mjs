import assert from "node:assert/strict";
import {
  RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT,
  inspectRuntimePersistenceConfiguration,
  runRuntimePersistenceOperationalReadiness,
} from "./scripts/runtime-persistence-operational-readiness.mjs";

const configuredEnv = {
  RUNTIME_PERSISTENCE_DB_HOST: "db.internal",
  RUNTIME_PERSISTENCE_DB_NAME: "growthOS_persistence",
  RUNTIME_PERSISTENCE_DB_USER: "runtime_persistence_writer",
  RUNTIME_PERSISTENCE_DB_PASSWORD: "test-only-secret",
};

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
assert.equal(missingResult.secrets_included, false);
assert.equal(JSON.stringify(missingResult).includes("test-only-secret"), false);

const sentinelPool = {};
let authorityDeps = null;
let schemaDeps = null;
const readyResult = await runRuntimePersistenceOperationalReadiness({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => sentinelPool,
  inspectAuthority: async (input, deps) => {
    authorityDeps = { input, deps };
    return {
      ready: true,
      table_name: "governed_tool_response_chunks",
      required_operations: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      missing_required: [],
      secrets_included: false,
    };
  },
  inspectSchema: async (deps) => {
    schemaDeps = deps;
    return {
      ready: true,
      table_name: "governed_tool_response_chunks",
      required_column_count: 16,
      missing_columns: [],
      secrets_included: false,
    };
  },
});
assert.equal(readyResult.ok, true);
assert.equal(readyResult.status, "ready");
assert.equal(readyResult.reason, "runtime_persistence_ready");
assert.equal(authorityDeps.input.table, "governed_tool_response_chunks");
assert.equal(authorityDeps.deps.runtimePersistencePool, sentinelPool);
assert.equal(schemaDeps.runtimePersistencePool, sentinelPool);
assert.equal(readyResult.activation_contract.migration_file, "1048_transport_response_chunk_schema_recovery.sql");
assert.deepEqual(readyResult.activation_contract.required_operations, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
assert.equal(readyResult.secrets_included, false);

const blockedResult = await runRuntimePersistenceOperationalReadiness({
  env: configuredEnv,
  runtimePersistencePoolFactory: () => sentinelPool,
  inspectAuthority: async () => ({ ready: false, missing_required: ["INSERT"], secrets_included: false }),
  inspectSchema: async () => ({ ready: true, missing_columns: [], secrets_included: false }),
});
assert.equal(blockedResult.ok, false);
assert.equal(blockedResult.status, "blocked");
assert.equal(blockedResult.reason, "runtime_persistence_authority_or_schema_not_ready");
assert.equal(blockedResult.authority.missing_required[0], "INSERT");
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
assert.equal(errorResult.secrets_included, false);

console.log("runtime persistence operational readiness contract tests passed");
