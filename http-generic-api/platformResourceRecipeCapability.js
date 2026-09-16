import { getPool } from "./db.js";
import {
  assertPlatformResourceAuthorityStoreSource,
  resolvePlatformResourceAuthorityPool,
} from "./platformResourceAuthorityStore.js";
import * as Legacy from "./platformResourceRecipeCapabilityLegacy.js";

export * from "./platformResourceRecipeCapabilityLegacy.js";

const VALID_RECIPE_STATUSES = new Set(["planned", "active", "disabled"]);
const READ_ONLY_INSTALLED_TOOL_ALLOWLIST = new Set(["google_drive_folder_inspect"]);
const READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST = new Set(["google_drive.session_folder.reconcile_artifacts_exports"]);
const READ_ONLY_ENDPOINT_RECIPE_ALLOWLIST = new Set(["repo.pr.reconciliation_sweep"]);

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function asString(value) {
  return String(value || "").trim();
}

function clampLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function placeholders(values = []) {
  return values.map(() => "?").join(", ");
}

function normalizeRecipeRow(row = {}) {
  return {
    recipe_key: row.recipe_key,
    resource_type: row.resource_type,
    resource_family: row.resource_family || null,
    provider_key: row.provider_key || null,
    operation_key: row.operation_key,
    adapter_key: row.adapter_key,
    adapter_kind: row.adapter_kind || null,
    installed_tool_key: row.installed_tool_key || null,
    risk_class: row.risk_class,
    mode: row.mode,
    read_only: Boolean(row.read_only),
    requires_dry_run: Boolean(row.requires_dry_run),
    requires_capability_envelope: Boolean(row.requires_capability_envelope),
    requires_typed_confirmation: Boolean(row.requires_typed_confirmation),
    requires_same_cycle_readback: Boolean(row.requires_same_cycle_readback),
    authority_requirement_key: row.authority_requirement_key || null,
    graph_write_policy: row.graph_write_policy || null,
    engine_key: row.engine_key || null,
    status: row.status,
    input_schema: parseJson(row.input_schema_json, null),
    output_schema: parseJson(row.output_schema_json, null),
    policy: parseJson(row.policy_json, null),
    notes: row.notes || null,
    secrets_included: false,
  };
}

function normalizeStepRow(row = {}) {
  return {
    step_order: Number(row.step_order || 0),
    step_key: row.step_key,
    step_kind: row.step_kind,
    parent_action_key: row.parent_action_key || null,
    endpoint_key: row.endpoint_key || null,
    tool_key: row.tool_key || null,
    source_table: row.source_table || null,
    source_pk_template: parseJson(row.source_pk_template_json, null),
    query_template: parseJson(row.query_template_json, null),
    body_template: parseJson(row.body_template_json, null),
    response_projection: parseJson(row.response_projection_json, null),
    required: Boolean(row.required),
    on_error_policy: row.on_error_policy,
    status: row.status,
    execution_allowed_v1: false,
    secrets_included: false,
  };
}

function resolveRecipePools(deps = {}) {
  const runtimePool = deps.runtimePool || getPool();
  const governancePool = resolvePlatformResourceAuthorityPool({
    authorityStorePool: deps.recipeStorePool,
    governancePool: deps.governancePool,
  });
  assertPlatformResourceAuthorityStoreSource({ pool: governancePool, runtimePool });
  return { runtimePool, governancePool };
}

async function loadRuntimeMetadata(runtimePool, resourceTypes = [], adapterKeys = []) {
  const types = [...new Set(resourceTypes.filter(Boolean))];
  const adapters = [...new Set(adapterKeys.filter(Boolean))];
  const typeMap = new Map();
  const adapterMap = new Map();

  if (types.length) {
    const [rows] = await runtimePool.query(
      `SELECT resource_type, resource_family, provider_key, display_name
         FROM platform_resource_types
        WHERE resource_type IN (${placeholders(types)})`,
      types,
    );
    for (const row of rows || []) typeMap.set(row.resource_type, row);
  }
  if (adapters.length) {
    const [rows] = await runtimePool.query(
      `SELECT adapter_key, adapter_kind, installed_tool_key
         FROM platform_resource_adapters
        WHERE adapter_key IN (${placeholders(adapters)})`,
      adapters,
    );
    for (const row of rows || []) adapterMap.set(row.adapter_key, row);
  }
  return { typeMap, adapterMap };
}

function enrichRecipeRow(row, metadata) {
  return {
    ...row,
    ...(metadata.typeMap.get(row.resource_type) || {}),
    ...(metadata.adapterMap.get(row.adapter_key) || {}),
  };
}

async function getRecipeByKey(recipeKey, deps = {}) {
  const key = asString(recipeKey);
  if (!key) {
    const err = new Error("recipe_key is required.");
    err.status = 400;
    err.code = "missing_recipe_key";
    throw err;
  }
  const { runtimePool, governancePool } = resolveRecipePools(deps);
  const [rows] = await governancePool.query(
    "SELECT r.* FROM platform_resource_recipes r WHERE r.recipe_key = ? LIMIT 1",
    [key],
  );
  if (!rows?.length) {
    const err = new Error(`Resource recipe ${key} not found.`);
    err.status = 404;
    err.code = "resource_recipe_not_found";
    throw err;
  }
  const row = rows[0];
  const metadata = await loadRuntimeMetadata(runtimePool, [row.resource_type], [row.adapter_key]);
  return normalizeRecipeRow(enrichRecipeRow(row, metadata));
}

async function listRecipeSteps(recipeKey, deps = {}) {
  const { governancePool } = resolveRecipePools(deps);
  const [rows] = await governancePool.query(
    `SELECT step_order, step_key, step_kind, parent_action_key, endpoint_key, tool_key,
            source_table, source_pk_template_json, query_template_json, body_template_json,
            response_projection_json, required, on_error_policy, status
       FROM platform_resource_recipe_steps
      WHERE recipe_key = ?
      ORDER BY step_order ASC, step_id ASC`,
    [recipeKey],
  );
  return (rows || []).map(normalizeStepRow);
}

async function matchingRuntimeKeys(runtimePool, args = {}, search = "") {
  let providerTypes = null;
  let searchTypes = [];
  let searchAdapters = [];
  if (args.provider_key) {
    const [rows] = await runtimePool.query(
      "SELECT resource_type FROM platform_resource_types WHERE provider_key = ?",
      [asString(args.provider_key)],
    );
    providerTypes = (rows || []).map((row) => row.resource_type).filter(Boolean);
  }
  if (search) {
    const like = `%${search}%`;
    const [typeRows] = await runtimePool.query(
      "SELECT resource_type FROM platform_resource_types WHERE display_name LIKE ?",
      [like],
    );
    const [adapterRows] = await runtimePool.query(
      "SELECT adapter_key FROM platform_resource_adapters WHERE adapter_key LIKE ?",
      [like],
    );
    searchTypes = (typeRows || []).map((row) => row.resource_type).filter(Boolean);
    searchAdapters = (adapterRows || []).map((row) => row.adapter_key).filter(Boolean);
  }
  return { providerTypes, searchTypes, searchAdapters };
}

export async function resolveGovernedResource(args = {}, deps = {}) {
  const resolved = Legacy.resolveResourceRefInput(args);
  const recipe = args.recipe_key ? await getRecipeByKey(args.recipe_key, deps) : null;
  return {
    ok: Boolean(resolved),
    tool: "governed_resource_resolve",
    classification: resolved ? "resolved" : "unresolved",
    resolved_resource: resolved,
    recipe_hint: recipe,
    provider_calls_made: 0,
    execution_allowed: false,
    secrets_included: false,
  };
}

export async function catalogGovernedResources(args = {}, deps = {}) {
  const { runtimePool, governancePool } = resolveRecipePools(deps);
  const conditions = ["1=1"];
  const params = [];

  for (const [argKey, column] of [["resource_type", "r.resource_type"], ["operation_key", "r.operation_key"]]) {
    if (args[argKey]) {
      conditions.push(`${column} = ?`);
      params.push(asString(args[argKey]));
    }
  }
  if (args.status) {
    const status = asString(args.status);
    if (!VALID_RECIPE_STATUSES.has(status)) {
      const err = new Error("status must be one of: planned, active, disabled.");
      err.status = 400;
      err.code = "invalid_status";
      throw err;
    }
    conditions.push("r.status = ?");
    params.push(status);
  }

  const search = asString(args.search);
  const runtimeKeys = await matchingRuntimeKeys(runtimePool, args, search);
  if (runtimeKeys.providerTypes !== null) {
    if (!runtimeKeys.providerTypes.length) conditions.push("1=0");
    else {
      conditions.push(`r.resource_type IN (${placeholders(runtimeKeys.providerTypes)})`);
      params.push(...runtimeKeys.providerTypes);
    }
  }
  if (search) {
    const like = `%${search}%`;
    const searchClauses = ["r.recipe_key LIKE ?", "r.operation_key LIKE ?", "r.resource_type LIKE ?"];
    const searchParams = [like, like, like];
    if (runtimeKeys.searchTypes.length) {
      searchClauses.push(`r.resource_type IN (${placeholders(runtimeKeys.searchTypes)})`);
      searchParams.push(...runtimeKeys.searchTypes);
    }
    if (runtimeKeys.searchAdapters.length) {
      searchClauses.push(`r.adapter_key IN (${placeholders(runtimeKeys.searchAdapters)})`);
      searchParams.push(...runtimeKeys.searchAdapters);
    }
    conditions.push(`(${searchClauses.join(" OR ")})`);
    params.push(...searchParams);
  }

  const limit = clampLimit(args.limit, 50, 200);
  params.push(limit);
  const [rows] = await governancePool.query(
    `SELECT r.*
       FROM platform_resource_recipes r
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.status = 'active' DESC, r.resource_type ASC, r.recipe_key ASC
      LIMIT ?`,
    params,
  );
  const metadata = await loadRuntimeMetadata(
    runtimePool,
    (rows || []).map((row) => row.resource_type),
    (rows || []).map((row) => row.adapter_key),
  );
  const recipes = (rows || []).map((row) => normalizeRecipeRow(enrichRecipeRow(row, metadata)));
  const stepsByRecipe = {};
  if (args.include_steps === true) {
    for (const recipe of recipes) stepsByRecipe[recipe.recipe_key] = await listRecipeSteps(recipe.recipe_key, deps);
  }

  return {
    ok: true,
    tool: "governed_resource_catalog",
    filters: {
      provider_key: args.provider_key || null,
      resource_type: args.resource_type || null,
      operation_key: args.operation_key || null,
      status: args.status || null,
      search: search || null,
      include_steps: args.include_steps === true,
      limit,
    },
    count: recipes.length,
    recipes,
    ...(args.include_steps === true ? { steps_by_recipe: stepsByRecipe } : {}),
    provider_calls_made: 0,
    execution_allowed: false,
    secrets_included: false,
  };
}

function isMutatingRiskClass(riskClass = "") {
  return ["write", "mutation", "destructive"].includes(asString(riskClass));
}

function executableInstalledToolSteps(steps = []) {
  return steps.filter((step) => step.status === "active" && step.step_kind === "installed_tool_call" && READ_ONLY_INSTALLED_TOOL_ALLOWLIST.has(step.tool_key));
}

function readOnlyRecipeExecutionReady(recipe = {}, steps = [], blockedReasons = []) {
  if (blockedReasons.length > 0 || recipe.status !== "active" || recipe.read_only !== true) return false;
  if (recipe.adapter_kind === "installed_tool") {
    return READ_ONLY_INSTALLED_TOOL_ALLOWLIST.has(recipe.installed_tool_key) && executableInstalledToolSteps(steps).some((step) => step.tool_key === recipe.installed_tool_key);
  }
  if (recipe.adapter_kind === "composite") {
    return READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST.has(recipe.recipe_key) && executableInstalledToolSteps(steps).length > 0;
  }
  if (recipe.adapter_kind === "endpoint_recipe") return READ_ONLY_ENDPOINT_RECIPE_ALLOWLIST.has(recipe.recipe_key);
  return false;
}

function selectedInstalledToolKey(recipe = {}, steps = []) {
  if (recipe.adapter_kind === "installed_tool" && READ_ONLY_INSTALLED_TOOL_ALLOWLIST.has(recipe.installed_tool_key)) return recipe.installed_tool_key;
  return executableInstalledToolSteps(steps)[0]?.tool_key || null;
}

export async function planGovernedResource(args = {}, deps = {}) {
  const recipe = await getRecipeByKey(args.recipe_key, deps);
  const resolved = Legacy.resolveResourceRefInput({ ...args, resource_type: recipe.resource_type });
  const steps = await listRecipeSteps(recipe.recipe_key, deps);
  const dryRun = args.dry_run !== false;
  const requestedOptions = args.options && typeof args.options === "object" ? args.options : {};
  const blockedReasons = [];
  if (!recipe.read_only) blockedReasons.push("recipe_not_read_only");
  if (isMutatingRiskClass(recipe.risk_class)) blockedReasons.push("mutating_recipe_requires_future_guarded_apply_runtime");
  if (requestedOptions.file_content === true || requestedOptions.include_file_content === true) blockedReasons.push("file_content_blocked_v1");
  if (!resolved) blockedReasons.push("resource_ref_unresolved");

  const readOnlyExecutionReady = readOnlyRecipeExecutionReady(recipe, steps, blockedReasons);
  const selectedToolKey = selectedInstalledToolKey(recipe, steps);
  const executionClass = readOnlyExecutionReady && recipe.adapter_kind === "endpoint_recipe"
    ? "resource_recipe_read_only_endpoint_recipe_v1"
    : readOnlyExecutionReady && recipe.adapter_kind === "composite"
      ? "resource_recipe_read_only_composite_v1"
      : readOnlyExecutionReady
        ? "resource_recipe_read_only_installed_tool_v1"
        : "resource_recipe_plan_only_v1";

  return {
    ok: true,
    tool: "governed_resource_plan",
    recipe,
    resolved_resource: resolved,
    dry_run: dryRun,
    execution_plan: {
      execution_class: executionClass,
      provider_calls_planned: readOnlyExecutionReady && recipe.adapter_kind === "endpoint_recipe" ? 1 : 0,
      provider_calls_allowed: readOnlyExecutionReady && recipe.adapter_kind === "endpoint_recipe",
      db_reads_planned: steps.filter((step) => step.step_kind === "db_read").length,
      installed_tool_calls_planned: steps.filter((step) => step.step_kind === "installed_tool_call").length,
      installed_tool_calls_allowed_v1: readOnlyExecutionReady,
      selected_installed_tool_key: selectedToolKey,
      allowed_installed_tools: [...READ_ONLY_INSTALLED_TOOL_ALLOWLIST],
      allowed_composite_recipes: [...READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST],
      graph_projection_planned: recipe.graph_write_policy !== "none",
      graph_projection_allowed_v1: false,
      steps,
    },
    policy_decision: {
      decision: blockedReasons.length ? "blocked_by_v1_policy" : readOnlyExecutionReady ? "read_only_execution_ready" : "plan_ready_no_execution",
      blocked_reasons: blockedReasons,
      requires_capability_envelope: Boolean(recipe.requires_capability_envelope),
      requires_dry_run: Boolean(recipe.requires_dry_run),
      requires_typed_confirmation: Boolean(recipe.requires_typed_confirmation),
      authority_requirement_key: recipe.authority_requirement_key || null,
      secrets_included: false,
    },
    provider_calls_made: 0,
    execution_allowed: false,
    secrets_included: false,
  };
}
