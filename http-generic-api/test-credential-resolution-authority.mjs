import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CREDENTIAL_RESOLUTION_AUTHORITY } from "./credentialResolver.js";
import { STAGING_ROLE_GRANT_POLICIES } from "./databasePrivilegeContracts.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "config/staging-database-role-migration-manifest.json"), "utf8"));
const resolverSource = readFileSync(resolve(here, "credentialResolver.js"), "utf8");
const runtimeGrant = STAGING_ROLE_GRANT_POLICIES.runtime;
const manifestRuntimeTables = new Set([
  ...(manifest.roles?.runtime?.required_tables || []),
  ...(manifest.validation?.required_runtime_support_tables || []),
]);

for (const [table, requirement] of Object.entries(CREDENTIAL_RESOLUTION_AUTHORITY)) {
  assert.equal(
    manifestRuntimeTables.has(table),
    true,
    `credential resolver table ${table} must be explicitly owned by the Staging runtime manifest`,
  );
  assert.equal(
    runtimeGrant.required_tables.includes(table),
    true,
    `credential resolver table ${table} must be present in the Staging runtime grant contract`,
  );
  const granted = runtimeGrant.required_operations_by_table?.[table] || [];
  for (const operation of requirement.operations || []) {
    assert.equal(
      granted.includes(operation),
      true,
      `credential resolver operation ${operation} on ${table} must be granted explicitly`,
    );
  }
}

assert.equal(
  resolverSource.includes(".catch(() => [])"),
  false,
  "credential resolver DB reads must not collapse authority failures into empty results",
);
assert.match(
  resolverSource,
  /secret_references\` WHERE tenant_id = \? AND secret_key = \?/,
  "secret reference lookup must remain tenant scoped",
);
assert.match(
  resolverSource,
  /tenant_secret:\(\[\^:\]\+\):/,
  "tenant secret reference parsing must remain explicit",
);
assert.match(
  resolverSource,
  /validateCandidateReferenceScope/,
  "binding/reference scope validation must remain in the effective resolver",
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.credential-resolution-authority.v1",
  table_count: Object.keys(CREDENTIAL_RESOLUTION_AUTHORITY).length,
  staging_grant_parity: true,
  runtime_manifest_parity: true,
  db_fail_closed: true,
  tenant_scope_enforced: true,
  secrets_included: false,
}));
