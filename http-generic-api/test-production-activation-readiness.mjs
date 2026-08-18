import assert from "node:assert/strict";
import {
  PRODUCTION_ACTIVATION_READINESS_CONTRACT,
  PRODUCTION_ACTIVATION_READINESS_DIMENSIONS,
  runProductionActivationReadiness,
} from "./productionActivationReadiness.js";

const readyDimension = (contract) => async () => ({
  contract,
  ok: true,
  ready: true,
  status: "ready",
  database_connection_performed: true,
  sql_readback_performed: true,
  secrets_included: false,
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
});
assert.equal(ready.read_only_probe, true);
assert.equal(ready.sql_mutation_performed, false);
assert.equal(ready.migration_apply_performed, false);
assert.equal(ready.provider_mutation_performed, false);
assert.equal(ready.deployment_performed, false);
assert.equal(ready.secrets_included, false);

const blocked = await runProductionActivationReadiness({
  mcpCatalogReader: readyDimension("mcp-catalog"),
  governanceDbReader: async () => ({ ok: false, ready: false, status: "blocked", code: "ER_ACCESS_DENIED_ERROR", secrets_included: false }),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(blocked.ok, false);
assert.equal(blocked.status, "blocked");
assert.equal(blocked.hard_activation_blocked_until_ready, true);
assert.equal(blocked.checks.governance_db_privilege_ready, false);
assert.equal(blocked.dimensions.governance_db_privilege.code, "ER_ACCESS_DENIED_ERROR");
assert.equal(blocked.sql_mutation_performed, false);
assert.equal(blocked.secrets_included, false);

const thrown = await runProductionActivationReadiness({
  mcpCatalogReader: async () => { throw Object.assign(new Error("probe failed"), { code: "ECONNREFUSED" }); },
  governanceDbReader: readyDimension("governance-db"),
  runtimePersistenceReader: readyDimension("runtime-persistence"),
});
assert.equal(thrown.ok, false);
assert.equal(thrown.dimensions.mcp_catalog_schema.reason, "mcp_catalog_schema_readiness_probe_failed");
assert.equal(thrown.dimensions.mcp_catalog_schema.code, "ECONNREFUSED");
assert.equal(thrown.sql_mutation_performed, false);
assert.equal(JSON.stringify(thrown).includes("probe failed"), false);
assert.equal(thrown.secrets_included, false);

console.log("production activation readiness contract tests passed");
