import { getGovernanceDbPrivilegeReadinessSnapshot } from "./governanceDbPrivilegeReadinessRuntime.js";
import { readMcpCatalogSchemaReadinessSafe } from "./mcpCatalogSchemaGuard.js";
import { runRuntimePersistenceOperationalReadiness } from "./scripts/runtime-persistence-operational-readiness.mjs";

export const PRODUCTION_ACTIVATION_READINESS_CONTRACT =
  "mad4b.production-activation-readiness.v1";

export const PRODUCTION_ACTIVATION_READINESS_DIMENSIONS = Object.freeze([
  "mcp_catalog_schema",
  "governance_db_privilege",
  "runtime_persistence",
]);

function boundedCode(error, fallback) {
  return String(error?.code || error?.errno || fallback).slice(0, 128) || fallback;
}

async function readDimension(name, reader) {
  try {
    const result = await reader();
    return result && typeof result === "object"
      ? result
      : {
          ok: false,
          status: "blocked",
          reason: `${name}_readiness_invalid_result`,
          secrets_included: false,
        };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      reason: `${name}_readiness_probe_failed`,
      code: boundedCode(error, `${name}_readiness_probe_failed`),
      database_connection_performed: false,
      sql_readback_performed: false,
      sql_mutation_performed: false,
      migration_apply_performed: false,
      deployment_performed: false,
      secrets_included: false,
    };
  }
}

export async function runProductionActivationReadiness({
  mcpCatalogReader = readMcpCatalogSchemaReadinessSafe,
  governanceDbReader = getGovernanceDbPrivilegeReadinessSnapshot,
  runtimePersistenceReader = runRuntimePersistenceOperationalReadiness,
} = {}) {
  const [mcpCatalogSchema, governanceDbPrivilege, runtimePersistence] = await Promise.all([
    readDimension("mcp_catalog_schema", mcpCatalogReader),
    readDimension("governance_db_privilege", governanceDbReader),
    readDimension("runtime_persistence", runtimePersistenceReader),
  ]);

  const checks = {
    mcp_catalog_schema_ready: mcpCatalogSchema.ok === true,
    governance_db_privilege_ready: governanceDbPrivilege.ready === true,
    runtime_persistence_ready: runtimePersistence.ok === true,
  };
  const ready = Object.values(checks).every(Boolean);

  return {
    contract: PRODUCTION_ACTIVATION_READINESS_CONTRACT,
    status: ready ? "ready" : "blocked",
    ok: ready,
    ready,
    dimensions: {
      mcp_catalog_schema: mcpCatalogSchema,
      governance_db_privilege: governanceDbPrivilege,
      runtime_persistence: runtimePersistence,
    },
    checks,
    hard_activation_blocked_until_ready: !ready,
    read_only_probe: true,
    database_connection_performed: [mcpCatalogSchema, governanceDbPrivilege, runtimePersistence]
      .some((result) => result.database_connection_performed === true),
    sql_readback_performed: [mcpCatalogSchema, governanceDbPrivilege, runtimePersistence]
      .some((result) => result.sql_readback_performed === true),
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  };
}
