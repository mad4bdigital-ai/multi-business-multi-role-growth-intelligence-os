import assert from "node:assert/strict";
import fs from "node:fs";

const contract = JSON.parse(fs.readFileSync(new URL("../specs/020-platform-resource-identity-brand-governance/contracts/runtime-database-role-contract.json", import.meta.url), "utf8"));
const dbSource = fs.readFileSync(new URL("./db.js", import.meta.url), "utf8");
const persistenceSource = fs.readFileSync(new URL("./runtimePersistenceWriteAuthority.js", import.meta.url), "utf8");
const governanceSource = fs.readFileSync(new URL("./governanceDb.js", import.meta.url), "utf8");
const runbook = fs.readFileSync(new URL("../docs/runbooks/runtime-persistence-third-database-activation.md", import.meta.url), "utf8");

assert.equal(contract.schema_version, "mad4b.runtime-database-role-contract.v1");
assert.equal(contract.status, "prepared-only");
assert.equal(contract.authority, "shadow-library-only");
assert.equal(contract.runtime_mutation_allowed, false);
assert.equal(contract.production_activation_allowed, false);
assert.equal(contract.fallback_to_runtime_user, false);
assert.equal(contract.secrets_included, false);

const roles = contract.roles;
assert.deepEqual(Object.keys(roles), ["runtime", "governance", "runtime_persistence"]);
assert.equal(roles.runtime.database_name_env, "DB_NAME");
assert.equal(roles.runtime.principal_env, "DB_USER");
assert.deepEqual(roles.runtime.owned_tables, ["customer_sessions", "tenant_platform_endpoint_tools"]);
assert.deepEqual(roles.runtime.required_operations, ["SELECT", "INSERT", "UPDATE"]);
assert.equal(roles.governance.database_name_env, "GOVERNANCE_DB_NAME");
assert.equal(roles.governance.principal_env, "GOVERNANCE_DB_USER");
assert.ok(roles.governance.owned_tables.includes("platform_resource_authority_bindings"));
assert.equal(roles.runtime_persistence.database_name_env, "RUNTIME_PERSISTENCE_DB_NAME");
assert.equal(roles.runtime_persistence.principal_env, "RUNTIME_PERSISTENCE_DB_USER");
assert.deepEqual(roles.runtime_persistence.owned_tables, ["governed_tool_response_chunks"]);
assert.deepEqual(roles.runtime_persistence.required_operations, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
assert.equal(roles.runtime_persistence.delete_scope, "maintenance_only");

assert.match(dbSource, /RUNTIME_PERSISTENCE_DB_/u);
assert.match(dbSource, /RUNTIME_PERSISTENCE_DB_CONFIG_MISSING/u);
assert.match(persistenceSource, /RUNTIME_PERSISTENCE_DB_USER/u);
assert.match(persistenceSource, /governed_tool_response_chunks/u);
assert.match(persistenceSource, /SELECT.*INSERT.*UPDATE.*DELETE|SELECT.*INSERT.*UPDATE.*DELETE/isu);
assert.match(governanceSource, /GOVERNANCE_DB_/u);
assert.doesNotMatch(persistenceSource, /fallback.*DB_USER/iu);
assert.match(runbook, /Runtime data.*DB_USER[\s\S]*Governance authority.*GOVERNANCE_DB_USER[\s\S]*Durable response persistence.*RUNTIME_PERSISTENCE_DB_USER/u);
assert.match(runbook, /governed_tool_response_chunks.*SELECT.*INSERT.*UPDATE.*DELETE/isu);
assert.match(runbook, /لا ينشئ هذا الملف قاعدة بيانات، ولا ينفذ `GRANT` أو migration/u);

console.log(JSON.stringify({
  ok: true,
  contract: contract.schema_version,
  roles: Object.keys(roles),
  chunk_owner: "runtime_persistence",
  catalog_owner: "runtime",
  migration_applied: false,
  database_mutated: false,
  secrets_included: false,
}));
