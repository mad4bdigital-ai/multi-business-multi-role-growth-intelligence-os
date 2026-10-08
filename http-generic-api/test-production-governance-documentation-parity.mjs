import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  BOOTSTRAP_ROLE_GRANT_POLICIES,
  GOVERNANCE_DB_PRIVILEGE_MATRIX,
  STAGING_ROLE_GRANT_POLICIES,
} from "./databasePrivilegeContracts.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const policy = JSON.parse(read("http-generic-api/config/governance-db-provider-capabilities.json"));
const providerDoc = read("docs/governance-db-provider-capability.md");
const readinessDoc = read("docs/runbooks/governance-db-privilege-readiness.md");
const provider = policy.environments?.Production;

assert.equal(policy.schema_version, "mad4b.governance-db-provider-capabilities.v2");
assert.ok(provider, "Production provider capability claim must be present");
const capabilities = [
  "independent_governance_database_via_managed_control_plane",
  "exact_direct_table_grants_on_governance_database_via_managed_control_plane",
  "dedicated_governance_writer_contract_v1",
];
const declaredSupported = capabilities.every((key) => provider.capabilities?.[key] === true);
const declaredUnsupported = capabilities.some((key) => provider.capabilities?.[key] === false);
assert.equal(declaredSupported || declaredUnsupported, true, "Unresolved provider capability must fail closed");
assert.match(providerDoc, /Declared provider support is not live operational readiness/);
assert.match(readinessDoc, /not live credential, schema, or grant readiness/);
assert.doesNotMatch(readinessDoc, /current Hostinger managed Production fails prerequisite 1/);
if (declaredSupported) {
  assert.match(readinessDoc, /declares.*?independent Governance DB provisioning/s);
  assert.match(providerDoc, /all three.*Governance writer capabilities.*true/s);
}
const grants = Object.entries(GOVERNANCE_DB_PRIVILEGE_MATRIX);
const count = grants.reduce((sum, [, operations]) => sum + operations.length, 0);
assert.equal(grants.length, 17);
assert.equal(count, 39);
assert.match(readinessDoc, /17 tables and 39 exact direct table privileges/);
const tick = String.fromCharCode(96);
for (const [table, operations] of grants) {
  const row = "| " + tick + table + tick + " | " + tick + operations.join(", ") + tick + " |";
  assert.ok(readinessDoc.includes(row), "Governance matrix documentation drift: " + table);
}
const runtime = BOOTSTRAP_ROLE_GRANT_POLICIES.runtime;
const persistence = BOOTSTRAP_ROLE_GRANT_POLICIES.runtime_persistence;
assert.equal(runtime.required_tables.length, 8);
assert.deepEqual(runtime.required_operations, ["SELECT", "INSERT", "UPDATE"]);
assert.equal(runtime.required_tables.includes("audit_log"), false);
assert.deepEqual(persistence.required_tables, ["governed_tool_response_chunks"]);
assert.deepEqual(persistence.required_operations, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
assert.ok(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.length > runtime.required_tables.length);
assert.match(readinessDoc, /not an.*authorization to copy the 59-required \/ 11-optional Staging Runtime overlay/s);
assert.match(readinessDoc, /not.*automatically authorized for Production/);
assert.match(readinessDoc, /No absent or stale evidence becomes\s+permission to apply/);
assert.match(readinessDoc, /exact Production ref/);
assert.match(readinessDoc, /Recovery Control Store/);
assert.match(readinessDoc, /same-cycle/i);
console.log(JSON.stringify({
  contract: "mad4b.production-governance-documentation-parity.v1",
  source_capability_declared_supported: declaredSupported,
  production_live_capability_verified: false,
  governance_tables: grants.length,
  governance_operations: count,
  production_runtime_bootstrap_tables: runtime.required_tables.length,
  runtime_persistence_tables: persistence.required_tables.length,
  production_mutation_executed: false,
  database_connection_performed: false,
  secrets_included: false,
  result: "PASS",
}));
