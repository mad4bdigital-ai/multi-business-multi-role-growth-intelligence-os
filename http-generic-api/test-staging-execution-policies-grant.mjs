import assert from "node:assert/strict";

import {
  BOOTSTRAP_ROLE_GRANT_POLICIES,
  STAGING_ROLE_GRANT_POLICIES,
} from "./databasePrivilegeContracts.js";

assert.equal(
  STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("execution_policies"),
  true,
  "Staging runtime must include execution_policies in the required read surface",
);
assert.deepEqual(
  STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.execution_policies,
  ["SELECT"],
  "execution_policies must remain SELECT-only on Staging runtime",
);
assert.equal(
  STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.execution_policies.includes("UPDATE"),
  false,
  "execution_policies must not receive UPDATE authority",
);
assert.equal(
  BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes("execution_policies"),
  false,
  "Production/bootstrap runtime grant policy must remain unchanged",
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.execution-policies-read-authority.v1",
  execution_policies_select_only: true,
  production_bootstrap_grants_unchanged: true,
  secrets_included: false,
}));
