import assert from "node:assert/strict";

import {
  PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT,
  PLATFORM_RESOURCE_RECIPE_TABLES,
  assertPlatformResourceRecipeStoreSource,
  getPlatformResourceRecipeByKey,
  listPlatformResourceRecipes,
  listPlatformResourceRecipesByKeys,
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
      if (sql.includes("ORDER BY r.status")) {
        return [[{
          recipe_key: "google_drive.folder.inspect_tree",
          resource_type: "drive_folder",
          adapter_key: "google_drive.folder.inspect.adapter",
          status: "active",
        }]];
      }
      if (sql.includes("WHERE recipe_key IN")) {
        return [[
          {
            recipe_key: "repo.pr.comment_advisory",
            status: "active",
            risk_class: "mutation",
            mode: "apply",
          },
          {
            recipe_key: "repo.pr.label",
            status: "planned",
            risk_class: "mutation",
            mode: "apply",
          },
        ]];
      }
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

const recipes = await listPlatformResourceRecipesByKeys(
  ["repo.pr.comment_advisory", "repo.pr.label", "repo.pr.comment_advisory"],
  {
    recipeStorePool: governancePool,
    runtimePool,
  },
);
assert.deepEqual(recipes.map((row) => row.recipe_key), [
  "repo.pr.comment_advisory",
  "repo.pr.label",
]);

const catalogRows = await listPlatformResourceRecipes(
  {
    resourceType: "drive_folder",
    operationKey: "inspect_tree",
    status: "active",
    providerResourceTypes: ["drive_folder", "drive_folder"],
    search: "Drive",
    searchResourceTypes: ["drive_folder", "drive_folder"],
    searchAdapterKeys: ["google_drive.folder.inspect.adapter", "google_drive.folder.inspect.adapter"],
    limit: 10,
  },
  {
    recipeStorePool: governancePool,
    runtimePool,
  },
);
assert.equal(catalogRows.length, 1);
assert.equal(catalogRows[0]?.recipe_key, "google_drive.folder.inspect_tree");

const steps = await listPlatformResourceRecipeSteps("repo.pr.comment_advisory", {
  recipeStorePool: governancePool,
  runtimePool,
});
assert.equal(steps.length, 1);
assert.equal(steps[0]?.step_key, "readback");

assert.equal(runtimeQueryCount, 0);
assert.equal(governanceQueries.length, 4);
assert.match(governanceQueries[0].sql, /FROM platform_resource_recipes/i);
assert.match(governanceQueries[1].sql, /WHERE recipe_key IN/i);
assert.match(governanceQueries[2].sql, /ORDER BY r\.status/i);
assert.match(governanceQueries[2].sql, /r\.resource_type IN \(\?\)/i);
assert.match(governanceQueries[2].sql, /r\.adapter_key IN \(\?\)/i);
assert.match(governanceQueries[3].sql, /FROM platform_resource_recipe_steps/i);
assert.deepEqual(governanceQueries[0].params, ["repo.pr.comment_advisory"]);
assert.deepEqual(governanceQueries[1].params, ["repo.pr.comment_advisory", "repo.pr.label"]);
assert.deepEqual(governanceQueries[2].params, [
  "drive_folder",
  "inspect_tree",
  "active",
  "drive_folder",
  "%Drive%",
  "%Drive%",
  "%Drive%",
  "drive_folder",
  "google_drive.folder.inspect.adapter",
  10,
]);
assert.deepEqual(governanceQueries[3].params, ["repo.pr.comment_advisory"]);

console.log("Platform Resource Recipe Store contract tests passed.");
