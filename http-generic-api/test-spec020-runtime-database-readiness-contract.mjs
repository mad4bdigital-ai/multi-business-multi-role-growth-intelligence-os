import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const contractPath = path.join(root, "../specs/020-platform-resource-identity-brand-governance/contracts/runtime-database-readiness-contract.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

assert.equal(contract.contract, "mad4b.spec020.runtime-database-readiness.v1");
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

const db = contract.required_preflight_evidence.runtime_database;
assert.deepEqual(db.required_table_privileges.customer_sessions, ["SELECT", "INSERT", "UPDATE"]);
assert.deepEqual(db.required_table_privileges.governed_tool_response_chunks, ["SELECT", "INSERT", "UPDATE"]);
assert.deepEqual(db.maintenance_privileges.governed_tool_response_chunks, ["DELETE"]);
assert.equal(db.constraints.no_global_write_privileges, true);
assert.equal(db.constraints.no_schema_wide_write_privileges, true);
assert.equal(db.constraints.no_grant_option, true);
assert.equal(db.constraints.no_column_level_privileges, true);
assert.equal(db.constraints.direct_table_scope_only, true);

const catalog = contract.required_preflight_evidence.tool_catalog_schema;
assert.equal(catalog.required_field, "mcp_catalog_level");
assert.ok(catalog.required_evidence.includes("schema_readback proves the field exists"));
assert.ok(catalog.required_evidence.includes("migration checksum is recorded"));

const gate = contract.required_preflight_evidence.activation_gate;
assert.equal(gate.degraded_if_any_required_evidence_missing, true);
assert.equal(gate.hard_activation_blocked_until_all_required_evidence, true);
assert.ok(gate.required.includes("session-context preflight passed"));
assert.ok(gate.required.includes("tool catalog schema preflight passed"));
assert.ok(gate.required.includes("response chunk persistence preflight passed"));

const serialized = fs.readFileSync(contractPath, "utf8");
for (const mutation of ["GRANT ", "REVOKE ", "ALTER TABLE", "CREATE TABLE", "DROP TABLE"]) {
  assert.ok(!serialized.includes(`\"sql\": \"${mutation}`), `contract must not carry executable ${mutation}`);
}

console.log("Spec 020 runtime database readiness contract guard passed");
