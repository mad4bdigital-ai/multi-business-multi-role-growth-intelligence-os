import { getGovernancePool } from "./governanceDb.js";

export const PLATFORM_RESOURCE_RECIPE_TABLES = Object.freeze([
  "platform_resource_recipes",
  "platform_resource_recipe_steps",
]);

export const PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT = Object.freeze({
  contract: "mad4b.platform-resource-recipe-store.v1",
  owner: "governance_db",
  tables: PLATFORM_RESOURCE_RECIPE_TABLES,
  runtime_pool_fallback_allowed: false,
  governance_identity_required: true,
  secrets_included: false,
});

function recipeStoreError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function isQueryExecutor(value) {
  return Boolean(value && typeof value.query === "function");
}

export function resolvePlatformResourceRecipePool(deps = {}) {
  const explicit = deps.recipeStorePool || deps.governancePool;
  if (explicit !== undefined && explicit !== null) {
    if (!isQueryExecutor(explicit)) {
      throw recipeStoreError(
        "PLATFORM_RESOURCE_RECIPE_EXECUTOR_INVALID",
        "The Governance Recipe Store executor must expose a query method.",
        { contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT },
      );
    }
    if (deps.runtimePool && explicit === deps.runtimePool) {
      throw recipeStoreError(
        "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
        "The Runtime DB pool cannot serve as the Governance Recipe Store executor.",
        { contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT },
      );
    }
    return explicit;
  }
  return getGovernancePool();
}

export function assertPlatformResourceRecipeStoreSource({ pool, runtimePool } = {}) {
  if (!isQueryExecutor(pool)) {
    throw recipeStoreError(
      "PLATFORM_RESOURCE_RECIPE_EXECUTOR_REQUIRED",
      "The Governance Recipe Store requires an explicit query executor.",
      { contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT },
    );
  }
  if (runtimePool && pool === runtimePool) {
    throw recipeStoreError(
      "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
      "The Runtime DB pool cannot serve as the Governance Recipe Store executor.",
      { contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT },
    );
  }
  return {
    contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT.contract,
    owner: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT.owner,
    tables: [...PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT.tables],
    source_verified: true,
    runtime_pool_fallback_allowed: false,
    secrets_included: false,
  };
}
