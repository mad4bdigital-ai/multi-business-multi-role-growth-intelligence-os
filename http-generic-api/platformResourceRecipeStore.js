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

function recipeStoreError(code, message, details = {}, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function isQueryExecutor(value) {
  return Boolean(value && typeof value.query === "function");
}

function normalizedRecipeKey(recipeKey = "") {
  const key = String(recipeKey ?? "").trim();
  if (!key) {
    throw recipeStoreError(
      "PLATFORM_RESOURCE_RECIPE_KEY_REQUIRED",
      "A platform resource recipe_key is required.",
      { contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT.contract },
      400,
    );
  }
  return key;
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
  const governancePool = getGovernancePool();
  if (deps.runtimePool && governancePool === deps.runtimePool) {
    throw recipeStoreError(
      "PLATFORM_RESOURCE_RECIPE_RUNTIME_POOL_FORBIDDEN",
      "The Runtime DB pool cannot serve as the Governance Recipe Store executor.",
      { contract: PLATFORM_RESOURCE_RECIPE_STORE_CONTRACT },
    );
  }
  return governancePool;
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

export async function getPlatformResourceRecipeByKey(recipeKey, deps = {}) {
  const key = normalizedRecipeKey(recipeKey);
  const pool = resolvePlatformResourceRecipePool(deps);
  assertPlatformResourceRecipeStoreSource({ pool, runtimePool: deps.runtimePool });
  const [rows] = await pool.query(
    `SELECT *
       FROM platform_resource_recipes
      WHERE recipe_key = ?
      LIMIT 1`,
    [key],
  );
  return rows?.[0] || null;
}

export async function listPlatformResourceRecipeSteps(recipeKey, deps = {}) {
  const key = normalizedRecipeKey(recipeKey);
  const pool = resolvePlatformResourceRecipePool(deps);
  assertPlatformResourceRecipeStoreSource({ pool, runtimePool: deps.runtimePool });
  const [rows] = await pool.query(
    `SELECT step_order, step_key, step_kind, parent_action_key, endpoint_key, tool_key,
            source_table, source_pk_template_json, query_template_json, body_template_json,
            response_projection_json, required, on_error_policy, status
       FROM platform_resource_recipe_steps
      WHERE recipe_key = ?
      ORDER BY step_order ASC, step_id ASC`,
    [key],
  );
  return Array.isArray(rows) ? rows : [];
}
