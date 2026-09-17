import assert from "node:assert/strict";

import {
  PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT,
  PLATFORM_RESOURCE_RECIPE_TABLES,
  assertPlatformResourceRecipeStoreSource,
  getPlatformResourceRecipeByKey,
  listPlatformResourceRecipeSteps,
  resolvePlatformResourceRecipePool,
} from "./platformResourceRecipeStore.js";

let runtimeQueryCount = 0;
const runtimePool = {
  async query() {
    runtimeQueryCount += 1;
    throw new Error("Runtime DB must not serve Governance recipe reads.");
  },
};
const governanceQueries = [];
const governancePool = {
  async query(sql, params) {
    governanceQueries.push({ sql, params });
    if (sql.includes("FROM platform_resource_recipes")) {
      return [[{
        recipe_key: "repo.pr.comment_advisory",
        status: "active",
        risk_class: "mutation",
        mode: "apply",
      }]];
    }
    if (sql.includes("FROM platform_resource_recipe_steps")) {
      return [[{
        step_order: 1,
        step_key: "readback",
        step_kind: "endpoint_call",
        status: "active",
      }]];
    }
    throw new Error(`Unexpected Governance Recipe Store query: ${sql}`);
  },
};

assert.equal(PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT.owner, "governance_db");
assert.equal(PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT.runtime_pool_fallback_allowed, false);
assert.deepEqual(
  PLATFORM_RESOURCE_RECIPE_TABLES,
  ["platform_resource_recipes", "platform_resource_recipe_steps"],
);

assert.throws(
  () => assertPlatformResourceRecipeStoreSource({ pool: runtimePool, runtimePool }),
  (error) => error?.code === "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
);

assert.throws(
  () => resolvePlatformResourceRecipePool({ recipeStorePool: runtimePool, runtimePool }),
  (error) => error?.code === "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
);

assert.throws(
  () => resolvePlatformResourceRecipePool({ recipeStorePool: {} }),
  (error) => error?.code === "PLATFORM_RESOURCE_RECIPE_EXECUTOR_INVALID",
);

assert.equal(
  resolvePlatformResourceRecipePool({ recipeStorePool: governancePool, runtimePool }),
  governancePool,
);
assert.equal(
  resolvePlatformResourceRecipePool({ governancePool, runtimePool }),
  governancePool,
);

assert.deepEqual(
  assertPlatformResourceRecipeStoreSource({ pool: governancePool, runtimePool }),
  {
    contract: "mad4b.platform-resource-recipe-store.v1",
    owner: "governance_db",
    tables: ["platform_resource_recipes", "platform_resource_recipe_steps"],
    source_verified: true,
    runtime_pool_fallback_allowed: false,
    secrets_included: false,
  },
);

await assert.rejects(
  () => getPlatformResourceRecipeByKey("repo.pr.comment_advisory", {
    recipeStorePool: runtimePool,
    runtimePool,
  }),
  (error) => error?.code === "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
);

const recipe = await getPlatformResourceRecipeByKey("repo.pr.comment_advisory", {
  recipeStorePool: governancePool,
  runtimePool,
});
assert.equal(recipe?.recipe_key, "repo.pr.comment_advisory");
assert.equal(recipe?.status, "active");

const steps = await listPlatformResourceRecipeSteps("repo.pr.comment_advisory", {
  recipeStorePool: governancePool,
  runtimePool,
});
assert.equal(steps.length, 1);
assert.equal(steps[0]?.step_key, "readback");

assert.equal(runtimeQueryCount, 0);
assert.equal(governanceQueries.length, 2);
assert.match(governanceQueries[0].sql, /FROM platform_resource_recipes/i);
assert.match(governanceQueries[1].sql, /FROM platform_resource_recipe_steps/i);
assert.deepEqual(governanceQueries[0].params, ["repo.pr.comment_advisory"]);
assert.deepEqual(governanceQueries[1].params, ["repo.pr.comment_advisory"]);

console.log("Platform Resource Recipe Store contract tests passed.");
