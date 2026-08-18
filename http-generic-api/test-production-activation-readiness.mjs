import assert from "node:assert/strict";
import {
  PRODUCTION_ACTIVATION_READINESS_CONTRACT,
  PRODUCTION_ACTIVATION_READINESS_DIMENSIONS,
  runProductionActivationReadiness,
} from "./productionActivationReadiness.js";

const readyDimension = (contract, extra = {}) => async () => ({
  contract,
  ok: true,
  ready: true,
  status: "ready",
  database_connection_performed: true,
  sql_readback_performed: true,
  read_only_probe: true,
  sql_mutation_performed: false,
  migration_apply_performed: false,
  provider_mutation_performed: false,
  deployment_performed: false,
  secrets_included: false,
  ...extra,
});

const ready = await runProductionActivationReadiness({
  mcpCatalogReader: readyDimension("mcp-catalog"),
  governanceDbReader: readyDimension("governance-db"),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(ready.contract, PRODUCTION_ACTIVATION_READINESS_CONTRACT);
assert.deepEqual(Object.keys(ready.dimensions), PRODUCTION_ACTIVATION_READINESS_DIMENSIONS);
assert.equal(ready.ok, true);
assert.equal(ready.ready, true);
assert.deepEqual(ready.checks, {
  mcp_catalog_schema_ready: true,
  governance_db_privilege_ready: true,
  runtime_persistence_ready: true,
  mutation_attestation_complete: true,
});
assert.equal(ready.read_only_probe, true);
assert.equal(ready.mutation_attestation.complete, true);
assert.deepEqual(ready.mutation_attestation.unknown_dimensions, []);
assert.equal(ready.sql_mutation_performed, false);
assert.equal(ready.migration_apply_performed, false);
assert.equal(ready.provider_mutation_performed, false);
assert.equal(ready.deployment_performed, false);
assert.equal(ready.secrets_included, false);

const blocked = await runProductionActivationReadiness({
  mcpCatalogReader: readyDimension("mcp-catalog"),
  governanceDbReader: async () => ({
    ok: false,
    ready: false,
    status: "blocked",
    code: "ER_ACCESS_DENIED_ERROR",
    read_only_probe: true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  }),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(blocked.ok, false);
assert.equal(blocked.status, "blocked");
assert.equal(blocked.hard_activation_blocked_until_ready, true);
assert.equal(blocked.checks.governance_db_privilege_ready, false);
assert.equal(blocked.checks.mutation_attestation_complete, true);
assert.equal(blocked.dimensions.governance_db_privilege.code, "ER_ACCESS_DENIED_ERROR");
assert.equal(blocked.sql_mutation_performed, false);
assert.equal(blocked.secrets_included, false);

const mutating = await runProductionActivationReadiness({
  mcpCatalogReader: readyDimension("mcp-catalog"),
  governanceDbReader: readyDimension("governance-db", { sql_mutation_performed: true }),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(mutating.ok, false);
assert.equal(mutating.status, "blocked");
assert.equal(mutating.checks.mutation_attestation_complete, false);
assert.equal(mutating.read_only_probe, false);
assert.equal(mutating.sql_mutation_performed, true);
assert.deepEqual(mutating.mutation_attestation.unknown_dimensions, ["governance_db_privilege"]);

const incompleteEvidence = await runProductionActivationReadiness({
  mcpCatalogReader: readyDimension("mcp-catalog"),
  governanceDbReader: async () => ({ ok: true, ready: true, status: "ready", secrets_included: false }),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(incompleteEvidence.ok, false);
assert.equal(incompleteEvidence.checks.mutation_attestation_complete, false);
assert.equal(incompleteEvidence.read_only_probe, false);
assert.deepEqual(incompleteEvidence.mutation_attestation.unknown_dimensions, ["governance_db_privilege"]);
assert.equal(incompleteEvidence.sql_mutation_performed, false);

const thrown = await runProductionActivationReadiness({
  mcpCatalogReader: async () => { throw Object.assign(new Error("probe failed"), { code: "ECONNREFUSED" }); },
  governanceDbReader: readyDimension("governance-db"),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(thrown.ok, false);
assert.equal(thrown.dimensions.mcp_catalog_schema.reason, "mcp_catalog_schema_readiness_probe_failed");
assert.equal(thrown.dimensions.mcp_catalog_schema.code, "ECONNREFUSED");
assert.equal(thrown.dimensions.mcp_catalog_schema.read_only_probe, false);
assert.equal(thrown.dimensions.mcp_catalog_schema.sql_mutation_performed, null);
assert.equal(thrown.checks.mutation_attestation_complete, false);
assert.equal(thrown.read_only_probe, false);
assert.deepEqual(thrown.mutation_attestation.unknown_dimensions, ["mcp_catalog_schema"]);
assert.equal(thrown.sql_mutation_performed, false);
assert.equal(JSON.stringify(thrown).includes("probe failed"), false);
assert.equal(thrown.secrets_included, false);

console.log("production activation readiness contract tests passed");
