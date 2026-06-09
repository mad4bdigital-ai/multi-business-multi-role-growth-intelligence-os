import { getPool } from "./db.js";

export const PLATFORM_RESOURCE_RECIPE_TOOL_NAMES = [
  "governed_resource_resolve",
  "governed_resource_catalog",
  "governed_resource_plan",
  "governed_resource_run",
];

export const PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS = [
  {
    name: "governed_resource_resolve",
    description: "Admin-only read-only resolver for governed resource references. Normalizes Drive folder, GitHub branch, Platform Plugin, session archive, and execution-log resource refs without provider calls or secrets.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Optional URI/URL/reference string to classify." },
        resource_type: { type: "string" },
        resource_ref: { type: "object", additionalProperties: true },
        recipe_key: { type: "string", description: "Optional recipe hint." },
      },
      required: [],
    },
  },
  {
    name: "governed_resource_catalog",
    description: "Admin-only read-only catalog for platform_resource_* registry rows. Lists resource types, adapters, recipes, and steps without executing endpoints or providers.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        provider_key: { type: "string" },
        resource_type: { type: "string" },
        operation_key: { type: "string" },
        status: { type: "string", enum: ["planned", "active", "disabled"] },
        search: { type: "string" },
        include_steps: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: [],
    },
  },
  {
    name: "governed_resource_plan",
    description: "Admin-only read-only planner for a governed resource recipe. Returns selected recipe, adapter, policy, and step plan. Does not call providers and does not apply changes.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        recipe_key: { type: "string" },
        resource_ref: { type: "object", additionalProperties: true },
        input: { type: "string" },
        options: { type: "object", additionalProperties: true },
        dry_run: { type: "boolean", default: true },
      },
      required: ["recipe_key"],
    },
  },
  {
    name: "governed_resource_run",
    description: "Admin-only guarded runtime for governed resource recipes. V1 allows approved read-only installed-tool recipes only and blocks writes, deletes, moves, file content, raw endpoint execution, and secrets.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        recipe_key: { type: "string" },
        resource_ref: { type: "object", additionalProperties: true },
        input: { type: "string" },
        mode: { type: "string", enum: ["plan", "read_only", "diagnostic", "apply"], default: "plan" },
        options: { type: "object", additionalProperties: true },
        capability_envelope_id: { type: "string" },
        typed_confirmation: { type: "string" },
      },
      required: ["recipe_key"],
    },
  },
];

const VALID_RECIPE_STATUSES = new Set(["planned", "active", "disabled"]);

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clampLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function asString(value) {
  return String(value || "").trim();
}

function parseGoogleDriveFolderRef(input = "") {
  const value = asString(input);
  if (!value) return null;
  const folderMatch = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return {
      resource_type: "drive_folder",
      resource_uri: `gdrive://folder/${folderMatch[1]}`,
      resource_ref: { folder_id: folderMatch[1], folder_url: value },
      confidence: "high",
    };
  }
  const idMatch = value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (idMatch?.[1]) {
    return {
      resource_type: "drive_folder",
      resource_uri: `gdrive://folder/${idMatch[1]}`,
      resource_ref: { folder_id: idMatch[1], folder_url: value },
      confidence: "medium",
    };
  }
  const gdriveMatch = value.match(/^gdrive:\/\/folder\/([A-Za-z0-9_-]+)$/i);
  if (gdriveMatch?.[1]) {
    return {
      resource_type: "drive_folder",
      resource_uri: `gdrive://folder/${gdriveMatch[1]}`,
      resource_ref: { folder_id: gdriveMatch[1] },
      confidence: "high",
    };
  }
  return null;
}

function parseGithubBranchRef(input = "") {
  const value = asString(input);
  if (!value) return null;
  const githubUrl = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/i);
  if (githubUrl) {
    const repo = githubUrl[2].replace(/\.git$/i, "");
    const branch = decodeURIComponent(githubUrl[3]);
    return {
      resource_type: "github_branch",
      resource_uri: `github://${githubUrl[1]}/${repo}/branch/${branch}`,
      resource_ref: { owner: githubUrl[1], repo, branch },
      confidence: "high",
    };
  }
  const githubScheme = value.match(/^github:\/\/([^/]+)\/([^/]+)\/branch\/(.+)$/i);
  if (githubScheme) {
    return {
      resource_type: "github_branch",
      resource_uri: `github://${githubScheme[1]}/${githubScheme[2]}/branch/${githubScheme[3]}`,
      resource_ref: { owner: githubScheme[1], repo: githubScheme[2], branch: githubScheme[3] },
      confidence: "high",
    };
  }
  return null;
}

function normalizeObjectResourceRef(resourceRef = {}, resourceType = "") {
  const ref = resourceRef && typeof resourceRef === "object" ? { ...resourceRef } : {};
  const type = asString(resourceType || ref.resource_type);

  if ((type === "drive_folder" || ref.folder_id || ref.folder_url) && (ref.folder_id || ref.folder_url)) {
    const folderId = asString(ref.folder_id) || parseGoogleDriveFolderRef(ref.folder_url)?.resource_ref?.folder_id || "";
    if (folderId) {
      return {
        resource_type: "drive_folder",
        resource_uri: `gdrive://folder/${folderId}`,
        resource_ref: { ...ref, folder_id: folderId },
        confidence: "high",
      };
    }
  }

  if ((type === "github_branch" || ref.owner || ref.repo || ref.branch) && ref.owner && ref.repo && ref.branch) {
    return {
      resource_type: "github_branch",
      resource_uri: `github://${ref.owner}/${ref.repo}/branch/${ref.branch}`,
      resource_ref: { owner: ref.owner, repo: ref.repo, branch: ref.branch },
      confidence: "high",
    };
  }

  if ((type === "platform_plugin_contribution" || ref.contribution_id) && ref.contribution_id) {
    return {
      resource_type: "platform_plugin_contribution",
      resource_uri: `platform-plugin-contribution://${ref.contribution_id}`,
      resource_ref: { ...ref, contribution_id: asString(ref.contribution_id) },
      confidence: "high",
    };
  }

  if ((type === "platform_plugin_smoke_certification" || ref.certification_id) && ref.certification_id) {
    return {
      resource_type: "platform_plugin_smoke_certification",
      resource_uri: `platform-plugin-smoke-certification://${ref.certification_id}`,
      resource_ref: { ...ref, certification_id: asString(ref.certification_id) },
      confidence: "high",
    };
  }

  if ((type === "session_archive_folder" || ref.session_id) && ref.session_id) {
    return {
      resource_type: "session_archive_folder",
      resource_uri: `session-archive://${ref.session_id}`,
      resource_ref: { ...ref, session_id: asString(ref.session_id) },
      confidence: "high",
    };
  }

  if ((type === "execution_log_row" || ref.execution_log_id || ref.id) && (ref.execution_log_id || ref.id)) {
    const id = asString(ref.execution_log_id || ref.id);
    return {
      resource_type: "execution_log_row",
      resource_uri: `execution-log://${id}`,
      resource_ref: { ...ref, id },
      confidence: "medium",
    };
  }

  if (type) {
    return {
      resource_type: type,
      resource_uri: ref.resource_uri || `${type}://unresolved`,
      resource_ref: ref,
      confidence: Object.keys(ref).length ? "low" : "none",
    };
  }

  return null;
}

export function resolveResourceRefInput(args = {}) {
  const input = asString(args.input || args.resource_uri || args.url);
  const parsedInput = parseGoogleDriveFolderRef(input) || parseGithubBranchRef(input) || null;
  const hasExplicitRef =
    args.resource_ref &&
    typeof args.resource_ref === "object" &&
    Object.keys(args.resource_ref).length > 0;

  if (hasExplicitRef) {
    return normalizeObjectResourceRef(args.resource_ref, args.resource_type) || parsedInput;
  }

  return parsedInput || normalizeObjectResourceRef(args.resource_ref, args.resource_type);
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

async function getRecipeByKey(recipeKey) {
  const key = asString(recipeKey);
  if (!key) {
    const err = new Error("recipe_key is required.");
    err.status = 400;
    err.code = "missing_recipe_key";
    throw err;
  }

  const [rows] = await getPool().query(
    `SELECT r.*, t.resource_family, t.provider_key, a.adapter_kind, a.installed_tool_key
       FROM platform_resource_recipes r
       LEFT JOIN platform_resource_types t ON t.resource_type = r.resource_type
       LEFT JOIN platform_resource_adapters a ON a.adapter_key = r.adapter_key
      WHERE r.recipe_key = ?
      LIMIT 1`,
    [key]
  );

  if (!rows.length) {
    const err = new Error(`Resource recipe ${key} not found.`);
    err.status = 404;
    err.code = "resource_recipe_not_found";
    throw err;
  }

  return normalizeRecipeRow(rows[0]);
}

async function listRecipeSteps(recipeKey) {
  const [rows] = await getPool().query(
    `SELECT step_order, step_key, step_kind, parent_action_key, endpoint_key, tool_key,
            source_table, source_pk_template_json, query_template_json, body_template_json,
            response_projection_json, required, on_error_policy, status
       FROM platform_resource_recipe_steps
      WHERE recipe_key = ?
      ORDER BY step_order ASC, step_id ASC`,
    [recipeKey]
  );
  return rows.map(normalizeStepRow);
}

export async function resolveGovernedResource(args = {}) {
  const resolved = resolveResourceRefInput(args);
  const recipe = args.recipe_key ? await getRecipeByKey(args.recipe_key) : null;

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

export async function catalogGovernedResources(args = {}) {
  const conditions = ["1=1"];
  const params = [];

  for (const [argKey, column] of [
    ["provider_key", "t.provider_key"],
    ["resource_type", "r.resource_type"],
    ["operation_key", "r.operation_key"],
  ]) {
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
  if (search) {
    conditions.push("(r.recipe_key LIKE ? OR r.operation_key LIKE ? OR r.resource_type LIKE ? OR t.display_name LIKE ? OR a.adapter_key LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }

  const limit = clampLimit(args.limit, 50, 200);
  params.push(limit);

  const [rows] = await getPool().query(
    `SELECT r.*, t.resource_family, t.provider_key, a.adapter_kind, a.installed_tool_key
       FROM platform_resource_recipes r
       LEFT JOIN platform_resource_types t ON t.resource_type = r.resource_type
       LEFT JOIN platform_resource_adapters a ON a.adapter_key = r.adapter_key
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.status = 'active' DESC, r.resource_type ASC, r.recipe_key ASC
      LIMIT ?`,
    params
  );

  const recipes = rows.map(normalizeRecipeRow);
  const stepsByRecipe = {};
  if (args.include_steps === true) {
    for (const recipe of recipes) {
      stepsByRecipe[recipe.recipe_key] = await listRecipeSteps(recipe.recipe_key);
    }
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

const ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY = "google_drive.session_folder.reconcile_artifacts_exports";

const READ_ONLY_INSTALLED_TOOL_ALLOWLIST = new Set([
  "google_drive_folder_inspect",
]);

const READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST = new Set([
  ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY,
]);

function isMutatingRiskClass(riskClass = "") {
  return ["write", "mutation", "destructive"].includes(asString(riskClass));
}

function boolOption(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function executableInstalledToolSteps(steps = []) {
  return steps.filter((step) =>
    step.status === "active" &&
    step.step_kind === "installed_tool_call" &&
    READ_ONLY_INSTALLED_TOOL_ALLOWLIST.has(step.tool_key)
  );
}

function readOnlyRecipeExecutionReady(recipe = {}, steps = [], blockedReasons = []) {
  if (blockedReasons.length > 0 || recipe.status !== "active" || recipe.read_only !== true) return false;

  if (recipe.adapter_kind === "installed_tool") {
    return (
      READ_ONLY_INSTALLED_TOOL_ALLOWLIST.has(recipe.installed_tool_key) &&
      executableInstalledToolSteps(steps).some((step) => step.tool_key === recipe.installed_tool_key)
    );
  }

  if (recipe.adapter_kind === "composite") {
    return (
      READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST.has(recipe.recipe_key) &&
      executableInstalledToolSteps(steps).length > 0
    );
  }

  return false;
}

function selectedInstalledToolKey(recipe = {}, steps = []) {
  if (recipe.adapter_kind === "installed_tool" && READ_ONLY_INSTALLED_TOOL_ALLOWLIST.has(recipe.installed_tool_key)) {
    return recipe.installed_tool_key;
  }
  return executableInstalledToolSteps(steps)[0]?.tool_key || null;
}

function buildInstalledToolArgs(plan = {}, args = {}) {
  const recipe = plan.recipe || {};
  const policy = recipe.policy || {};
  const resolved = plan.resolved_resource || {};
  const ref = resolved.resource_ref || {};
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const maxDepth = boundedNumber(options.max_depth ?? args.max_depth ?? ref.max_depth, 1, 0, Math.min(Number(policy.max_depth || 3), 3));
  const pageSize = boundedNumber(options.page_size ?? args.page_size, 100, 1, 200);

  if (recipe.installed_tool_key === "google_drive_folder_inspect") {
    return {
      folder_id: ref.folder_id || args.folder_id || undefined,
      folder_url: ref.folder_url || args.folder_url || args.input || undefined,
      recursive: boolOption(options.recursive ?? args.recursive, maxDepth > 1),
      max_depth: maxDepth,
      page_size: pageSize,
      credential_scope: args.credential_scope || options.credential_scope || "platform",
      connection_id: args.connection_id || options.connection_id || undefined,
      tenant_id: args.tenant_id || options.tenant_id || undefined,
      user_id: args.user_id || options.user_id || undefined,
      allow_platform_fallback: boolOption(args.allow_platform_fallback ?? options.allow_platform_fallback, true),
    };
  }

  return { ...ref, ...options };
}

export async function planGovernedResource(args = {}) {
  const recipe = await getRecipeByKey(args.recipe_key);
  const resolved = resolveResourceRefInput({ ...args, resource_type: recipe.resource_type });
  const steps = await listRecipeSteps(recipe.recipe_key);
  const dryRun = args.dry_run !== false;
  const requestedOptions = args.options && typeof args.options === "object" ? args.options : {};

  const blockedReasons = [];
  if (!recipe.read_only) blockedReasons.push("recipe_not_read_only");
  if (isMutatingRiskClass(recipe.risk_class)) {
    blockedReasons.push("mutating_recipe_requires_future_guarded_apply_runtime");
  }
  if (requestedOptions.file_content === true || requestedOptions.include_file_content === true) {
    blockedReasons.push("file_content_blocked_v1");
  }
  if (!resolved) blockedReasons.push("resource_ref_unresolved");

  const installedToolReady = readOnlyInstalledToolExecutionReady(recipe, steps, blockedReasons);

  return {
    ok: true,
    tool: "governed_resource_plan",
    recipe,
    resolved_resource: resolved,
    dry_run: dryRun,
    execution_plan: {
      execution_class: installedToolReady ? "resource_recipe_read_only_installed_tool_v1" : "resource_recipe_plan_only_v1",
      provider_calls_planned: 0,
      provider_calls_allowed: false,
      db_reads_planned: steps.filter((step) => step.step_kind === "db_read").length,
      installed_tool_calls_planned: steps.filter((step) => step.step_kind === "installed_tool_call").length,
      installed_tool_calls_allowed_v1: installedToolReady,
      allowed_installed_tools: [...READ_ONLY_INSTALLED_TOOL_ALLOWLIST],
      graph_projection_planned: recipe.graph_write_policy !== "none",
      graph_projection_allowed_v1: false,
      steps,
    },
    policy_decision: {
      decision: blockedReasons.length ? "blocked_by_v1_policy" : installedToolReady ? "read_only_execution_ready" : "plan_ready_no_execution",
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

export async function runGovernedResource(args = {}, deps = {}) {
  const plan = await planGovernedResource({ ...args, dry_run: true });
  const mode = asString(args.mode || "plan") || "plan";
  const applyRequested = mode === "apply" || args.apply === true;
  const recipe = plan.recipe || {};
  const blockedReasons = plan.policy_decision?.blocked_reasons || [];

  if (mode === "plan") {
    return {
      ok: true,
      tool: "governed_resource_run",
      classification: "plan_ready_no_execution",
      mode,
      apply_requested: false,
      apply_allowed: false,
      dispatch_allowed: false,
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  if (applyRequested) {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_apply_not_supported_v1",
      mode,
      apply_requested: true,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: "resource_recipe_apply_blocked_v1",
      message: "Resource recipe V1 does not apply writes, deletes, moves, content reads, or graph mutations.",
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  if (!["read_only", "diagnostic"].includes(mode)) {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_invalid_mode_v1",
      mode,
      apply_requested: false,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: "resource_recipe_mode_not_supported_v1",
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  if (blockedReasons.length) {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_by_v1_policy",
      mode,
      apply_requested: false,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: "resource_recipe_policy_blocked_v1",
      blocked_reasons: blockedReasons,
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  if (!readOnlyInstalledToolExecutionReady(recipe, plan.execution_plan?.steps || [], [])) {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_unsupported_recipe_runtime_v1",
      mode,
      apply_requested: false,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: "resource_recipe_runtime_not_allowlisted_v1",
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  if (typeof deps.executeInstalledTool !== "function") {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_executor_missing",
      mode,
      apply_requested: false,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: "resource_recipe_installed_tool_executor_missing",
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  const toolKey = recipe.installed_tool_key;
  const toolArgs = buildInstalledToolArgs(plan, args);
  const startedAt = new Date().toISOString();
  const installedToolResult = await deps.executeInstalledTool(toolKey, toolArgs, { plan, mode });
  const completedAt = new Date().toISOString();

  return {
    ok: true,
    tool: "governed_resource_run",
    classification: "read_only_executed",
    mode,
    recipe_key: recipe.recipe_key,
    resource_type: recipe.resource_type,
    resource_uri: plan.resolved_resource?.resource_uri || null,
    installed_tool_key: toolKey,
    installed_tool_args: toolArgs,
    execution_evidence: {
      execution_class: "resource_recipe_read_only_installed_tool_v1",
      started_at: startedAt,
      completed_at: completedAt,
      provider_calls_allowed_directly_by_resource_engine: false,
      installed_tool_call_made: true,
      graph_write_made: false,
      file_content_returned: false,
      secrets_included: false,
    },
    result: installedToolResult,
    plan,
    apply_requested: false,
    apply_allowed: false,
    dispatch_allowed: true,
    provider_calls_made: 0,
    execution_allowed: true,
    secrets_included: false,
  };
}
