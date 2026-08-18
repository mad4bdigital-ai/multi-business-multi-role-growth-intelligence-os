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

const MUTATION_EVIDENCE_FIELDS = Object.freeze([
  "sql_mutation_performed",
  "migration_apply_performed",
  "provider_mutation_performed",
  "deployment_performed",
]);

function boundedCode(error, fallback) {
  return String(error?.code || error?.errno || fallback).slice(0, 128) || fallback;
}

function mutationAttestation(name, result = {}) {
  const fields = Object.fromEntries(MUTATION_EVIDENCE_FIELDS.map((field) => [field, result[field] ?? null]));
  const complete = result.read_only_probe === true
    && MUTATION_EVIDENCE_FIELDS.every((field) => result[field] === false)
    && result.secrets_included === false;
  return {
    dimension: name,
    complete,
    read_only_probe: result.read_only_probe === true,
    ...fields,
    secrets_included: result.secrets_included ?? null,
  };
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
          read_only_probe: false,
          sql_mutation_performed: null,
          migration_apply_performed: null,
          provider_mutation_performed: null,
          deployment_performed: null,
          secrets_included: false,
        };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      reason: `${name}_readiness_probe_failed`,
      code: boundedCode(error, `${name}_readiness_probe_failed`),
      database_connection_performed: null,
      sql_readback_performed: null,
      read_only_probe: false,
      sql_mutation_performed: null,
      migration_apply_performed: null,
      provider_mutation_performed: null,
      deployment_performed: null,
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

  const dimensions = {
    mcp_catalog_schema: mcpCatalogSchema,
    governance_db_privilege: governanceDbPrivilege,
    runtime_persistence: runtimePersistence,
  };
  const dimensionEntries = Object.entries(dimensions);
  const mutationAttestations = Object.fromEntries(
    dimensionEntries.map(([name, result]) => [name, mutationAttestation(name, result)]),
  );
  const mutationAttestationComplete = Object.values(mutationAttestations)
    .every((attestation) => attestation.complete === true);

  const checks = {
    mcp_catalog_schema_ready: mcpCatalogSchema.ok === true,
    governance_db_privilege_ready: governanceDbPrivilege.ready === true,
    runtime_persistence_ready: runtimePersistence.ok === true,
    mutation_attestation_complete: mutationAttestationComplete,
  };
  const ready = Object.values(checks).every(Boolean);

  const aggregateBoolean = (field) => dimensionEntries.some(([, result]) => result[field] === true);

  return {
    contract: PRODUCTION_ACTIVATION_READINESS_CONTRACT,
    status: ready ? "ready" : "blocked",
    ok: ready,
    ready,
    dimensions,
    checks,
    mutation_attestation: {
      complete: mutationAttestationComplete,
      dimensions: mutationAttestations,
      unknown_dimensions: Object.entries(mutationAttestations)
        .filter(([, attestation]) => attestation.complete !== true)
        .map(([name]) => name),
    },
    hard_activation_blocked_until_ready: !ready,
    read_only_probe: mutationAttestationComplete,
    database_connection_performed: aggregateBoolean("database_connection_performed"),
    sql_readback_performed: aggregateBoolean("sql_readback_performed"),
    sql_mutation_performed: aggregateBoolean("sql_mutation_performed"),
    migration_apply_performed: aggregateBoolean("migration_apply_performed"),
    provider_mutation_performed: aggregateBoolean("provider_mutation_performed"),
    deployment_performed: aggregateBoolean("deployment_performed"),
    secrets_included: aggregateBoolean("secrets_included"),
  };
}
