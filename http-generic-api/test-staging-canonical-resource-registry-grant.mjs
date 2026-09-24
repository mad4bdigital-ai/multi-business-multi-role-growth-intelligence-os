import assert from "node:assert/strict";

import {
  BOOTSTRAP_ROLE_GRANT_POLICIES,
  STAGING_ROLE_GRANT_POLICIES,
} from "./databasePrivilegeContracts.js";

const table = "canonical_resource_registry";

assert.equal(
  STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes(table),
  true,
  "Staging runtime must include canonical_resource_registry",
);

assert.deepEqual(
  STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table[table],
  ["SELECT"],
  "canonical_resource_registry must remain SELECT-only",
);

assert.equal(
  BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes(table),
  false,
  "Production/bootstrap runtime grants must remain unchanged",
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.canonical-resource-registry-read-authority.v1",
  canonical_resource_registry_select_only: true,
  production_bootstrap_grants_unchanged: true,
  secrets_included: false,
}));
