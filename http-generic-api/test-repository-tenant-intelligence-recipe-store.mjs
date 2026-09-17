import assert from "node:assert/strict";

import { createRepositoryAuthorityBinding } from "./repositoryTenantIntelligenceV2.js";

const runtimeQueries = [];
const governanceQueries = [];

const runtimePool = {
  async query(sql) {
    runtimeQueries.push(String(sql));
    throw new Error("Runtime pool must not serve repository recipe reads in this test.");
  },
};

const governancePool = {
  async query(sql) {
    const query = String(sql).replace(/\s+/g, " ").trim();
    governanceQueries.push(query);
    if (query.includes("FROM platform_resource_recipes")) {
      return [[{
        recipe_key: "repo.pr.reconciliation_sweep",
        status: "active",
        read_only: 1,
        risk_class: "diagnostic",
      }]];
    }
    throw new Error(`Unexpected Governance SQL: ${query}`);
  },
};

await assert.rejects(
  () => createRepositoryAuthorityBinding(
    {
      tenant_id: "tenant-1",
      owner: "mad4bdigital-ai",
      repo: "multi-business-multi-role-growth-intelligence-os",
      permission_level: "write",
    },
    {
      auth: { is_admin: true },
      recipeStorePool: governancePool,
      runtimePool,
    },
  ),
  (error) => error?.code === "repository_binding_read_only_required",
);

assert.equal(runtimeQueries.length, 0);
assert.equal(governanceQueries.length, 1);
assert.match(governanceQueries[0], /FROM platform_resource_recipes/);

await assert.rejects(
  () => createRepositoryAuthorityBinding(
    {
      tenant_id: "tenant-1",
      owner: "mad4bdigital-ai",
      repo: "multi-business-multi-role-growth-intelligence-os",
    },
    {
      auth: { is_admin: true },
      recipeStorePool: runtimePool,
      runtimePool,
    },
  ),
  (error) => error?.code === "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
);

console.log("Repository tenant intelligence recipe-store isolation tests passed.");
