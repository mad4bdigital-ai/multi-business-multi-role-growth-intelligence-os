import { createHash, randomUUID } from "node:crypto";

import { getPool } from "./db.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { markCapabilityEnvelopeReferenced, resolveCapabilityExecutionEnvelope } from "./capabilityResolutionEnvelopeGuard.js";
import { buildGoogleDriveMultipartRelatedJsonPayload } from "./providerTransportEncoderRegistry.js";

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
    description: "Admin-only guarded runtime for governed resource recipes. V1 allows approved read-only installed-tool recipes and one manifest-create gate that requires dry-run recomputation, capability envelope, typed confirmation, same-cycle readback, and no secrets.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        recipe_key: { type: "string" },
        resource_ref: { type: "object", additionalProperties: true },
        input: { type: "string" },
        mode: { type: "string", enum: ["plan", "read_only", "diagnostic", "continue_read_only", "manifest_dry_run", "graph_projection_dry_run", "apply"], default: "plan" },
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

function parseGithubPullRequestRef(input = "") {
  const value = asString(input);
  if (!value) return null;
  const githubUrl = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i);
  if (githubUrl) {
    const repo = githubUrl[2].replace(/\.git$/i, "");
    const prNumber = Number(githubUrl[3]);
    return {
      resource_type: "github_pull_request",
      resource_uri: `github://${githubUrl[1]}/${repo}/pr/${prNumber}`,
      resource_ref: { owner: githubUrl[1], repo, pr_number: prNumber },
      confidence: "high",
    };
  }
  const githubScheme = value.match(/^github:\/\/([^/]+)\/([^/]+)\/pr\/(\d+)$/i);
  if (githubScheme) {
    const prNumber = Number(githubScheme[3]);
    return {
      resource_type: "github_pull_request",
      resource_uri: `github://${githubScheme[1]}/${githubScheme[2]}/pr/${prNumber}`,
      resource_ref: { owner: githubScheme[1], repo: githubScheme[2], pr_number: prNumber },
      confidence: "high",
    };
  }
  return null;
}

function parseGithubRepoRef(input = "") {
  const value = asString(input);
  if (!value) return null;
  const githubUrl = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (githubUrl) {
    const repo = githubUrl[2].replace(/\.git$/i, "");
    return {
      resource_type: "github_repo",
      resource_uri: `github://${githubUrl[1]}/${repo}`,
      resource_ref: { owner: githubUrl[1], repo },
      confidence: "high",
    };
  }
  const githubScheme = value.match(/^github:\/\/([^/]+)\/([^/]+)$/i);
  if (githubScheme) {
    return {
      resource_type: "github_repo",
      resource_uri: `github://${githubScheme[1]}/${githubScheme[2]}`,
      resource_ref: { owner: githubScheme[1], repo: githubScheme[2] },
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

  if ((type === "github_pull_request" || ref.pr_number || ref.prNumber) && ref.owner && ref.repo && (ref.pr_number || ref.prNumber)) {
    const prNumber = Number(ref.pr_number || ref.prNumber);
    return {
      resource_type: "github_pull_request",
      resource_uri: `github://${ref.owner}/${ref.repo}/pr/${prNumber}`,
      resource_ref: { owner: ref.owner, repo: ref.repo, pr_number: prNumber },
      confidence: "high",
    };
  }

  if ((type === "github_file" || ref.path || ref.file_path) && ref.owner && ref.repo && (ref.path || ref.file_path)) {
    const branch = asString(ref.branch || ref.ref || "main");
    const path = asString(ref.path || ref.file_path);
    return {
      resource_type: "github_file",
      resource_uri: `github://${ref.owner}/${ref.repo}/file/${branch}/${path}`,
      resource_ref: { owner: ref.owner, repo: ref.repo, branch, path },
      confidence: "high",
    };
  }

  if ((type === "github_branch" || ref.owner || ref.repo || ref.branch) && ref.owner && ref.repo && ref.branch) {
    return {
      resource_type: "github_branch",
      resource_uri: `github://${ref.owner}/${ref.repo}/branch/${ref.branch}`,
      resource_ref: { owner: ref.owner, repo: ref.repo, branch: ref.branch },
      confidence: "high",
    };
  }

  if ((type === "github_repo" || ref.owner || ref.repo) && ref.owner && ref.repo) {
    return {
      resource_type: "github_repo",
      resource_uri: `github://${ref.owner}/${ref.repo}`,
      resource_ref: { owner: ref.owner, repo: ref.repo },
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
  const parsedInput =
    parseGoogleDriveFolderRef(input) ||
    parseGithubPullRequestRef(input) ||
    parseGithubBranchRef(input) ||
    parseGithubRepoRef(input) ||
    null;
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
const REPOSITORY_PR_RECONCILE_RECIPE_KEY = "repo.pr.reconciliation_sweep";
const GITHUB_FILE_PATCH_PLAN_RECIPE_KEY = "github.file.patch_plan";

const READ_ONLY_INSTALLED_TOOL_ALLOWLIST = new Set([
  "google_drive_folder_inspect",
]);

const READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST = new Set([
  ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY,
]);

const READ_ONLY_ENDPOINT_RECIPE_ALLOWLIST = new Set([
  REPOSITORY_PR_RECONCILE_RECIPE_KEY,
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

  if (recipe.adapter_kind === "endpoint_recipe") {
    return READ_ONLY_ENDPOINT_RECIPE_ALLOWLIST.has(recipe.recipe_key);
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

const GITHUB_FILE_BLOCKED_PATH_FRAGMENTS = [
  ".env",
  ".pem",
  ".key",
  "credentials/",
  "secrets/",
  ".github/secrets/",
];

function normalizeGithubFilePath(path = "") {
  return asString(path).replace(/^\/+/, "").replace(/\\+/g, "/");
}

function isBlockedGithubFilePath(path = "") {
  const normalized = normalizeGithubFilePath(path).toLowerCase();
  if (!normalized || normalized.includes("..")) return true;
  return GITHUB_FILE_BLOCKED_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function safePatchPlanHunks(hunks = []) {
  if (!Array.isArray(hunks)) return [];
  return hunks.slice(0, 20).map((hunk, index) => ({
    ordinal: index + 1,
    start_line: Number.isFinite(Number(hunk?.start_line)) ? Number(hunk.start_line) : null,
    old_line_count: Number.isFinite(Number(hunk?.old_line_count)) ? Number(hunk.old_line_count) : 0,
    new_line_count: Number.isFinite(Number(hunk?.new_line_count)) ? Number(hunk.new_line_count) : 0,
    summary: asString(hunk?.summary).slice(0, 240) || null,
    content_included: false,
    secrets_included: false,
  }));
}

function buildGithubFilePatchPlan(plan = {}, args = {}) {
  const resolved = plan.resolved_resource || {};
  const ref = resolved.resource_ref || {};
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const owner = asString(ref.owner || args.owner || options.owner);
  const repo = asString(ref.repo || args.repo || options.repo);
  const branch = asString(ref.branch || args.branch || options.branch || "main");
  const path = normalizeGithubFilePath(ref.path || args.path || options.path);
  const changeSummary = asString(options.change_summary || args.change_summary || options.patch_intent || args.patch_intent).slice(0, 500);
  const currentSha256 = asString(options.current_content_sha256 || args.current_content_sha256);
  const proposedSha256 = asString(options.proposed_content_sha256 || args.proposed_content_sha256);
  const hunks = safePatchPlanHunks(options.diff_hunks || args.diff_hunks || []);
  const blockedPath = isBlockedGithubFilePath(path);
  const missingTarget = !owner || !repo || !branch || !path;
  const planPayload = {
    recipe_key: GITHUB_FILE_PATCH_PLAN_RECIPE_KEY,
    target: { owner, repo, branch, path },
    change_summary: changeSummary || null,
    current_content_sha256: currentSha256 || null,
    proposed_content_sha256: proposedSha256 || null,
    hunk_count: hunks.length,
    hunks,
    invariants: {
      diff_only: true,
      provider_call_allowed: false,
      write_allowed: false,
      commit_allowed: false,
      push_allowed: false,
      branch_mutation_allowed: false,
      file_content_returned: false,
      secrets_included: false,
    },
  };
  const patchPlanSha256 = sha256Hex(stableJson(planPayload));

  if (missingTarget || blockedPath) {
    return {
      ok: false,
      tool: "governed_resource_run",
      recipe_key: GITHUB_FILE_PATCH_PLAN_RECIPE_KEY,
      mode: "plan",
      classification: "blocked_github_file_patch_plan_v1",
      reason_code: missingTarget ? "github_file_patch_plan_target_required" : "github_file_patch_plan_path_blocked",
      message: missingTarget
        ? "GitHub file patch plan requires owner, repo, branch, and path."
        : "GitHub file patch plan blocks sensitive or unsafe paths.",
      patch_plan_sha256: patchPlanSha256,
      patch_plan: planPayload,
      provider_calls_made: 0,
      execution_allowed: false,
      dispatch_allowed: false,
      apply_allowed: false,
      write_performed: false,
      file_content_returned: false,
      secrets_included: false,
    };
  }

  return {
    ok: true,
    tool: "governed_resource_run",
    recipe_key: GITHUB_FILE_PATCH_PLAN_RECIPE_KEY,
    mode: "plan",
    classification: "github_file_patch_plan_ready_v1",
    patch_plan_sha256: patchPlanSha256,
    patch_plan: planPayload,
    review_checklist: [
      "review_target_branch_and_path",
      "review_change_summary",
      "confirm_no_raw_file_content_returned",
      "confirm_no_commit_or_push_performed",
      "request_separate_patch_apply_capability_envelope_before_any_write",
    ],
    next_operation_candidates: [
      {
        operation_key: "github.file.patch_apply_after_review",
        status: "future_guarded_apply_required",
        requires_dry_run: true,
        requires_capability_envelope: true,
        requires_typed_confirmation: true,
        same_cycle_readback_required: true,
      },
    ],
    provider_calls_made: 0,
    execution_allowed: true,
    dispatch_allowed: true,
    apply_allowed: false,
    write_operations_planned: false,
    write_performed: false,
    commit_performed: false,
    push_performed: false,
    branch_mutation_performed: false,
    file_content_returned: false,
    secrets_included: false,
  };
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

const MANIFEST_CREATE_ACCEPTED_APP_KEYS = ["google", "google_drive", "google_drive_api"];
const MANIFEST_CREATE_ACCEPTED_INTENTS = ["manifest.create_after_review", "resource_manifest_create", "drive_manifest_create"];

function buildManifestCreateBlockedResult({ reasonCode, message, plan, manifestDryRun = null, envelope = null } = {}) {
  return {
    ok: false,
    tool: "governed_resource_run",
    classification: "blocked_manifest_create_gate_v1",
    mode: "apply",
    apply_requested: true,
    apply_allowed: false,
    dispatch_allowed: false,
    reason_code: reasonCode,
    message,
    manifest_materialization_dry_run: manifestDryRun,
    capability_envelope: envelope,
    plan,
    provider_calls_made: 0,
    execution_allowed: false,
    secrets_included: false,
  };
}

function manifestParentFolderId(plan = {}, args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return asString(
    options.destination_folder_id ||
    args.destination_folder_id ||
    plan.resolved_resource?.resource_ref?.folder_id ||
    ""
  );
}

function buildManifestUploadPayload(manifestDryRun = {}, plan = {}, args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const parentFolderId = manifestParentFolderId(plan, args);
  return buildGoogleDriveMultipartRelatedJsonPayload({
    filename: manifestDryRun.filename,
    mime_type: manifestDryRun.mime_type || "application/json",
    parent_folder_id: parentFolderId,
    media_body: manifestDryRun.content_preview || {},
    content_sha256: manifestDryRun.content_sha256,
    credential_scope: args.credential_scope || options.credential_scope || "platform",
    connection_id: args.connection_id || options.connection_id || undefined,
    tenant_id: args.tenant_id || options.tenant_id || undefined,
    user_id: args.user_id || options.user_id || undefined,
    allow_platform_fallback: args.allow_platform_fallback ?? options.allow_platform_fallback ?? true,
    timeout_seconds: 25,
  });
}

function fileIdFromEndpointResult(result = {}) {
  return asString(
    result?.id ||
    result?.file_id ||
    result?.body?.id ||
    result?.body?.file_id ||
    result?.body?.data?.id ||
    result?.body?.data?.file_id ||
    result?.result?.id ||
    result?.result?.body?.id ||
    result?.result?.body?.data?.id ||
    result?.data?.id ||
    ""
  );
}

function buildManifestReadbackPayload(fileId = "", args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return {
    parent_action_key: "google_drive_api",
    endpoint_key: "getFileMetadata",
    path_params: { fileId },
    query: {
      fields: "id,name,mimeType,parents,size,createdTime,modifiedTime,webViewLink",
      supportsAllDrives: true,
    },
    credential_scope: args.credential_scope || options.credential_scope || "platform",
    connection_id: args.connection_id || options.connection_id || undefined,
    tenant_id: args.tenant_id || options.tenant_id || undefined,
    user_id: args.user_id || options.user_id || undefined,
    allow_platform_fallback: boolOption(args.allow_platform_fallback ?? options.allow_platform_fallback, true),
    timeout_seconds: 25,
    readback: { required: false, mode: "none" },
    secrets_included: false,
  };
}

async function validateManifestCreateGate(manifestDryRun = {}, plan = {}, args = {}) {
  const expectedTypedConfirmation = manifestDryRun.apply_contract?.typed_confirmation || `CREATE_MANIFEST:${manifestDryRun.filename}`;
  if (asString(args.typed_confirmation) !== expectedTypedConfirmation) {
    return {
      ok: false,
      reason_code: "manifest_create_typed_confirmation_required",
      message: `Manifest create requires typed_confirmation exactly: ${expectedTypedConfirmation}`,
      expected_typed_confirmation: expectedTypedConfirmation,
      secrets_included: false,
    };
  }
  if (!manifestParentFolderId(plan, args)) {
    return {
      ok: false,
      reason_code: "manifest_create_destination_folder_required",
      message: "Manifest create requires a resolved destination Drive folder.",
      secrets_included: false,
    };
  }

  const envelope = await resolveCapabilityExecutionEnvelope({
    source: args,
    fallbackSources: [args.options || {}],
    acceptedAppKeys: MANIFEST_CREATE_ACCEPTED_APP_KEYS,
    acceptedIntents: MANIFEST_CREATE_ACCEPTED_INTENTS,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!envelope.ok) return envelope;
  if (envelope.apply_allowed !== true) {
    return {
      ok: false,
      status: "capability_resolution_envelope_apply_not_allowed",
      envelope_id: envelope.envelope_id,
      message: "Manifest create requires a capability envelope with apply_allowed=true.",
      secrets_included: false,
    };
  }
  return { ok: true, envelope, secrets_included: false };
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

function graphNodeKey(type = "resource", id = "") {
  return `${type}:${sha256Hex(`${type}:${id || "unknown"}`).slice(0, 24)}`;
}

function graphFileNode(file = {}, role = "drive_file") {
  const lite = driveFileLite(file);
  if (!lite.id && !lite.name) return null;
  return {
    node_key: graphNodeKey(role, lite.id || lite.name),
    node_type: role,
    resource_uri: lite.id ? `gdrive://file/${lite.id}` : null,
    label: lite.name || lite.id || role,
    properties: {
      id: lite.id,
      name: lite.name,
      mimeType: lite.mimeType,
      size: lite.size,
      is_folder: lite.is_folder,
      webViewLink: lite.webViewLink,
      secrets_included: false,
    },
    confidence: lite.id ? 0.98 : 0.72,
    source: "artifact_export_reconciliation",
    secrets_included: false,
  };
}

function buildArtifactExportGraphProjectionDryRun(reconciliation = {}, plan = {}, args = {}) {
  const summary = reconciliation.summary || {};
  const rootFolder = summary.root_folder || {};
  const rootNode = {
    node_key: graphNodeKey("drive_folder", rootFolder.id || reconciliation.resource_uri || "root"),
    node_type: "drive_folder",
    resource_uri: rootFolder.id ? `gdrive://folder/${rootFolder.id}` : (plan.resolved_resource?.resource_uri || null),
    label: rootFolder.name || "drive_folder",
    properties: { ...rootFolder, secrets_included: false },
    confidence: rootFolder.id ? 0.98 : 0.7,
    source: "artifact_export_reconciliation",
    secrets_included: false,
  };
  const nodesByKey = new Map([[rootNode.node_key, rootNode]]);
  const edges = [];
  const addNode = (node) => {
    if (!node?.node_key) return null;
    if (!nodesByKey.has(node.node_key)) nodesByKey.set(node.node_key, node);
    return nodesByKey.get(node.node_key);
  };
  const addEdge = (fromNode, toNode, edgeType, properties = {}) => {
    if (!fromNode?.node_key || !toNode?.node_key) return;
    edges.push({
      edge_key: graphNodeKey("edge", `${fromNode.node_key}:${edgeType}:${toNode.node_key}`),
      from_node_key: fromNode.node_key,
      to_node_key: toNode.node_key,
      edge_type: edgeType,
      properties: { ...properties, secrets_included: false },
      confidence: Math.min(fromNode.confidence || 0.7, toNode.confidence || 0.7),
      source: "artifact_export_reconciliation",
      secrets_included: false,
    });
  };

  for (const finding of Array.isArray(reconciliation.findings) ? reconciliation.findings : []) {
    for (const file of Array.isArray(finding.files) ? finding.files : []) {
      const node = addNode(graphFileNode(file, "drive_file"));
      addEdge(rootNode, node, "contains", { finding_code: finding.code || null });
    }
    for (const file of Array.isArray(finding.artifacts) ? finding.artifacts : []) {
      const node = addNode(graphFileNode(file, "artifact_file"));
      addEdge(rootNode, node, "has_artifact", { finding_code: finding.code || null });
    }
    for (const file of Array.isArray(finding.exports) ? finding.exports : []) {
      const node = addNode(graphFileNode(file, "export_file"));
      addEdge(rootNode, node, "has_export", { finding_code: finding.code || null });
    }
    for (const group of Array.isArray(finding.duplicate_groups) ? finding.duplicate_groups : []) {
      const groupNode = addNode({
        node_key: graphNodeKey("duplicate_group", JSON.stringify(group.map((file) => file.id || file.name || "unknown"))),
        node_type: "duplicate_group",
        resource_uri: null,
        label: "duplicate_resource_group",
        properties: { count: group.length, names: group.map((file) => file.name).filter(Boolean), secrets_included: false },
        confidence: 0.86,
        source: "artifact_export_reconciliation",
        secrets_included: false,
      });
      addEdge(rootNode, groupNode, "has_duplicate_group", { finding_code: finding.code || null });
      for (const file of group) {
        const node = addNode(graphFileNode(file, "drive_file"));
        addEdge(groupNode, node, "duplicate_member", { finding_code: finding.code || null });
      }
    }
  }

  const projection = {
    nodes: Array.from(nodesByKey.values()),
    edges,
    counts: { nodes: nodesByKey.size, edges: edges.length },
  };
  const projectionSha256 = sha256Hex(stableJson(projection));

  return {
    ok: true,
    mode: "graph_projection_dry_run",
    classification: "graph_projection_dry_run_ready",
    graph_schema: "platform_resource_graph_projection.v1",
    source_recipe_key: ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY,
    source_resource_uri: plan.resolved_resource?.resource_uri || null,
    projection,
    projection_sha256: projectionSha256,
    apply_contract: {
      future_operation_key: "resource_graph_projection.apply_after_review",
      apply_supported_now: false,
      requires_dry_run: true,
      requires_capability_envelope: true,
      requires_typed_confirmation: true,
      typed_confirmation: `APPLY_GRAPH_PROJECTION:${projectionSha256}`,
      same_cycle_readback_required: true,
      graph_write_allowed_now: false,
    },
    graph_write_planned: false,
    graph_write_executed: false,
    provider_calls_planned: 0,
    file_content_required: false,
    file_content_returned: false,
    secrets_included: false,
  };
}

const GRAPH_PROJECTION_ACCEPTED_APP_KEYS = ["platform_orchestration"];
const GRAPH_PROJECTION_ACCEPTED_INTENTS = ["resource_graph_projection.apply_after_review", "resource_graph_projection_apply", "graph_projection_apply"];

function resourceGraphProjectionOperationIntent(args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return asString(args.operation_intent || args.operation_key || options.operation_intent || options.operation_key);
}

function graphProjectionTypedConfirmation(graphProjectionDryRun = {}) {
  return graphProjectionDryRun.apply_contract?.typed_confirmation || `APPLY_GRAPH_PROJECTION:${graphProjectionDryRun.projection_sha256 || ""}`;
}

function buildGraphProjectionApplyBlockedResult({ reasonCode, message, plan, graphProjectionDryRun = null, envelope = null } = {}) {
  return {
    ok: false,
    tool: "governed_resource_run",
    classification: "blocked_graph_projection_apply_gate_v1",
    mode: "apply",
    apply_requested: true,
    apply_allowed: false,
    dispatch_allowed: false,
    reason_code: reasonCode,
    message,
    graph_projection_dry_run: graphProjectionDryRun,
    capability_envelope: envelope,
    plan,
    provider_calls_made: 0,
    graph_write_made: false,
    file_content_returned: false,
    execution_allowed: false,
    secrets_included: false,
  };
}

async function validateGraphProjectionApplyGate(graphProjectionDryRun = {}, plan = {}, args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const expectedTypedConfirmation = graphProjectionTypedConfirmation(graphProjectionDryRun);
  if (!graphProjectionDryRun.projection_sha256) {
    return {
      ok: false,
      reason_code: "graph_projection_apply_hash_required",
      message: "Graph projection apply requires a same-cycle graph_projection_dry_run projection_sha256.",
      secrets_included: false,
    };
  }
  if (asString(args.typed_confirmation) !== expectedTypedConfirmation) {
    return {
      ok: false,
      reason_code: "graph_projection_apply_typed_confirmation_required",
      message: `Graph projection apply requires typed_confirmation exactly: ${expectedTypedConfirmation}`,
      expected_typed_confirmation: expectedTypedConfirmation,
      secrets_included: false,
    };
  }
  const suppliedHash = asString(args.graph_projection_sha256 || options.graph_projection_sha256 || args.projection_sha256 || options.projection_sha256);
  if (suppliedHash && suppliedHash !== graphProjectionDryRun.projection_sha256) {
    return {
      ok: false,
      reason_code: "graph_projection_apply_hash_mismatch",
      message: "Supplied graph projection hash does not match the same-cycle dry-run hash.",
      expected_projection_sha256: graphProjectionDryRun.projection_sha256,
      supplied_projection_sha256: suppliedHash,
      secrets_included: false,
    };
  }

  const operationIntent = resourceGraphProjectionOperationIntent(args);
  const envelope = await resolveCapabilityExecutionEnvelope({
    source: { ...args, operation_intent: operationIntent || "resource_graph_projection.apply_after_review" },
    fallbackSources: [args.options || {}],
    acceptedAppKeys: GRAPH_PROJECTION_ACCEPTED_APP_KEYS,
    acceptedIntents: GRAPH_PROJECTION_ACCEPTED_INTENTS,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!envelope.ok) return envelope;
  if (envelope.apply_allowed !== true) {
    return {
      ok: false,
      status: "capability_resolution_envelope_apply_not_allowed",
      envelope_id: envelope.envelope_id,
      message: "Graph projection apply requires a capability envelope with apply_allowed=true.",
      secrets_included: false,
    };
  }
  return { ok: true, envelope, secrets_included: false };
}

function graphProjectionNodeMetadata(node = {}, graphProjectionDryRun = {}) {
  return {
    graph_schema: graphProjectionDryRun.graph_schema,
    source_recipe_key: graphProjectionDryRun.source_recipe_key,
    source_resource_uri: graphProjectionDryRun.source_resource_uri,
    projection_sha256: graphProjectionDryRun.projection_sha256,
    properties: node.properties || {},
    confidence: Number(node.confidence || 0),
    source: node.source || "artifact_export_reconciliation",
    graph_write_policy: "candidate_advisory_only",
    runtime_enforced: false,
    secrets_included: false,
  };
}

function graphProjectionEdgeMetadata(edge = {}, graphProjectionDryRun = {}) {
  return {
    graph_schema: graphProjectionDryRun.graph_schema,
    source_recipe_key: graphProjectionDryRun.source_recipe_key,
    source_resource_uri: graphProjectionDryRun.source_resource_uri,
    projection_sha256: graphProjectionDryRun.projection_sha256,
    properties: edge.properties || {},
    confidence: Number(edge.confidence || 0),
    source: edge.source || "artifact_export_reconciliation",
    graph_write_policy: "candidate_advisory_only",
    runtime_enforced: false,
    secrets_included: false,
  };
}

async function writeGraphProjectionCandidate(graphProjectionDryRun = {}, plan = {}, args = {}) {
  const projection = graphProjectionDryRun.projection || {};
  const nodes = Array.isArray(projection.nodes) ? projection.nodes.filter((node) => node?.node_key) : [];
  const edges = Array.isArray(projection.edges) ? projection.edges.filter((edge) => edge?.edge_key && edge?.from_node_key && edge?.to_node_key) : [];
  const sourcePk = graphProjectionDryRun.projection_sha256 || sha256Hex(stableJson(projection));
  const sourceTable = "platform_resource_recipe_projection";
  const connection = await getPool().getConnection();
  const startedAt = new Date().toISOString();
  try {
    await connection.beginTransaction();
    for (const node of nodes) {
      await connection.execute(
        `INSERT INTO platform_graph_nodes
          (node_id, node_type, node_label, scope_type, subject_ref, source_table, source_pk,
           authority_status, lifecycle_status, visibility_scope, sensitivity, evidence_level,
           runtime_role, source_system, metadata_json)
         VALUES (?, ?, ?, 'platform', ?, ?, ?, 'candidate', 'active', 'platform_admin', 'internal', 'inferred', 'advisory', 'platform_resource_recipe', ?)
         ON DUPLICATE KEY UPDATE
           node_type = VALUES(node_type),
           node_label = VALUES(node_label),
           subject_ref = VALUES(subject_ref),
           source_table = VALUES(source_table),
           source_pk = VALUES(source_pk),
           authority_status = 'candidate',
           lifecycle_status = 'active',
           visibility_scope = 'platform_admin',
           sensitivity = 'internal',
           evidence_level = 'inferred',
           runtime_role = 'advisory',
           source_system = 'platform_resource_recipe',
           metadata_json = VALUES(metadata_json),
           updated_at = CURRENT_TIMESTAMP`,
        [
          node.node_key,
          asString(node.node_type) || "resource",
          asString(node.label || node.node_key).slice(0, 500),
          node.resource_uri || node.node_key,
          sourceTable,
          sourcePk,
          JSON.stringify(graphProjectionNodeMetadata(node, graphProjectionDryRun)),
        ]
      );
    }

    for (const edge of edges) {
      await connection.execute(
        `INSERT INTO platform_graph_edges
          (edge_id, source_node_id, edge_type, target_node_id, scope_type, authority_status,
           lifecycle_status, visibility_scope, sensitivity, evidence_level, runtime_role,
           runtime_enforced, source_table, source_pk, metadata_json)
         VALUES (?, ?, ?, ?, 'platform', 'candidate', 'active', 'platform_admin', 'internal', 'inferred', 'advisory', 0, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source_node_id = VALUES(source_node_id),
           edge_type = VALUES(edge_type),
           target_node_id = VALUES(target_node_id),
           authority_status = 'candidate',
           lifecycle_status = 'active',
           visibility_scope = 'platform_admin',
           sensitivity = 'internal',
           evidence_level = 'inferred',
           runtime_role = 'advisory',
           runtime_enforced = 0,
           source_table = VALUES(source_table),
           source_pk = VALUES(source_pk),
           metadata_json = VALUES(metadata_json),
           updated_at = CURRENT_TIMESTAMP`,
        [
          edge.edge_key,
          edge.from_node_key,
          asString(edge.edge_type) || "related_to",
          edge.to_node_key,
          sourceTable,
          sourcePk,
          JSON.stringify(graphProjectionEdgeMetadata(edge, graphProjectionDryRun)),
        ]
      );

      const evidenceId = sha256Hex(`${edge.edge_key}:${sourcePk}`).slice(0, 64);
      await connection.execute(
        `INSERT INTO platform_graph_edge_evidence
          (evidence_id, edge_id, evidence_type, source_table, source_pk, source_ref, confidence, evidence_json)
         VALUES (?, ?, 'projection_dry_run', ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           edge_id = VALUES(edge_id),
           evidence_type = VALUES(evidence_type),
           source_table = VALUES(source_table),
           source_pk = VALUES(source_pk),
           source_ref = VALUES(source_ref),
           confidence = VALUES(confidence),
           evidence_json = VALUES(evidence_json)`,
        [
          evidenceId,
          edge.edge_key,
          sourceTable,
          sourcePk,
          graphProjectionDryRun.source_resource_uri || null,
          Math.max(0, Math.min(Number(edge.confidence || 0.7), 1)),
          JSON.stringify({
            graph_schema: graphProjectionDryRun.graph_schema,
            projection_sha256: sourcePk,
            edge_key: edge.edge_key,
            edge_type: edge.edge_type,
            source: edge.source || "artifact_export_reconciliation",
            graph_write_policy: "candidate_advisory_only",
            runtime_enforced: false,
            secrets_included: false,
          }),
        ]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }

  const nodeIds = nodes.map((node) => node.node_key);
  const edgeIds = edges.map((edge) => edge.edge_key);
  const [nodeReadbackRows] = nodeIds.length
    ? await getPool().query("SELECT COUNT(*) AS count FROM platform_graph_nodes WHERE node_id IN (?)", [nodeIds])
    : [[{ count: 0 }]];
  const [edgeReadbackRows] = edgeIds.length
    ? await getPool().query("SELECT COUNT(*) AS count FROM platform_graph_edges WHERE edge_id IN (?)", [edgeIds])
    : [[{ count: 0 }]];
  const [evidenceReadbackRows] = edgeIds.length
    ? await getPool().query("SELECT COUNT(*) AS count FROM platform_graph_edge_evidence WHERE edge_id IN (?) AND source_pk = ?", [edgeIds, sourcePk])
    : [[{ count: 0 }]];
  const readback = {
    required: true,
    ok: Number(nodeReadbackRows[0]?.count || 0) === nodes.length &&
      Number(edgeReadbackRows[0]?.count || 0) === edges.length &&
      Number(evidenceReadbackRows[0]?.count || 0) === edges.length,
    node_count: Number(nodeReadbackRows[0]?.count || 0),
    edge_count: Number(edgeReadbackRows[0]?.count || 0),
    evidence_count: Number(evidenceReadbackRows[0]?.count || 0),
    secrets_included: false,
  };

  return {
    ok: readback.ok,
    projection_sha256: sourcePk,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    nodes_written: nodes.length,
    edges_written: edges.length,
    edge_evidence_written: edges.length,
    authority_status: "candidate",
    runtime_role: "advisory",
    runtime_enforced: false,
    readback,
    provider_calls_made: 0,
    file_content_returned: false,
    secrets_included: false,
  };
}

function normalizedCheckConclusion(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeGithubCheckRuns(value = []) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.nodes) ? value.nodes : [];
  return items.map((check) => ({
    name: check.name || check.workflowName || check.context || null,
    status: check.status || null,
    conclusion: check.conclusion || null,
    url: check.url || check.detailsUrl || null,
  })).filter((check) => check.name || check.status || check.conclusion);
}

function normalizeGithubChangedFiles(value = []) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.nodes) ? value.nodes : [];
  return items.map((file) => ({
    path: file.path || file.filename || null,
    additions: Number(file.additions || 0),
    deletions: Number(file.deletions || 0),
    change_type: file.changeType || file.status || null,
  })).filter((file) => file.path);
}

function normalizeGithubPullRequest(value = {}) {
  const number = Number(value.number || value.pr_number || value.pull_number || 0);
  const checkRuns = normalizeGithubCheckRuns(value.check_runs || value.checkRuns || value.status_checks || value.stateCheckRollup || []);
  const changedFiles = normalizeGithubChangedFiles(value.changed_files || value.changedFiles || value.files || []);
  return {
    number,
    title: value.title || null,
    state: String(value.state || "").toLowerCase() || null,
    url: value.url || value.html_url || null,
    author: value.author?.login || value.user?.login || value.author || null,
    is_draft: Boolean(value.isDraft ?? value.draft),
    mergeable: value.mergeable ?? null,
    merge_state_status: value.mergeStateStatus || value.merge_state_status || value.merge_state || null,
    base_ref_name: value.baseRefName || value.base_ref_name || value.base?.ref || null,
    head_ref_name: value.headRefName || value.head_ref_name || value.head?.ref || null,
    base_ref_oid: value.baseRefOid || value.base_ref_oid || value.base?.sha || null,
    head_ref_oid: value.headRefOid || value.head_ref_oid || value.head?.sha || null,
    changed_files: changedFiles,
    check_runs: checkRuns,
    secrets_included: false,
  };
}

function classifyRepositoryPullRequest(pr = {}) {
  const mergeState = String(pr.merge_state_status || "").toLowerCase();
  const hasChecks = Array.isArray(pr.check_runs) && pr.check_runs.length > 0;
  const failingChecks = (pr.check_runs || []).filter((check) => ["failure", "failed", "timed_out", "cancelled", "action_required"].includes(normalizedCheckConclusion(check.conclusion)));
  const pendingChecks = (pr.check_runs || []).filter((check) => {
    const conclusion = normalizedCheckConclusion(check.conclusion);
    const status = normalizedCheckConclusion(check.status);
    return !["success", "skipped", "neutral"].includes(conclusion) && (status === "in_progress" || status === "queued" || !conclusion);
  });

  if (pr.is_draft) {
    return { classification: "manual_review_required", confidence: 0.88, reason_code: "pull_request_is_draft", recommended_action: "wait_or_review_manually" };
  }
  if (pr.mergeable === false || ["dirty", "blocked", "unknown"].includes(mergeState)) {
    return { classification: "unsafe_to_merge", confidence: 0.91, reason_code: "mergeability_blocked_or_unknown", recommended_action: "manual_review_required" };
  }
  if (["behind", "behind_only"].includes(mergeState)) {
    return { classification: "behind_only", confidence: 0.9, reason_code: "branch_is_behind_base", recommended_action: "update_branch_then_recheck" };
  }
  if (failingChecks.length) {
    return { classification: "unsafe_to_merge", confidence: 0.94, reason_code: "failing_checks_present", recommended_action: "fix_checks_before_merge" };
  }
  if (!hasChecks) {
    return { classification: "clean_but_ci_missing", confidence: 0.82, reason_code: "no_status_checks_visible", recommended_action: "run_or_wait_for_ci" };
  }
  if (pendingChecks.length) {
    return { classification: "clean_but_ci_missing", confidence: 0.84, reason_code: "checks_pending_or_incomplete", recommended_action: "wait_for_ci" };
  }
  return { classification: "merge_ready", confidence: 0.9, reason_code: "checks_success_and_mergeable", recommended_action: "review_then_merge" };
}

function encodeGithubPathPart(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

async function githubReadOnlyGet(pathname = "", token = "") {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "growth-intelligence-platform-resource-recipes",
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parse_error: true, text: text.slice(0, 200) };
  }
  if (!response.ok) {
    const err = new Error(body?.message || `GitHub read-only request failed with ${response.status}`);
    err.status = response.status;
    err.code = "github_read_only_request_failed";
    err.details = { pathname, status: response.status, body };
    throw err;
  }
  return body;
}

function liteGithubPullRequest(pr = {}) {
  return {
    number: pr.number,
    title: pr.title || null,
    state: pr.state || null,
    url: pr.html_url || pr.url || null,
    draft: Boolean(pr.draft),
    mergeable: pr.mergeable ?? null,
    merge_state_status: pr.mergeable_state || null,
    author: pr.user?.login || null,
    base: { ref: pr.base?.ref || null, sha: pr.base?.sha || null },
    head: { ref: pr.head?.ref || null, sha: pr.head?.sha || null },
    secrets_included: false,
  };
}

async function resolveRepositoryGithubReadOnlyToken(args = {}) {
  const binding = args.authority_binding || {};
  if (!binding.source_system_id && !binding.source_installation_id) {
    const tenantScoped = Boolean(binding.scope?.tenant_id || binding.scope?.workspace_id || binding.scope?.user_id);
    const compatible = !tenantScoped && ["admin_grant", "platform_managed", "system_seed", ""].includes(asString(binding.authority_source).toLowerCase());
    if (!compatible) {
      const err = new Error("Repository provider binding is required before GitHub access.");
      err.status = 403;
      err.code = "repository_provider_binding_required";
      throw err;
    }
    return getGitHubAppInstallationToken({});
  }
  const [systems] = await getPool().query(
    "SELECT system_id, tenant_id, provider_family, status, config_json FROM connected_systems WHERE system_id = ? LIMIT 1",
    [binding.source_system_id]
  );
  const system = systems?.[0];
  if (!system || system.status !== "active" || asString(system.provider_family).toLowerCase() !== "github" || (binding.scope?.tenant_id && system.tenant_id !== binding.scope.tenant_id)) {
    const err = new Error("Repository connected system is not active, GitHub-scoped, or tenant-aligned.");
    err.status = 403;
    err.code = "repository_connected_system_invalid";
    throw err;
  }
  let installation = null;
  if (binding.source_installation_id) {
    const [rows] = await getPool().query(
      "SELECT installation_id, system_id, tenant_id, status, expires_at, meta_json FROM installations WHERE installation_id = ? AND system_id = ? LIMIT 1",
      [binding.source_installation_id, system.system_id]
    );
    installation = rows?.[0] || null;
    if (!installation || installation.status !== "active" || (installation.expires_at && new Date(installation.expires_at).getTime() <= Date.now()) || (binding.scope?.tenant_id && installation.tenant_id !== binding.scope.tenant_id)) {
      const err = new Error("Repository GitHub installation is missing, inactive, expired, or tenant-misaligned.");
      err.status = 403;
      err.code = "repository_provider_installation_invalid";
      throw err;
    }
  }
  const config = parseJson(system.config_json, {});
  const meta = parseJson(installation?.meta_json, {});
  const providerInstallationId = asString(meta.github_app_installation_id || meta.provider_installation_id || config.github_app_installation_id || config.provider_installation_id);
  if (!providerInstallationId) {
    const err = new Error("GitHub provider installation id is missing from the governed connected-system binding.");
    err.status = 409;
    err.code = "github_provider_installation_id_missing";
    throw err;
  }
  return getGitHubAppInstallationToken({ action: { github_app_installation_id: providerInstallationId } });
}
async function executeRepositoryPrReconciliationReadOnly(operationKey = "", args = {}) {
  if (operationKey !== "repo_pr_reconciliation_sweep") {
    const err = new Error(`Unsupported GitHub read-only resource recipe operation: ${operationKey}`);
    err.status = 400;
    err.code = "unsupported_github_read_only_operation";
    throw err;
  }
  const owner = String(args.owner || "").trim();
  const repo = String(args.repo || "").trim();
  if (!owner || !repo) {
    const err = new Error("GitHub read-only PR reconciliation requires owner and repo.");
    err.status = 400;
    err.code = "missing_github_owner_repo";
    throw err;
  }

  const token = await resolveRepositoryGithubReadOnlyToken(args);
  const safeOwner = encodeGithubPathPart(owner);
  const safeRepo = encodeGithubPathPart(repo);
  const state = encodeURIComponent(String(args.state || "open"));
  const limit = Math.min(Math.max(Number(args.limit || 20), 1), 50);
  let providerCallsMade = 0;

  const pulls = await githubReadOnlyGet(`/repos/${safeOwner}/${safeRepo}/pulls?state=${state}&per_page=${limit}`, token);
  providerCallsMade += 1;
  const pullRequests = [];
  for (const pr of Array.isArray(pulls) ? pulls.slice(0, limit) : []) {
    const lite = liteGithubPullRequest(pr);
    if (args.include_changed_files !== false) {
      const files = await githubReadOnlyGet(`/repos/${safeOwner}/${safeRepo}/pulls/${pr.number}/files?per_page=100`, token);
      providerCallsMade += 1;
      lite.changed_files = Array.isArray(files) ? files.map((file) => ({
        filename: file.filename || null,
        status: file.status || null,
        additions: Number(file.additions || 0),
        deletions: Number(file.deletions || 0),
      })) : [];
    }
    if (args.include_check_runs !== false && pr.head?.sha) {
      const checks = await githubReadOnlyGet(`/repos/${safeOwner}/${safeRepo}/commits/${encodeGithubPathPart(pr.head.sha)}/check-runs?per_page=100`, token);
      providerCallsMade += 1;
      lite.check_runs = Array.isArray(checks?.check_runs) ? checks.check_runs.map((check) => ({
        name: check.name || null,
        status: check.status || null,
        conclusion: check.conclusion || null,
        url: check.html_url || check.details_url || null,
      })) : [];
    }
    pullRequests.push(lite);
  }

  return {
    ok: true,
    operation_key: operationKey,
    owner,
    repo,
    pull_requests: pullRequests,
    provider_calls_made: providerCallsMade,
    mutations_executed: false,
    secrets_included: false,
  };
}

export async function executeRepositoryPrReconciliationReadOnlyForAdminReadiness(
  operationKey = "",
  args = {},
  { adminAuthorized = false, executeReadOnly = executeRepositoryPrReconciliationReadOnly } = {}
) {
  if (adminAuthorized !== true) {
    const err = new Error("Repository Governance V6 readiness executor is admin-only.");
    err.status = 403;
    err.code = "repository_governance_v6_readiness_admin_required";
    throw err;
  }
  if (operationKey !== "repo_pr_reconciliation_sweep") {
    const err = new Error(`Unsupported Repository Governance V6 readiness operation: ${operationKey}`);
    err.status = 400;
    err.code = "repository_governance_v6_readiness_operation_unsupported";
    throw err;
  }
  const binding = args.authority_binding || {};
  if (binding.source_system_id || binding.source_installation_id) {
    return executeReadOnly(operationKey, args);
  }
  const authoritySource = asString(binding.authority_source).toLowerCase();
  if (!["admin_grant", "platform_managed", "system_seed"].includes(authoritySource)) {
    const err = new Error("Repository Governance V6 readiness requires a connected provider or governed platform authority.");
    err.status = 403;
    err.code = "repository_governance_v6_readiness_provider_binding_invalid";
    throw err;
  }
  const { scope: _tenantScope, ...platformBinding } = binding;
  return executeReadOnly(operationKey, {
    ...args,
    authority_binding: {
      ...platformBinding,
      readiness_admin_platform_compat: true,
    },
  });
}

function jsonPreview(value = {}, maxChars = 24000) {
  const text = stableJson(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...truncated` : text;
}

function repositoryPrEvidenceRequested(args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return boolOption(options.record_evidence ?? args.record_evidence, false);
}

function buildRepositoryPrEvidenceMetadata(reconciliation = {}, plan = {}, args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return {
    schema_version: "repository_pr_reconciliation_evidence.v1",
    recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY,
    resource_uri: plan.resolved_resource?.resource_uri || null,
    owner: reconciliation.summary?.owner || plan.resolved_resource?.resource_ref?.owner || null,
    repo: reconciliation.summary?.repo || plan.resolved_resource?.resource_ref?.repo || null,
    pull_request_count: Number(reconciliation.summary?.pull_request_count || 0),
    classification_counts: reconciliation.summary?.classification_counts || {},
    ready_count: Number(reconciliation.summary?.ready_count || 0),
    risky_count: Number(reconciliation.summary?.risky_count || 0),
    provider_calls_made: Number(reconciliation.provider_calls_made_by_read_only_executor || 0),
    requested_limit: options.limit ?? args.limit ?? null,
    requested_state: options.state ?? args.state ?? "open",
    mutations_executed: false,
    graph_write_executed: false,
    secrets_included: false,
  };
}

async function recordRepositoryPrReconciliationEvidence(reconciliation = {}, plan = {}, args = {}) {
  if (!repositoryPrEvidenceRequested(args)) {
    return {
      recorded: false,
      reason_code: "record_evidence_not_requested",
      secrets_included: false,
    };
  }

  const evidenceId = randomUUID();
  const requestPayload = {
    recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY,
    resource_ref: plan.resolved_resource?.resource_ref || null,
    options: args.options || {},
    mode: args.mode || null,
    secrets_included: false,
  };
  const responsePayload = {
    classification: reconciliation.classification || null,
    summary: reconciliation.summary || {},
    recommendations: reconciliation.recommendations || [],
    provider_calls_made_by_read_only_executor: Number(reconciliation.provider_calls_made_by_read_only_executor || 0),
    apply_supported: false,
    mutations_executed: false,
    graph_write_executed: false,
    secrets_included: false,
  };
  const requestJson = stableJson(requestPayload);
  const responseJson = stableJson(responsePayload);
  const metadata = buildRepositoryPrEvidenceMetadata(reconciliation, plan, args);

  await getPool().query(
    `INSERT INTO audit_payload_evidence
      (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
       source_table, source_pk, evidence_type, request_preview, request_sha256,
       response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_required', 0)`,
    [
      evidenceId,
      args.tenant_id || args.options?.tenant_id || null,
      args.actor_id || args.user_id || "platform_admin",
      args.actor_type || "admin",
      REPOSITORY_PR_RECONCILE_RECIPE_KEY,
      "github_repo",
      plan.resolved_resource?.resource_uri || null,
      "platform_resource_recipes",
      REPOSITORY_PR_RECONCILE_RECIPE_KEY,
      "repository_pr_reconciliation_summary",
      jsonPreview(requestPayload),
      sha256Hex(requestJson),
      jsonPreview(responsePayload),
      sha256Hex(responseJson),
      stableJson(metadata),
    ]
  );

  return {
    recorded: true,
    evidence_id: evidenceId,
    table: "audit_payload_evidence",
    evidence_type: "repository_pr_reconciliation_summary",
    request_sha256: sha256Hex(requestJson),
    response_sha256: sha256Hex(responseJson),
    secrets_included: false,
  };
}

function buildRepositoryPrReconciliationArgs(plan = {}, args = {}) {
  const ref = plan.resolved_resource?.resource_ref || {};
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return {
    owner: ref.owner || options.owner || args.owner,
    repo: ref.repo || options.repo || args.repo,
    state: options.state || args.state || "open",
    limit: boundedNumber(options.limit ?? args.limit, 50, 1, 100),
    include_changed_files: boolOption(options.include_changed_files ?? args.include_changed_files, true),
    include_check_runs: boolOption(options.include_check_runs ?? args.include_check_runs, true),
    secrets_included: false,
  };
}

function buildRepositoryPrReconciliation(githubReadOnlyResult = {}, plan = {}, args = {}) {
  const pullRequests = (Array.isArray(githubReadOnlyResult.pull_requests)
    ? githubReadOnlyResult.pull_requests
    : Array.isArray(githubReadOnlyResult.pullRequests)
      ? githubReadOnlyResult.pullRequests
      : Array.isArray(githubReadOnlyResult.items)
        ? githubReadOnlyResult.items
        : []).map(normalizeGithubPullRequest);
  const classified = pullRequests.map((pr) => ({ ...pr, ...classifyRepositoryPullRequest(pr) }));
  const classificationCounts = classified.reduce((acc, pr) => {
    acc[pr.classification] = Number(acc[pr.classification] || 0) + 1;
    return acc;
  }, {});
  const risky = classified.filter((pr) => ["unsafe_to_merge", "manual_review_required"].includes(pr.classification));
  const ready = classified.filter((pr) => pr.classification === "merge_ready");

  return {
    ok: Boolean(githubReadOnlyResult.ok !== false),
    recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY,
    classification: risky.length ? "repository_attention_required" : ready.length ? "repository_merge_ready_candidates" : "repository_pr_reconciliation_clean",
    summary: {
      owner: plan.resolved_resource?.resource_ref?.owner || null,
      repo: plan.resolved_resource?.resource_ref?.repo || null,
      pull_request_count: classified.length,
      classification_counts: classificationCounts,
      ready_count: ready.length,
      risky_count: risky.length,
    },
    pull_requests: classified.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.url,
      author: pr.author,
      is_draft: pr.is_draft,
      mergeable: pr.mergeable,
      merge_state_status: pr.merge_state_status,
      base_ref_name: pr.base_ref_name,
      head_ref_name: pr.head_ref_name,
      changed_file_count: pr.changed_files.length,
      check_run_count: pr.check_runs.length,
      classification: pr.classification,
      confidence: pr.confidence,
      reason_code: pr.reason_code,
      recommended_action: pr.recommended_action,
      evidence: {
        changed_files: pr.changed_files.slice(0, 50),
        check_runs: pr.check_runs.slice(0, 50),
        secrets_included: false,
      },
      secrets_included: false,
    })),
    recommendations: classified.map((pr) => ({
      pr_number: pr.number,
      classification: pr.classification,
      confidence: pr.confidence,
      recommended_action: pr.recommended_action,
      reason_code: pr.reason_code,
    })),
    provider_calls_made_directly_by_resource_engine: 0,
    provider_calls_made_by_read_only_executor: Number(githubReadOnlyResult.provider_calls_made || 0),
    apply_supported: false,
    mutations_executed: false,
    graph_write_executed: false,
    secrets_included: false,
  };
}

function scopedAuthorityRequested(args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return Boolean(args.tenant_id || options.tenant_id || args.workspace_id || options.workspace_id || args.user_id || options.user_id);
}

function authorityScopeArgs(args = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return {
    tenant_id: args.tenant_id || options.tenant_id || null,
    workspace_id: args.workspace_id || options.workspace_id || null,
    user_id: args.user_id || options.user_id || null,
  };
}

function modeAllowedByBinding(binding = {}, mode = "read_only") {
  const allowedModes = parseJson(binding.allowed_modes_json, []);
  const allowed = Array.isArray(allowedModes) ? allowedModes : [];
  const permissionLevel = asString(binding.permission_level || "read_only");
  if (mode === "plan") return true;
  if (allowed.includes(mode) || allowed.includes("*")) return true;
  if (["read_only", "diagnostic", "continue_read_only"].includes(mode) && ["read_only", "diagnostic", "admin"].includes(permissionLevel)) return true;
  if (permissionLevel === "admin") return true;
  return false;
}

async function resolvePlatformResourceAuthorityBinding(plan = {}, args = {}, mode = "read_only") {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const scope = {
    tenant_id: args.tenant_id || options.tenant_id || null,
    workspace_id: args.workspace_id || options.workspace_id || null,
    user_id: args.user_id || options.user_id || null,
  };
  const scoped = Boolean(scope.tenant_id || scope.workspace_id || scope.user_id);
  if (!scoped) {
    if (args.auth?.is_admin === true || args.is_admin === true) {
      return { required: false, granted: true, decision: "platform_admin_unscoped_read_only_allowed", binding_id: null, secrets_included: false };
    }
    return { required: true, granted: false, decision: "blocked_unscoped_non_admin_resource_access", scope, secrets_included: false };
  }
  const resourceType = plan.resolved_resource?.resource_type || plan.recipe?.resource_type || null;
  const resourceUri = plan.resolved_resource?.resource_uri || null;
  const recipeKey = plan.recipe?.recipe_key || args.recipe_key || null;
  if (!resourceType || !resourceUri) return { required: true, granted: false, decision: "blocked_authority_binding_unresolved_resource", scope, secrets_included: false };
  if (scope.workspace_id && scope.tenant_id) {
    const [workspaceRows] = await getPool().query("SELECT workspace_id FROM workspace_registry WHERE workspace_id = ? AND tenant_id = ? LIMIT 1", [scope.workspace_id, scope.tenant_id]);
    if (!workspaceRows.length) return { required: true, granted: false, decision: "blocked_workspace_tenant_scope_mismatch", scope, resource_type: resourceType, resource_uri: resourceUri, recipe_key: recipeKey, secrets_included: false };
  }
  if (scope.user_id && scope.tenant_id) {
    const [membershipRows] = await getPool().query("SELECT id FROM memberships WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1", [scope.user_id, scope.tenant_id]);
    if (!membershipRows.length) return { required: true, granted: false, decision: "blocked_user_tenant_membership_missing", scope, resource_type: resourceType, resource_uri: resourceUri, recipe_key: recipeKey, secrets_included: false };
  }
  const clauses = ["status = 'active'", "resource_type = ?", "resource_uri = ?", "(recipe_key = ? OR recipe_key IS NULL)", "(expires_at IS NULL OR expires_at > NOW())"];
  const params = [resourceType, resourceUri, recipeKey];
  if (scope.tenant_id) { clauses.push("tenant_id = ?"); params.push(scope.tenant_id); } else clauses.push("tenant_id IS NULL");
  if (scope.workspace_id) { clauses.push("(workspace_id IS NULL OR workspace_id = ?)"); params.push(scope.workspace_id); } else clauses.push("workspace_id IS NULL");
  if (scope.user_id) { clauses.push("(user_id IS NULL OR user_id = ?)"); params.push(scope.user_id); } else clauses.push("user_id IS NULL");
  let rows = [];
  try {
    [rows] = await getPool().query(`SELECT * FROM platform_resource_authority_bindings WHERE ${clauses.join(" AND ")} ORDER BY user_id IS NOT NULL DESC, workspace_id IS NOT NULL DESC, recipe_key IS NOT NULL DESC, created_at DESC LIMIT 1`, params);
  } catch (error) {
    if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(String(error?.message || ""))) return { required: true, granted: false, decision: "blocked_authority_binding_table_missing", scope, resource_type: resourceType, resource_uri: resourceUri, recipe_key: recipeKey, secrets_included: false };
    throw error;
  }
  const binding = rows?.[0] || null;
  if (!binding) return { required: true, granted: false, decision: "blocked_missing_platform_resource_authority_binding", scope, resource_type: resourceType, resource_uri: resourceUri, recipe_key: recipeKey, mode, secrets_included: false };
  const granted = modeAllowedByBinding(binding, mode);
  return {
    required: true,
    granted,
    decision: granted ? "platform_resource_authority_binding_granted" : "blocked_platform_resource_authority_binding_mode",
    binding_id: binding.binding_id,
    permission_level: binding.permission_level,
    allowed_modes: parseJson(binding.allowed_modes_json, []),
    authority_source: binding.authority_source || null,
    source_system_id: binding.source_system_id || null,
    source_installation_id: binding.source_installation_id || null,
    scope,
    resource_type: resourceType,
    resource_uri: resourceUri,
    recipe_key: recipeKey,
    mode,
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

export async function runGovernedResource(args = {}, deps = {}) {
  const plan = await planGovernedResource({ ...args, dry_run: true });
  const mode = asString(args.mode || "plan") || "plan";
  const applyRequested = mode === "apply" || args.apply === true;
  const recipe = plan.recipe || {};

  if (recipe.recipe_key === GITHUB_FILE_PATCH_PLAN_RECIPE_KEY) {
    if (applyRequested) {
      return {
        ok: false,
        tool: "governed_resource_run",
        recipe_key: GITHUB_FILE_PATCH_PLAN_RECIPE_KEY,
        mode,
        classification: "blocked_github_file_patch_plan_apply_v1",
        reason_code: "github_file_patch_plan_is_diff_only",
        message: "github.file.patch_plan is diff-only and never performs commits, pushes, or branch mutations.",
        provider_calls_made: 0,
        execution_allowed: false,
        dispatch_allowed: false,
        apply_allowed: false,
        write_performed: false,
        file_content_returned: false,
        secrets_included: false,
      };
    }
    if (!["plan", "diagnostic"].includes(mode)) {
      return {
        ok: false,
        tool: "governed_resource_run",
        recipe_key: GITHUB_FILE_PATCH_PLAN_RECIPE_KEY,
        mode,
        classification: "blocked_github_file_patch_plan_mode_v1",
        reason_code: "github_file_patch_plan_mode_not_supported",
        message: "github.file.patch_plan supports only plan or diagnostic mode.",
        provider_calls_made: 0,
        execution_allowed: false,
        dispatch_allowed: false,
        apply_allowed: false,
        write_performed: false,
        file_content_returned: false,
        secrets_included: false,
      };
    }
    return buildGithubFilePatchPlan(plan, args);
  }

  const operationIntent = resourceGraphProjectionOperationIntent(args);
  const graphProjectionApplyRequested = applyRequested &&
    recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY &&
    GRAPH_PROJECTION_ACCEPTED_INTENTS.includes(operationIntent);
  const manifestApplyRequested = applyRequested && recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY && !graphProjectionApplyRequested;
  const graphProjectionDryRunRequested = mode === "graph_projection_dry_run" && recipe.recipe_key === ARTIFACT_EXPORT_RECONCILE_RECIPE_KEY;
  const blockedReasons = plan.policy_decision?.blocked_reasons || [];
  const authorityBinding = await resolvePlatformResourceAuthorityBinding(plan, args, mode);
  if (mode !== "plan" && authorityBinding.required && !authorityBinding.granted) {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_platform_resource_authority_binding",
      mode,
      apply_requested: applyRequested,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: authorityBinding.decision,
      authority_binding: authorityBinding,
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

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

  if (applyRequested && !manifestApplyRequested && !graphProjectionApplyRequested) {
    return {
      ok: false,
      tool: "governed_resource_run",
      classification: "blocked_apply_not_supported_v1",
      mode,
      apply_requested: true,
      apply_allowed: false,
      dispatch_allowed: false,
      reason_code: "resource_recipe_apply_blocked_v1",
      message: "Resource recipe V1 only supports explicit guarded manifest create or graph projection apply for the artifact/export reconciliation recipe; all other writes, deletes, moves, content reads, and graph mutations remain blocked.",
      plan,
      provider_calls_made: 0,
      execution_allowed: false,
      secrets_included: false,
    };
  }

  if (!["read_only", "diagnostic", "continue_read_only", "manifest_dry_run", "graph_projection_dry_run", "apply"].includes(mode)) {
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

  if (recipe.adapter_kind === "endpoint_recipe" && recipe.recipe_key === REPOSITORY_PR_RECONCILE_RECIPE_KEY) {
    const githubReadOnlyExecutor = typeof deps.executeGithubReadOnly === "function"
      ? deps.executeGithubReadOnly
      : executeRepositoryPrReconciliationReadOnly;

    const githubArgs = { ...buildRepositoryPrReconciliationArgs(plan, args), authority_binding: authorityBinding };
    const githubReadOnlyResult = await githubReadOnlyExecutor("repo_pr_reconciliation_sweep", githubArgs);
    const reconciliation = buildRepositoryPrReconciliation(githubReadOnlyResult, plan, args);
    const auditEvidence = await recordRepositoryPrReconciliationEvidence(reconciliation, plan, args);
    return {
      ok: reconciliation.ok,
      tool: "governed_resource_run",
      classification: "repository_pr_reconciliation_read_only",
      mode,
      apply_requested: false,
      apply_allowed: false,
      dispatch_allowed: true,
      plan,
      result: {
        ...reconciliation,
        audit_evidence: auditEvidence,
      },
      provider_calls_made: reconciliation.provider_calls_made_by_read_only_executor,
      execution_allowed: true,
      audit_write_executed: Boolean(auditEvidence?.recorded),
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

  if (graphProjectionDryRunRequested) {
    result.graph_projection_dry_run = buildArtifactExportGraphProjectionDryRun(result, plan, args);
    result.recommended_next_operations = [
      "review_findings",
      "review_graph_projection_dry_run",
      "request_capability_envelope_before_future_graph_apply",
    ];
  }

  if (graphProjectionApplyRequested) {
    const graphProjectionDryRun = buildArtifactExportGraphProjectionDryRun(result, plan, args);
    result.graph_projection_dry_run = graphProjectionDryRun;
    const gate = await validateGraphProjectionApplyGate(graphProjectionDryRun, plan, args);
    if (!gate.ok) {
      return buildGraphProjectionApplyBlockedResult({
        reasonCode: gate.status || gate.reason_code || "graph_projection_apply_gate_blocked",
        message: gate.message || "Graph projection apply gate blocked execution.",
        plan,
        graphProjectionDryRun,
        envelope: gate,
      });
    }

    const graphWrite = await writeGraphProjectionCandidate(graphProjectionDryRun, plan, args);
    await markCapabilityEnvelopeReferenced({
      envelopeId: gate.envelope.envelope_id,
      executionRef: `resource_graph_projection_apply:${graphProjectionDryRun.projection_sha256}`,
    });

    return {
      ok: graphWrite.readback?.ok === true,
      tool: "governed_resource_run",
      classification: graphWrite.readback?.ok === true ? "resource_graph_projection_applied_with_readback" : "resource_graph_projection_apply_readback_degraded",
      mode,
      operation_intent: operationIntent,
      recipe_key: recipe.recipe_key,
      resource_type: recipe.resource_type,
      resource_uri: plan.resolved_resource?.resource_uri || null,
      graph_projection_dry_run: graphProjectionDryRun,
      capability_envelope: gate.envelope,
      graph_write: graphWrite,
      readback: graphWrite.readback,
      result,
      plan,
      apply_requested: true,
      apply_allowed: true,
      dispatch_allowed: true,
      provider_calls_made: 0,
      execution_allowed: true,
      graph_write_made: true,
      file_content_returned: false,
      secrets_included: false,
    };
  }

  if (manifestApplyRequested) {
    const manifestDryRun = buildArtifactExportManifestDryRun(result, plan, args);
    result.manifest_materialization_dry_run = manifestDryRun;
    const gate = await validateManifestCreateGate(manifestDryRun, plan, args);
    if (!gate.ok) {
      return buildManifestCreateBlockedResult({
        reasonCode: gate.status || gate.reason_code || "manifest_create_gate_blocked",
        message: gate.message || "Manifest create gate blocked execution.",
        plan,
        manifestDryRun,
        envelope: gate,
      });
    }
    if (typeof deps.executeRuntimeEndpoint !== "function") {
      return buildManifestCreateBlockedResult({
        reasonCode: "manifest_create_runtime_endpoint_executor_missing",
        message: "Manifest create requires a governed runtime endpoint executor.",
        plan,
        manifestDryRun,
        envelope: gate.envelope,
      });
    }

    const uploadPayload = buildManifestUploadPayload(manifestDryRun, plan, args);
    const writeStartedAt = new Date().toISOString();
    const writeResult = await deps.executeRuntimeEndpoint(uploadPayload, { plan, manifestDryRun, mode });
    const createdFileId = fileIdFromEndpointResult(writeResult);
    let readbackResult = null;
    let readbackOk = false;
    if (createdFileId) {
      readbackResult = await deps.executeRuntimeEndpoint(buildManifestReadbackPayload(createdFileId, args), { plan, manifestDryRun, mode, readback: true });
      const readbackId = fileIdFromEndpointResult(readbackResult);
      readbackOk = readbackId === createdFileId;
    }
    await markCapabilityEnvelopeReferenced({
      envelopeId: gate.envelope.envelope_id,
      executionRef: `resource_manifest_create:${manifestDryRun.filename}:${manifestDryRun.content_sha256}`,
    });

    return {
      ok: readbackOk,
      tool: "governed_resource_run",
      classification: readbackOk ? "manifest_created_with_readback" : "manifest_create_readback_degraded",
      mode,
      recipe_key: recipe.recipe_key,
      resource_type: recipe.resource_type,
      resource_uri: plan.resolved_resource?.resource_uri || null,
      manifest_materialization_dry_run: manifestDryRun,
      capability_envelope: gate.envelope,
      drive_write: {
        endpoint_key: "uploadNewFile",
        started_at: writeStartedAt,
        completed_at: new Date().toISOString(),
        file_id: createdFileId || null,
        filename: manifestDryRun.filename,
        content_sha256: manifestDryRun.content_sha256,
        content_size_bytes: manifestDryRun.content_size_bytes,
        overwrite_allowed: false,
        secrets_included: false,
      },
      readback: {
        required: true,
        ok: readbackOk,
        endpoint_key: "getFileMetadata",
        result: readbackResult,
        secrets_included: false,
      },
      result,
      plan,
      apply_requested: true,
      apply_allowed: true,
      dispatch_allowed: true,
      provider_calls_made: readbackResult ? 2 : 1,
      execution_allowed: true,
      graph_write_made: false,
      file_content_returned: false,
      secrets_included: false,
    };
  }

  return {
    ok: true,
    tool: "governed_resource_run",
    classification: mode === "manifest_dry_run" ? "manifest_dry_run_ready" : mode === "graph_projection_dry_run" ? "graph_projection_dry_run_ready" : result.classification || "read_only_executed",
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
