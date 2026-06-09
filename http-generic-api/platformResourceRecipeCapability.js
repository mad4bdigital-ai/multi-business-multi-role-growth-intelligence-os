import { createHash } from "node:crypto";

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
        mode: { type: "string", enum: ["plan", "read_only", "diagnostic", "continue_read_only", "manifest_dry_run", "apply"], default: "plan" },
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

function buildInstalledToolArgs(plan = {}, args = {}, explicitToolKey = null) {
  const recipe = plan.recipe || {};
  const policy = recipe.policy || {};
  const resolved = plan.resolved_resource || {};
  const ref = resolved.resource_ref || {};
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const toolKey = explicitToolKey || recipe.installed_tool_key;
  const isArtifactReconcile = recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY;
  const defaultMaxDepth = isArtifactReconcile ? 1 : 1;
  const maxDepth = boundedNumber(options.max_depth ?? args.max_depth ?? ref.max_depth, defaultMaxDepth, 0, Math.min(Number(policy.max_depth || 3), 3));
  const pageSize = boundedNumber(options.page_size ?? args.page_size, 100, 1, 200);

  if (toolKey === "google_drive_folder_inspect") {
    return {
      folder_id: ref.folder_id || args.folder_id || undefined,
      folder_url: ref.folder_url || args.folder_url || args.input || undefined,
      recursive: isArtifactReconcile ? false : boolOption(options.recursive ?? args.recursive, maxDepth > 1),
      max_depth: isArtifactReconcile ? 0 : maxDepth,
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

function driveFileLite(file = {}) {
  return {
    id: file.id || null,
    name: file.name || null,
    mimeType: file.mimeType || null,
    size: file.size || null,
    is_folder: Boolean(file.is_folder),
    webViewLink: file.webViewLink || null,
  };
}

function lowerName(file = {}) {
  return String(file.name || "").trim().toLowerCase();
}

function baseName(file = {}) {
  return lowerName(file).replace(/\.[^.]+$/, "");
}

function nestedFolderByName(tree = {}, name = "") {
  const target = String(name).toLowerCase();
  const nested = Array.isArray(tree.nested) ? tree.nested : [];
  const fromNested = nested.find((entry) => lowerName(entry.folder) === target);
  if (fromNested) return fromNested;
  const child = (Array.isArray(tree.children) ? tree.children : []).find((entry) => entry.is_folder && lowerName(entry) === target);
  return child ? { folder: child, children: [], nested: [] } : null;
}

function nonFolderChildren(node = null) {
  return (Array.isArray(node?.children) ? node.children : []).filter((child) => !child.is_folder);
}

function duplicateNameGroups(files = []) {
  const groups = new Map();
  for (const file of files) {
    const key = lowerName(file);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(driveFileLite(file));
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function buildSourceInspectionSummary(installedToolResult = {}) {
  const tree = installedToolResult?.tree || {};
  const childInspections = Array.isArray(installedToolResult?.child_inspections) ? installedToolResult.child_inspections : [];
  return {
    ok: Boolean(installedToolResult?.ok),
    adapter: installedToolResult?.adapter || null,
    requested_folder_id: installedToolResult?.requested_folder_id || tree.folder?.id || null,
    traversal_strategy: installedToolResult?.traversal_strategy || "single_inspect",
    child_traversal_status: installedToolResult?.child_traversal_status || null,
    installed_tool_call_count: Number(installedToolResult?.installed_tool_call_count || 1),
    targeted_child_names: childInspections.map((entry) => entry.name).filter(Boolean),
    recursive: Boolean(installedToolResult?.recursive),
    max_depth: installedToolResult?.max_depth ?? tree.depth ?? null,
    page_size: installedToolResult?.page_size ?? null,
    root_folder: driveFileLite(tree.folder || {}),
    root_child_count: Number(tree.child_count ?? (Array.isArray(tree.children) ? tree.children.length : 0)),
    folder_count: Number(tree.folder_count || 0),
    file_count: Number(tree.file_count || 0),
    nested_count: Array.isArray(tree.nested) ? tree.nested.length : 0,
    has_next_page_token: Boolean(tree.next_page_token),
    source_tree_included: false,
    secrets_included: false,
  };
}

function requiredArtifactExportChildNames(plan = {}) {
  const policy = plan.recipe?.policy || {};
  return Array.isArray(policy.required_child_folders) ? policy.required_child_folders : ["Artifacts", "Exports"];
}

function targetableChildFolders(tree = {}, names = []) {
  const allowed = new Set(names.map((name) => String(name).toLowerCase()));
  return (Array.isArray(tree.children) ? tree.children : [])
    .filter((child) => child.is_folder && allowed.has(lowerName(child)) && child.id)
    .map(driveFileLite);
}

function childNameMatches(folder = {}, targetName = "") {
  return lowerName(folder) === String(targetName || "").trim().toLowerCase();
}

function selectContinuationChildFolders(childFolders = [], args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const targetChildName = asString(options.target_child_name || options.child_name || args.target_child_name || args.child_name);
  const targetChildFolderId = asString(options.target_child_folder_id || options.child_folder_id || args.target_child_folder_id || args.child_folder_id);

  if (targetChildFolderId) {
    const matched = childFolders.find((folder) => folder.id === targetChildFolderId);
    return matched ? [matched] : [{ id: targetChildFolderId, name: targetChildName || "target_child", is_folder: true }];
  }

  if (targetChildName) {
    return childFolders.filter((folder) => childNameMatches(folder, targetChildName));
  }

  return [];
}

function buildChildContinuationBlockedResult({ reasonCode, message, plan, childFolders = [] } = {}) {
  return {
    ok: false,
    tool: "governed_resource_run",
    classification: "blocked_child_continuation_v1",
    mode: "continue_read_only",
    apply_requested: false,
    apply_allowed: false,
    dispatch_allowed: false,
    reason_code: reasonCode,
    message,
    child_candidates: childFolders.map((folder) => driveFileLite(folder)),
    plan,
    provider_calls_made: 0,
    execution_allowed: false,
    secrets_included: false,
  };
}

function buildTargetedChildTraversalPlan(rootInspectResult = {}, childFolders = []) {
  return {
    ...rootInspectResult,
    traversal_strategy: "targeted_child_traversal_plan_v1",
    child_traversal_status: "planned_not_executed",
    installed_tool_call_count: 1,
    child_inspections: childFolders.map((folder) => ({
      name: folder?.name || null,
      folder_id: folder?.id || null,
      status: "planned_not_executed",
      ok: null,
      child_count: null,
      folder_count: null,
      file_count: null,
      secrets_included: false,
    })),
    secrets_included: false,
  };
}

function mergeTargetedChildInspections(rootInspectResult = {}, childInspectResults = []) {
  const rootTree = rootInspectResult?.tree || {};
  const nested = childInspectResults.map((entry) => ({
    folder: entry.folder,
    children: Array.isArray(entry.result?.tree?.children) ? entry.result.tree.children : [],
    nested: Array.isArray(entry.result?.tree?.nested) ? entry.result.tree.nested : [],
    child_count: Number(entry.result?.tree?.child_count || 0),
    folder_count: Number(entry.result?.tree?.folder_count || 0),
    file_count: Number(entry.result?.tree?.file_count || 0),
  }));
  const rootFolderCount = Number(rootTree.folder_count || 0);
  const rootFileCount = Number(rootTree.file_count || 0);
  const nestedFolderCount = nested.reduce((sum, entry) => sum + Number(entry.folder_count || 0), 0);
  const nestedFileCount = nested.reduce((sum, entry) => sum + Number(entry.file_count || 0), 0);
  return {
    ...rootInspectResult,
    traversal_strategy: "targeted_child_traversal_v1",
    child_traversal_status: "executed",
    installed_tool_call_count: 1 + childInspectResults.length,
    child_inspections: childInspectResults.map((entry) => ({
      name: entry.folder?.name || null,
      folder_id: entry.folder?.id || null,
      ok: Boolean(entry.result?.ok),
      child_count: Number(entry.result?.tree?.child_count || 0),
      folder_count: Number(entry.result?.tree?.folder_count || 0),
      file_count: Number(entry.result?.tree?.file_count || 0),
      secrets_included: false,
    })),
    tree: {
      ...rootTree,
      nested,
      folder_count: rootFolderCount + nestedFolderCount,
      file_count: rootFileCount + nestedFileCount,
    },
    secrets_included: false,
  };
}

function buildArtifactExportManifestPlan({ tree = {}, summary = {}, findings = [], classifications = [] } = {}) {
  const rootFolder = driveFileLite(tree.folder || {});
  const recommendedManifestName = `${rootFolder.name || "session_archive"}.artifact_export_manifest.json`;
  const findingEntries = findings.map((finding, index) => ({
    entry_type: "finding",
    ordinal: index + 1,
    code: finding.code || "unknown_finding",
    severity: finding.severity || "info",
    action: "review_before_any_write",
  }));

  return {
    ok: true,
    plan_version: "manifest_plan_v1",
    manifest_schema: "artifact_export_manifest.v1",
    classification: classifications[0] || "unknown",
    destination: {
      status: "not_created",
      recommended_name: recommendedManifestName,
      recommended_location: "reviewer_selected_after_approval",
    },
    proposed_manifest: {
      schema_version: "artifact_export_manifest.v1",
      generated_from: "governed_resource_read_only_reconciliation",
      root_folder: rootFolder,
      counts: {
        root_child_count: summary.root_child_count || 0,
        artifact_file_count: summary.artifact_file_count || 0,
        export_file_count: summary.export_file_count || 0,
        duplicate_group_count: summary.duplicate_group_count || 0,
        empty_file_count: summary.empty_file_count || 0,
        orphan_export_count: summary.orphan_export_count || 0,
        missing_export_count: summary.missing_export_count || 0,
      },
      required_child_folders: summary.required_child_folders || {},
      classifications,
      findings: findingEntries,
    },
    review_checklist: [
      "confirm_required_child_folders",
      "review_empty_resources",
      "review_duplicate_resources",
      "approve_manifest_write_in_future_runtime",
    ],
    next_operation_candidates: [
      {
        operation_key: "manifest.create_after_review",
        status: "future_guarded_apply_required",
        requires_dry_run: true,
        requires_capability_envelope: true,
        requires_typed_confirmation: true,
        same_cycle_readback_required: true,
      },
    ],
    apply_supported: false,
    write_operations_planned: false,
    drive_write_planned: false,
    graph_write_planned: false,
    provider_calls_planned: 0,
    file_content_required: false,
    secrets_included: false,
  };
}

function stableJson(value = {}) {
  return JSON.stringify(value, null, 2);
}

function sha256Hex(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

function buildArtifactExportManifestDryRun(reconciliation = {}, plan = {}, args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const manifestPlan = reconciliation.manifest_plan || {};
  const proposedManifest = manifestPlan.proposed_manifest || {};
  const rootFolder = proposedManifest.root_folder || reconciliation.summary?.root_folder || {};
  const filename = asString(options.manifest_filename) || manifestPlan.destination?.recommended_name || `${rootFolder.name || "session_archive"}.artifact_export_manifest.json`;
  const content = {
    ...proposedManifest,
    materialization: {
      mode: "manifest_dry_run",
      generated_at: new Date().toISOString(),
      source_recipe_key: ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY,
      source_resource_uri: plan.resolved_resource?.resource_uri || null,
      source_classification: reconciliation.classification || null,
      source_child_traversal_status: reconciliation.source_inspection_summary?.child_traversal_status || null,
      source_targeted_child_names: reconciliation.source_inspection_summary?.targeted_child_names || [],
      secrets_included: false,
    },
  };
  const contentJson = stableJson(content);

  return {
    ok: true,
    mode: "manifest_dry_run",
    classification: "manifest_dry_run_ready",
    filename,
    mime_type: "application/json",
    destination: {
      status: "not_created",
      recommended_location: manifestPlan.destination?.recommended_location || "reviewer_selected_after_approval",
      drive_write_executed: false,
    },
    content_preview: content,
    content_sha256: sha256Hex(contentJson),
    content_size_bytes: Buffer.byteLength(contentJson, "utf8"),
    apply_contract: {
      future_operation_key: "manifest.create_after_review",
      apply_supported_now: false,
      requires_dry_run: true,
      requires_capability_envelope: true,
      requires_typed_confirmation: true,
      typed_confirmation: `CREATE_MANIFEST:${filename}`,
      same_cycle_readback_required: true,
      overwrite_allowed: false,
    },
    write_operations_planned: false,
    drive_write_planned: false,
    drive_write_executed: false,
    graph_write_planned: false,
    graph_write_executed: false,
    provider_calls_planned: 0,
    file_content_required: false,
    file_content_returned: false,
    secrets_included: false,
  };
}

function buildArtifactExportReconciliation(installedToolResult = {}, plan = {}, args = {}) {
  const tree = installedToolResult?.tree || {};
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const includeSourceInspection = boolOption(options.include_source_inspection ?? args.include_source_inspection, false);
  const policy = plan.recipe?.policy || {};
  const requiredChildFolders = Array.isArray(policy.required_child_folders)
    ? policy.required_child_folders
    : ["Artifacts", "Exports"];
  const rootChildren = Array.isArray(tree.children) ? tree.children : [];
  const artifactsNode = nestedFolderByName(tree, "Artifacts");
  const exportsNode = nestedFolderByName(tree, "Exports");
  const required = {
    Artifacts: Boolean(artifactsNode),
    Exports: Boolean(exportsNode),
  };
  const missingRequiredChildFolders = requiredChildFolders.filter((name) => !required[name]);
  const rootFiles = rootChildren.filter((child) => !child.is_folder);
  const artifactFiles = nonFolderChildren(artifactsNode);
  const exportFiles = nonFolderChildren(exportsNode);
  const allVisibleFiles = [...rootFiles, ...artifactFiles, ...exportFiles];
  const emptyFiles = allVisibleFiles.filter((file) => !file.is_folder && Number(file.size || 0) === 0).map(driveFileLite);
  const duplicateGroups = duplicateNameGroups(allVisibleFiles);
  const artifactBaseNames = new Set(artifactFiles.map(baseName).filter(Boolean));
  const exportBaseNames = new Set(exportFiles.map(baseName).filter(Boolean));
  const orphanExports = artifactBaseNames.size
    ? exportFiles.filter((file) => !artifactBaseNames.has(baseName(file))).map(driveFileLite)
    : [];
  const missingExports = exportFiles.length === 0
    ? artifactFiles.map(driveFileLite)
    : artifactFiles.filter((file) => !exportBaseNames.has(baseName(file))).map(driveFileLite);

  const classifications = [];
  if (missingRequiredChildFolders.length) classifications.push("missing_required_child");
  if (artifactFiles.length === 0 && exportFiles.length === 0) classifications.push("artifacts_and_exports_empty");
  else if (exportFiles.length === 0) classifications.push("exports_empty");
  if (emptyFiles.length) classifications.push("empty_resource");
  if (duplicateGroups.length) classifications.push("duplicate_resource");
  if (orphanExports.length) classifications.push("orphan_resource");
  if (missingExports.length && artifactFiles.length) classifications.push("missing_export");
  if (!classifications.length) classifications.push("healthy");

  const findings = [];
  if (missingRequiredChildFolders.length) {
    findings.push({ code: "missing_required_child", severity: "high", child_folders: missingRequiredChildFolders });
  }
  if (artifactFiles.length === 0 && exportFiles.length === 0) {
    findings.push({ code: "artifacts_and_exports_empty", severity: "medium" });
  } else if (exportFiles.length === 0) {
    findings.push({ code: "exports_empty", severity: "medium", artifact_count: artifactFiles.length });
  }
  if (emptyFiles.length) findings.push({ code: "empty_resource", severity: "low", files: emptyFiles });
  if (duplicateGroups.length) findings.push({ code: "duplicate_resource", severity: "medium", duplicate_groups: duplicateGroups });
  if (orphanExports.length) findings.push({ code: "orphan_resource", severity: "medium", exports: orphanExports });
  if (missingExports.length && artifactFiles.length) findings.push({ code: "missing_export", severity: "medium", artifacts: missingExports });

  const summary = {
    root_folder: driveFileLite(tree.folder || {}),
    root_child_count: rootChildren.length,
    required_child_folders: required,
    artifact_file_count: artifactFiles.length,
    export_file_count: exportFiles.length,
    duplicate_group_count: duplicateGroups.length,
    empty_file_count: emptyFiles.length,
    orphan_export_count: orphanExports.length,
    missing_export_count: missingExports.length,
  };
  const manifestPlan = buildArtifactExportManifestPlan({ tree, summary, findings, classifications });

  return {
    ok: true,
    recipe_key: ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY,
    classification: classifications[0],
    classifications,
    summary,
    findings,
    manifest_plan: manifestPlan,
    recommended_next_operations: [
      "review_findings",
      "review_manifest_plan",
      ...(findings.length ? ["plan_manifest_create_after_review"] : ["no_action_required"]),
    ],
    apply_supported: false,
    db_reads_executed: false,
    provider_calls_made_directly_by_resource_engine: 0,
    source_inspection_summary: buildSourceInspectionSummary(installedToolResult),
    source_inspection_included: includeSourceInspection,
    ...(includeSourceInspection ? { source_inspection: installedToolResult } : {}),
    secrets_included: false,
  };
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

  const readOnlyExecutionReady = readOnlyRecipeExecutionReady(recipe, steps, blockedReasons);
  const selectedToolKey = selectedInstalledToolKey(recipe, steps);

  return {
    ok: true,
    tool: "governed_resource_plan",
    recipe,
    resolved_resource: resolved,
    dry_run: dryRun,
    execution_plan: {
      execution_class: readOnlyExecutionReady ? "resource_recipe_read_only_installed_tool_v1" : "resource_recipe_plan_only_v1",
      provider_calls_planned: 0,
      provider_calls_allowed: false,
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

  if (!["read_only", "diagnostic", "continue_read_only", "manifest_dry_run"].includes(mode)) {
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

  if (!readOnlyRecipeExecutionReady(recipe, plan.execution_plan?.steps || [], [])) {
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

  const toolKey = plan.execution_plan?.selected_installed_tool_key || selectedInstalledToolKey(recipe, plan.execution_plan?.steps || []);
  const toolArgs = buildInstalledToolArgs(plan, args, toolKey);
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const requestedDepth = boundedNumber(options.max_depth ?? args.max_depth, mode === "continue_read_only" ? 1 : 0, 0, 3);
  const executeChildInspections = boolOption(options.execute_child_inspections ?? args.execute_child_inspections, mode === "continue_read_only");
  const startedAt = new Date().toISOString();
  const rootInspectResult = await deps.executeInstalledTool(toolKey, toolArgs, { plan, mode, traversal_stage: "root" });
  let installedToolResult = rootInspectResult;

  if (recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY && requestedDepth >= 1) {
    const childFolders = targetableChildFolders(rootInspectResult?.tree || {}, requiredArtifactExportChildNames(plan));
    if (executeChildInspections) {
      const selectedChildFolders = mode === "continue_read_only" ? selectContinuationChildFolders(childFolders, args) : childFolders;
      if (mode === "continue_read_only" && selectedChildFolders.length !== 1) {
        return buildChildContinuationBlockedResult({
          reasonCode: selectedChildFolders.length > 1 ? "resource_child_continuation_ambiguous_target" : "resource_child_continuation_target_required_or_not_found",
          message: "continue_read_only requires exactly one target child folder via options.target_child_name or options.target_child_folder_id.",
          plan,
          childFolders,
        });
      }
      const childInspectResults = await Promise.all(selectedChildFolders.map(async (folder) => {
        const childArgs = {
          ...toolArgs,
          folder_id: folder.id,
          folder_url: folder.webViewLink || undefined,
          recursive: false,
          max_depth: 0,
          page_size: boundedNumber(options.child_page_size ?? options.page_size ?? args.page_size, 50, 1, 100),
        };
        const childResult = await deps.executeInstalledTool(toolKey, childArgs, {
          plan,
          mode,
          traversal_stage: "targeted_child_continuation",
          child_name: folder.name,
        });
        return { folder, args: childArgs, result: childResult };
      }));
      installedToolResult = mergeTargetedChildInspections(rootInspectResult, childInspectResults);
    } else {
      installedToolResult = buildTargetedChildTraversalPlan(rootInspectResult, childFolders);
    }
  }

  const completedAt = new Date().toISOString();
  const result = recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY
    ? buildArtifactExportReconciliation(installedToolResult, plan, args)
    : installedToolResult;
  if (recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY && mode === "manifest_dry_run") {
    result.manifest_materialization_dry_run = buildArtifactExportManifestDryRun(result, plan, args);
    result.recommended_next_operations = [
      "review_findings",
      "review_manifest_materialization_dry_run",
      "request_capability_envelope_before_future_apply",
    ];
  }

  return {
    ok: true,
    tool: "governed_resource_run",
    classification: mode === "manifest_dry_run" ? "manifest_dry_run_ready" : result.classification || "read_only_executed",
    mode,
    recipe_key: recipe.recipe_key,
    resource_type: recipe.resource_type,
    resource_uri: plan.resolved_resource?.resource_uri || null,
    installed_tool_key: toolKey,
    installed_tool_args: toolArgs,
    execution_evidence: {
      execution_class: recipe.adapter_kind === "composite" ? "resource_recipe_read_only_composite_v1" : "resource_recipe_read_only_installed_tool_v1",
      started_at: startedAt,
      completed_at: completedAt,
      provider_calls_allowed_directly_by_resource_engine: false,
      installed_tool_call_made: true,
      graph_write_made: false,
      file_content_returned: false,
      secrets_included: false,
    },
    result,
    plan,
    apply_requested: false,
    apply_allowed: false,
    dispatch_allowed: true,
    provider_calls_made: 0,
    execution_allowed: true,
    secrets_included: false,
  };
}
