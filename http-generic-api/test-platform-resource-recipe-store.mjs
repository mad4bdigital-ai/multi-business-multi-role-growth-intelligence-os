import assert from "node:assert/strict";

import {
  PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT,
  PLATFORM_RESOURCE_RECIPE_TABLES,
  assertPlatformResourceRecipeStoreSource,
  resolvePlatformResourceRecipePool,
} from "./platformResourceRecipeStore.js";

const runtimePool = { query: async () => [[]] };
const governancePool = { query: async () => [[]] };

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

console.log("Platform Resource Recipe Store contract tests passed.");
