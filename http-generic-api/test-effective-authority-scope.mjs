import assert from "node:assert/strict";
import {
  PLATFORM_PLACEHOLDER_TENANT_ID,
  buildTenantScopePredicate,
  nonPlaceholderTenant,
} from "./effectiveAuthorityScope.js";

assert.equal(nonPlaceholderTenant(PLATFORM_PLACEHOLDER_TENANT_ID), null);
assert.equal(nonPlaceholderTenant("tenant-a"), "tenant-a");

{
  const predicate = buildTenantScopePredicate({ isAdmin: true, tenantId: PLATFORM_PLACEHOLDER_TENANT_ID });
  assert.equal(predicate.sql, "1 = 1");
  assert.deepEqual(predicate.params, []);
  assert.equal(predicate.scope_mode, "platform_global");
}

{
  const predicate = buildTenantScopePredicate({ isAdmin: false, tenantId: "tenant-a" });
  assert.equal(predicate.sql, "tenant_id = ?");
  assert.deepEqual(predicate.params, ["tenant-a"]);
  assert.equal(predicate.scope_mode, "signed_membership");
}

console.log("effective authority scope tests passed");
