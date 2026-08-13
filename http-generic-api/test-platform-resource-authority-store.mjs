import assert from "node:assert/strict";
import {
  assertPlatformResourceAuthorityStoreSource,
  PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT,
  resolvePlatformResourceAuthorityPool,
} from "./platformResourceAuthorityStore.js";
import { loadPlatformResourceAuthorityBindings } from "./scripts/capability-resolution-dry-run.mjs";

const runtimeQueries = [];
const governanceQueries = [];
const runtimePool = {
  async query(sql) {
    runtimeQueries.push(sql);
    throw new Error("Runtime DB must never serve platform_resource_authority_bindings.");
  },
};
const governancePool = {
  async query(sql, params = []) {
    governanceQueries.push({ sql, params });
    return [[]];
  },
};

assert.equal(PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT.owner, "governance_db");
assert.equal(PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT.runtime_pool_fallback_allowed, false);
assert.equal(resolvePlatformResourceAuthorityPool({ governancePool }), governancePool);
assert.equal(resolvePlatformResourceAuthorityPool({ authorityStorePool: governancePool }), governancePool);

assert.throws(
  () => resolvePlatformResourceAuthorityPool({ pool: runtimePool }),
  (error) => error?.code === "GOVERNANCE_DB_CONFIG_MISSING" || error?.code === "GOVERNANCE_DB_IDENTITY_NOT_DEDICATED",
  "a generic pool key must not be accepted as the Authority Store executor",
);
assert.throws(
  () => assertPlatformResourceAuthorityStoreSource({ pool: runtimePool, runtimePool }),
  (error) => error?.code === "PLATFORM_RESOURCE_AUTHORITY_RUNTIME_POOL_FORBIDDEN",
);
assert.deepEqual(
  assertPlatformResourceAuthorityStoreSource({ pool: governancePool, runtimePool }),
  {
    contract: "mad4b.platform-resource-authority-store.v1",
    owner: "governance_db",
    table: "platform_resource_authority_bindings",
    source_verified: true,
    runtime_pool_fallback_allowed: false,
    secrets_included: false,
  },
);

const bindings = await loadPlatformResourceAuthorityBindings(governancePool, {
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  principal: { principal_type: "service", principal_id: "service-1" },
  resourceType: "github_repo",
  resourceUri: "github://owner/repo",
  recipeKey: "repo_patch_apply",
});
assert.deepEqual(bindings, []);
assert.equal(runtimeQueries.length, 0);
assert.equal(governanceQueries.length, 1);
assert.match(governanceQueries[0].sql, /FROM platform_resource_authority_bindings/);

console.log("platform resource authority store same-source tests passed");
