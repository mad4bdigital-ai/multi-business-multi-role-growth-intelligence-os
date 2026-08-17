import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const contractPath = path.join(root, "../specs/020-platform-resource-identity-brand-governance/contracts/runtime-database-readiness-contract.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

assert.equal(contract.contract, "mad4b.spec020.runtime-database-readiness.v2");
assert.equal(contract.status, "prepared-only");
assert.equal(contract.authority, "shadow-library-only");
assert.equal(contract.runtime_mutation_allowed, false);
assert.equal(contract.production_activation_allowed, false);
assert.equal(contract.credentials_read_allowed, false);
assert.equal(contract.operator_approval_required, true);
assert.equal(contract.secrets_included, false);

const excluded = contract.scope.excluded_actions;
for (const forbidden of ["GRANT", "REVOKE", "ALTER TABLE", "CREATE TABLE", "DROP TABLE", "migration apply", "Hard Activation"]) {
  assert.ok(excluded.includes(forbidden), `${forbidden} must remain explicitly excluded`);
}

const roles = contract.database_roles;
assert.deepEqual(Object.keys(roles), ["runtime", "governance", "runtime_persistence"]);
assert.equal(roles.runtime.database_name_env, "DB_NAME");
assert.equal(roles.runtime.principal_env, "DB_USER");
assert.equal(roles.runtime.role, "runtime_data");
assert.deepEqual(roles.runtime.required_table_privileges.customer_sessions, ["SELECT", "INSERT", "UPDATE"]);
assert.deepEqual(roles.runtime.owned_tables, ["customer_sessions", "tenant_platform_endpoint_tools"]);
assert.equal(roles.governance.database_name_env, "GOVERNANCE_DB_NAME");
assert.equal(roles.governance.principal_env, "GOVERNANCE_DB_USER");
assert.equal(roles.governance.role, "governance_control_plane");
assert.ok(roles.governance.owned_tables.includes("platform_resource_authority_bindings"));
assert.equal(roles.runtime_persistence.database_name_env, "RUNTIME_PERSISTENCE_DB_NAME");
assert.equal(roles.runtime_persistence.principal_env, "RUNTIME_PERSISTENCE_DB_USER");
assert.equal(roles.runtime_persistence.role, "dedicated_runtime_persistence_writer");
assert.deepEqual(roles.runtime_persistence.required_table_privileges.governed_tool_response_chunks, ["SELECT", "INSERT", "UPDATE"]);
assert.deepEqual(roles.runtime_persistence.maintenance_privileges.governed_tool_response_chunks, ["DELETE"]);
assert.equal(roles.runtime_persistence.constraints.delete_scope, "maintenance_only");
assert.equal(roles.runtime_persistence.constraints.no_fallback_to_runtime_role, true);
assert.equal(roles.runtime_persistence.constraints.no_fallback_to_governance_role, true);

const catalog = contract.required_preflight_evidence.tool_catalog_schema;
assert.equal(catalog.required_field, "mcp_catalog_level");
assert.equal(catalog.field_owner, "runtime.tenant_platform_endpoint_tools");
assert.equal(catalog.database_role, "runtime");
assert.ok(catalog.required_evidence.includes("schema_readback proves the field exists"));
assert.ok(catalog.required_evidence.includes("migration checksum is recorded"));

const gate = contract.required_preflight_evidence.activation_gate;
assert.equal(gate.degraded_if_any_required_evidence_missing, true);
assert.equal(gate.hard_activation_blocked_until_all_required_evidence, true);
assert.ok(gate.required.includes("runtime, governance, and runtime persistence identities are distinct"));
assert.ok(gate.required.includes("session-context preflight passed"));
assert.ok(gate.required.includes("tool catalog schema preflight passed"));
assert.ok(gate.required.includes("response chunk persistence preflight passed"));

const serialized = fs.readFileSync(contractPath, "utf8");
for (const mutation of ["GRANT ", "REVOKE ", "ALTER TABLE", "CREATE TABLE", "DROP TABLE"]) {
  assert.ok(!serialized.includes(`\"sql\": \"${mutation}`), `contract must not carry executable ${mutation}`);
}
assert.doesNotMatch(serialized, /password|secret_value|BEGIN\s+SQL/iu);

console.log(JSON.stringify({
  ok: true,
  contract: contract.contract,
  roles: Object.keys(roles),
  catalog_owner: catalog.field_owner,
  chunk_owner: "runtime_persistence.governed_tool_response_chunks",
  migration_applied: false,
  database_mutated: false,
  secrets_included: false,
}));
