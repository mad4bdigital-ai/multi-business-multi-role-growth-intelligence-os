#!/usr/bin/env node
import { getPool } from "../db.js";
import { closeGovernancePool } from "../governanceDb.js";
import { resolvePlatformResourceAuthorityPool } from "../platformResourceAuthorityStore.js";

const POLICY_KEY = "dynamic_capability_resolution_policy_v1";
const SOURCE_TIER_POLICY_KEY = "dynamic_capability_source_tiers_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;
const EXACT_GITHUB_RESOURCE_RE = /^github:\/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PLATFORM_AUTHORITY_RECIPES = new Set(["repo_patch_apply", "repo_patch_batch_apply", "github_pr_create"]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    tenantId: "",
    userId: "",
    principalType: "",
    principalId: "",
    workspaceId: "",
    workspaceKey: "",
    workspaceType: "",
    userRole: "",
    brandKey: "",
    businessActivityType: "",
    appKey: "",
    capabilityKey: "",
    operationIntent: "read",
    operationMode: "",
    resourceType: "",
    resourceUri: "",
    resourceBranch: "",
    expectedCommitSha: "",
    recipeKey: "",
    runtimeSurface: "",
    requestedSourceTier: "",
    explain: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const [key, inlineValue] = item.includes("=") ? item.split(/=(.*)/s).filter((_, idx) => idx < 2) : [item, null];
    const value = inlineValue ?? argv[i + 1];
    const consume = inlineValue === null;
    if (key === "--tenant-id") { args.tenantId = value || ""; if (consume) i += 1; }
    else if (key === "--user-id") { args.userId = value || ""; if (consume) i += 1; }
    else if (key === "--principal-type") { args.principalType = value || ""; if (consume) i += 1; }
    else if (key === "--principal-id") { args.principalId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-id") { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-key") { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-type") { args.workspaceType = value || ""; if (consume) i += 1; }
    else if (key === "--user-role") { args.userRole = value || ""; if (consume) i += 1; }
    else if (key === "--brand-key") { args.brandKey = value || ""; if (consume) i += 1; }
    else if (key === "--business-activity-type") { args.businessActivityType = value || ""; if (consume) i += 1; }
    else if (key === "--app-key") { args.appKey = value || ""; if (consume) i += 1; }
    else if (key === "--capability-key") { args.capabilityKey = value || ""; if (consume) i += 1; }
    else if (key === "--operation-intent") { args.operationIntent = value || "read"; if (consume) i += 1; }
    else if (key === "--operation-mode") { args.operationMode = value || ""; if (consume) i += 1; }
    else if (key === "--resource-type") { args.resourceType = value || ""; if (consume) i += 1; }
    else if (key === "--resource-uri") { args.resourceUri = value || ""; if (consume) i += 1; }
    else if (key === "--resource-branch" || key === "--branch") { args.resourceBranch = value || ""; if (consume) i += 1; }
    else if (key === "--expected-commit-sha") { args.expectedCommitSha = String(value || "").toLowerCase(); if (consume) i += 1; }
    else if (key === "--expected-branch-sha") { args.expectedCommitSha = String(value || args.expectedCommitSha).toLowerCase(); if (consume) i += 1; }
    else if (key === "--expected-base-sha") { if (!args.expectedCommitSha) args.expectedCommitSha = String(value || "").toLowerCase(); if (consume) i += 1; }
    else if (key === "--recipe-key") { args.recipeKey = value || ""; if (consume) i += 1; }
    else if (key === "--runtime-surface") { args.runtimeSurface = value || ""; if (consume) i += 1; }
    else if (key === "--requested-source-tier") { args.requestedSourceTier = value || ""; if (consume) i += 1; }
    else if (key === "--explain") args.explain = true;
  }
  return args;
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeKey(value = "") {
  return String(value || "").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizePrincipalContext(args = {}) {
  const principalId = normalizeKey(args.principalId || args.userId);
  const explicitType = normalizeKey(args.principalType).toLowerCase();
  const principalType = explicitType || (UUID_RE.test(principalId) ? "user" : "");
  return { principal_type: principalType, principal_id: principalId };
}

function canResolveServiceAuthority(principal = {}) {
  const principalType = normalizeKey(principal?.principal_type).toLowerCase();
  return Boolean(principal?.principal_id && (!principalType || principalType === "service"));
}

function inferResourceType(resourceUri = "") {
  const uri = normalizeKey(resourceUri);
  return EXACT_GITHUB_RESOURCE_RE.test(uri) ? "github_repo" : "";
}

function resourceAuthorityContext(args = {}) {
  const resourceUri = normalizeKey(args.resourceUri);
  const capabilityRecipe = PLATFORM_AUTHORITY_RECIPES.has(normalizeKey(args.capabilityKey)) ? normalizeKey(args.capabilityKey) : "";
  return {
    resource_type: normalizeKey(args.resourceType) || inferResourceType(resourceUri),
    resource_uri: resourceUri,
    resource_branch: normalizeKey(args.resourceBranch || args.branch),
    expected_commit_sha: normalizeKey(args.expectedCommitSha || args.expectedBranchSha || args.expectedBaseSha).toLowerCase(),
    recipe_key: normalizeKey(args.recipeKey) || capabilityRecipe,
    operation_mode: normalizeKey(args.operationMode),
  };
}

function riskForOperation(operationIntent = "read") {
  const op = normalizeKey(operationIntent).toLowerCase();
  if (["delete", "credential_promote", "spend", "deploy", "restart", "ssh", "shell"].some((key) => op.includes(key))) return "critical";
  if (["publish", "write", "apply", "mutate", "update", "create"].some((key) => op.includes(key))) return "high";
  if (["validate", "draft", "plan", "diagnose", "probe", "inspect"].some((key) => op.includes(key))) return "medium";
  return "low";
}

function approvalRequiredForRisk(risk) {
  return ["high", "critical"].includes(risk);
}

async function loadRuntimeConfig(pool, configKey) {
  const [rows] = await pool.query("SELECT config_json, status, note FROM platform_runtime_config WHERE config_key = ? LIMIT 1", [configKey]);
  const row = rows[0] || null;
  return row ? { ...row, json: safeJson(row.config_json, {}) } : null;
}

async function loadWorkspace(pool, args) {
  if (!args.workspaceId && !args.workspaceKey) return null;
  const [rows] = args.workspaceId
    ? await pool.query("SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, linked_brand_key, config_json FROM workspace_registry WHERE workspace_id = ? LIMIT 1", [args.workspaceId])
    : await pool.query("SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, linked_brand_key, config_json FROM workspace_registry WHERE workspace_key = ? LIMIT 1", [args.workspaceKey]);
  return rows[0] || null;
}

async function loadActivity(pool, key) {
  if (!key) return null;
  const [rows] = await pool.query(
    `SELECT business_activity_type_key, activity_key, business_type_key, label, brand_core_required, supported_engine_categories, supported_route_keys, supported_workflows, status, active
       FROM business_activity_types
      WHERE business_activity_type_key = ? OR activity_key = ?
      LIMIT 1`,
    [key, key]
  );
  return rows[0] || null;
}

async function loadApp(pool, appKey) {
  if (!appKey) return null;
  const [rows] = await pool.query("SELECT app_key, display_name, auth_type, category, status FROM app_integrations WHERE app_key = ? LIMIT 1", [appKey]);
  return rows[0] || null;
}

export function isMissingAppCapabilityMapError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return ["ER_NO_SUCH_TABLE", "ER_VIEW_INVALID"].includes(code)
    && /v_app_integration_capability_map/i.test(message);
}

export async function loadAppMap(pool, appKey) {
  if (!appKey) return [];
  try {
    const [rows] = await pool.query(
      `SELECT app_key, app_display_name, app_category, app_auth_type, app_status, action_key, binding_role, credential_source,
              exposure_default, binding_status, connector_family, runtime_capability_class, runtime_callable, primary_executor,
              active_endpoints, active_tool_exports, active_tool_bindings, bound_tool_keys, active_user_connections
         FROM v_app_integration_capability_map
        WHERE app_key = ?
        ORDER BY active_tool_exports DESC, active_user_connections DESC, action_key`,
      [appKey]
    );
    return rows;
  } catch (error) {
    if (!isMissingAppCapabilityMapError(error)) throw error;
    const [rows] = await pool.query(
      `SELECT
         ai.app_key,
         ai.display_name AS app_display_name,
         ai.category AS app_category,
         ai.auth_type AS app_auth_type,
         ai.status AS app_status,
         b.action_key,
         b.binding_role,
         b.credential_source,
         b.exposure_default,
         b.status AS binding_status,
         a.connector_family,
         a.runtime_capability_class,
         a.runtime_callable,
         a.primary_executor,
         COALESCE(ep.active_endpoints, 0) AS active_endpoints,
         COALESCE(tx.active_tool_exports, 0) AS active_tool_exports,
         COALESCE(tb.active_tool_bindings, 0) AS active_tool_bindings,
         COALESCE(tb.bound_tool_keys, '') AS bound_tool_keys,
         COALESCE(uc.active_connections, 0) AS active_user_connections
       FROM app_integrations ai
       LEFT JOIN app_integration_action_bindings b
         ON CONVERT(b.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
        AND b.status = 'active'
       LEFT JOIN actions a
         ON CONVERT(a.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
       LEFT JOIN (
         SELECT parent_action_key, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_endpoints
         FROM endpoints
         GROUP BY parent_action_key
       ) ep
         ON CONVERT(ep.parent_action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
       LEFT JOIN (
         SELECT parent_action_key, COUNT(*) AS active_tool_exports
         FROM platform_endpoint_tool_exports
         WHERE status = 'active'
         GROUP BY parent_action_key
       ) tx
         ON CONVERT(tx.parent_action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
       LEFT JOIN (
         SELECT app_key, COUNT(*) AS active_tool_bindings, GROUP_CONCAT(tool_key ORDER BY tool_key SEPARATOR ', ') AS bound_tool_keys
         FROM app_integration_tool_bindings
         WHERE status = 'active'
         GROUP BY app_key
       ) tb
         ON CONVERT(tb.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
       LEFT JOIN (
         SELECT app_key, COUNT(*) AS active_connections
         FROM user_app_connections
         WHERE status = 'active'
         GROUP BY app_key
       ) uc
         ON CONVERT(uc.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
       WHERE ai.app_key = ?
       ORDER BY active_tool_exports DESC, active_user_connections DESC, action_key`,
      [appKey]
    );
    return rows;
  }
}

async function loadBrandCore(pool, brandKey) {
  if (!brandKey) return null;
  const [rows] = await pool.query(
    `SELECT brand_key, brand_name, status, active_status, validation_status, registry_role, updated_at
       FROM brand_core
      WHERE brand_key = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [brandKey]
  );
  return rows[0] || null;
}

export function isMissingWorkspaceGrantViewError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return ["ER_NO_SUCH_TABLE", "ER_VIEW_INVALID"].includes(code)
    && /v_workspace_resource_grant_effective/i.test(message);
}

export async function loadWorkspaceGrants(pool, { tenantId, userId, workspaceId, workspaceKey, brandKey, appKey }) {
  if (!tenantId || !userId) return [];
  const refs = unique([workspaceId, workspaceKey, tenantId, brandKey, appKey]);
  if (!refs.length) return [];
  const params = [tenantId, userId, ...refs];
  try {
    const [rows] = await pool.query(
      `SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, grant_status, membership_role, membership_status, expires_at
         FROM v_workspace_resource_grant_effective
        WHERE tenant_id = ?
          AND grantee_user_id = ?
          AND grant_status = 'active'
          AND membership_status = 'active'
          AND resource_ref IN (${refs.map(() => "?").join(",")})`,
      params
    );
    return rows;
  } catch (error) {
    if (!isMissingWorkspaceGrantViewError(error)) throw error;
    const [rows] = await pool.query(
      `SELECT
         g.grant_id,
         g.tenant_id,
         g.grantee_user_id,
         g.resource_type,
         g.resource_ref,
         g.permission,
         g.status AS grant_status,
         m.role AS membership_role,
         m.status AS membership_status,
         g.expires_at
       FROM workspace_resource_grants g
       JOIN memberships m
         ON m.tenant_id = g.tenant_id
        AND m.user_id = g.grantee_user_id
        AND m.status = 'active'
       LEFT JOIN users u
         ON u.user_id = g.grantee_user_id
       WHERE g.tenant_id = ?
         AND g.grantee_user_id = ?
         AND g.status = 'active'
         AND (g.expires_at IS NULL OR g.expires_at > NOW())
         AND g.resource_ref IN (${refs.map(() => "?").join(",")})`,
      params
    );
    return rows;
  }
}

function isMissingPlatformResourceAuthorityTableError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "ER_NO_SUCH_TABLE" || /platform_resource_authority_bindings.*doesn't exist/i.test(message);
}

export async function loadPlatformResourceAuthorityBindings(pool, {
  tenantId,
  workspaceId,
  principal,
  resourceType,
  resourceUri,
  recipeKey,
}) {
  if (
    !canResolveServiceAuthority(principal)
    || !tenantId
    || !workspaceId
    || !resourceType
    || !resourceUri
    || !recipeKey
  ) return [];
  try {
    const [rows] = await pool.query(
      `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, resource_ref_json,
              recipe_key, permission_level, allowed_modes_json, authority_source, status, expires_at, created_at
         FROM platform_resource_authority_bindings
        WHERE status = 'active'
          AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
          AND tenant_id = ?
          AND workspace_id = ?
          AND user_id = ?
          AND resource_type = ?
          AND resource_uri = ?
          AND recipe_key = ?
        ORDER BY created_at DESC`,
      [tenantId, workspaceId, principal.principal_id, resourceType, resourceUri, recipeKey]
    );
    return rows;
  } catch (error) {
    if (isMissingPlatformResourceAuthorityTableError(error)) return [];
    throw error;
  }
}

function parseAllowedModes(value) {
  const parsed = safeJson(value, []);
  return Array.isArray(parsed) ? parsed.map((item) => normalizeKey(item)).filter(Boolean) : [];
}

function storedPrincipal(binding = {}) {
  const resourceRef = safeJson(binding.resource_ref_json, {});
  const principal = resourceRef?.principal;
  return principal && typeof principal === "object" && !Array.isArray(principal)
    ? {
        principal_type: normalizeKey(principal.principal_type).toLowerCase(),
        principal_id: normalizeKey(principal.principal_id),
      }
    : { principal_type: "", principal_id: "" };
}

function storedExecutionScope(binding = {}) {
  const resourceRef = safeJson(binding.resource_ref_json, {});
  return {
    branch: normalizeKey(resourceRef.branch),
    expected_commit_sha: normalizeKey(resourceRef.expected_commit_sha || resourceRef.base_sha).toLowerCase(),
  };
}

const PERMISSION_RANK = Object.freeze({
  read_only: 1,
  diagnostic: 1,
  view: 1,
  patch: 2,
  edit: 2,
  operate: 2,
  manage: 2,
  admin: 3,
  owner: 3,
});

function requiredPermissionRank(operationMode = "") {
  const mode = normalizeKey(operationMode);
  if (["read_only", "diagnostic", "continue_read_only", "plan"].includes(mode)) return 1;
  if (["write_file", "replace_block", "apply_unified_diff", "delete_file", "atomic_change_set"].includes(mode)) return 2;
  if (["create_pull_request"].includes(mode)) return 3;
  return Number.POSITIVE_INFINITY;
}

export function permissionSatisfiesResourceOperation(permissionLevel = "", operationMode = "") {
  const rank = PERMISSION_RANK[normalizeKey(permissionLevel).toLowerCase()] || 0;
  return rank >= requiredPermissionRank(operationMode);
}

export function resolveExactPlatformAuthorityExecutionScope({ bindings = [], resourceBranch = "", expectedCommitSha = "" } = {}) {
  const expectedSha = normalizeKey(expectedCommitSha).toLowerCase();
  const requestedBranch = normalizeKey(resourceBranch);
  if (!SHA_RE.test(expectedSha)) return { ok: false, reason: "expected_commit_sha_missing_or_invalid" };
  const shaMatches = bindings.map((binding) => ({ binding, ...storedExecutionScope(binding) }))
    .filter((candidate) => candidate.branch && candidate.expected_commit_sha === expectedSha);
  if (!shaMatches.length) return { ok: false, reason: "expected_commit_sha_mismatch" };
  if (requestedBranch) {
    const exact = shaMatches.find((candidate) => candidate.branch === requestedBranch);
    return exact
      ? { ok: true, binding: exact.binding, binding_id: exact.binding.binding_id, resource_branch: requestedBranch, expected_commit_sha: expectedSha }
      : { ok: false, reason: "resource_branch_mismatch" };
  }
  const branches = unique(shaMatches.map((candidate) => candidate.branch));
  if (branches.length !== 1) return { ok: false, reason: branches.length ? "resource_branch_ambiguous" : "resource_branch_missing" };
  return {
    ok: true,
    binding: shaMatches[0].binding,
    binding_id: shaMatches[0].binding.binding_id,
    resource_branch: branches[0],
    expected_commit_sha: expectedSha,
  };
}

export function resolveExactAdminResourceAuthority({
  principal,
  bindings = [],
  tenantId,
  workspaceId,
  resourceType,
  resourceUri,
  resourceBranch,
  expectedCommitSha,
  recipeKey,
  operationMode,
  now = new Date(),
}) {
  if (!canResolveServiceAuthority(principal)) return { matched: false, reason: "principal_not_service_authority_eligible" };
  if (!tenantId || !workspaceId || !resourceType || !resourceUri || !recipeKey || !operationMode) return { matched: false, reason: "authority_context_incomplete" };
  if (resourceUri.includes("*") || (resourceType === "github_repo" && !EXACT_GITHUB_RESOURCE_RE.test(resourceUri))) return { matched: false, reason: "resource_uri_not_exact" };
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const candidates = bindings.filter((binding) => {
    if (normalizeKey(binding.status).toLowerCase() !== "active") return false;
    if (binding.expires_at && new Date(binding.expires_at).getTime() <= nowMs) return false;
    if (normalizeKey(binding.tenant_id) !== tenantId) return false;
    if (normalizeKey(binding.workspace_id) !== workspaceId) return false;
    if (normalizeKey(binding.user_id) !== principal.principal_id) return false;
    if (normalizeKey(binding.resource_type) !== resourceType) return false;
    if (normalizeKey(binding.resource_uri) !== resourceUri || normalizeKey(binding.resource_uri).includes("*")) return false;
    if (normalizeKey(binding.recipe_key) !== recipeKey) return false;
    const bindingPrincipal = storedPrincipal(binding);
    if (bindingPrincipal.principal_type !== "service" || bindingPrincipal.principal_id !== principal.principal_id) return false;
    const modes = parseAllowedModes(binding.allowed_modes_json);
    if (modes.includes("*") || !modes.includes(operationMode)) return false;
    return permissionSatisfiesResourceOperation(binding.permission_level, operationMode);
  });
  const scope = resolveExactPlatformAuthorityExecutionScope({ bindings: candidates, resourceBranch, expectedCommitSha });
  if (!scope.ok) return { matched: false, reason: scope.reason };
  return {
    matched: true,
    binding_id: scope.binding_id,
    resource_branch: scope.resource_branch,
    expected_commit_sha: scope.expected_commit_sha,
    secrets_included: false,
  };
}

export function hasExactAdminResourceAuthority(args = {}) {
  return resolveExactAdminResourceAuthority(args).matched === true;
}

async function loadConnections(pool, { tenantId, userId, appKey }) {
  if (!tenantId || !appKey) return [];
  const params = [tenantId, appKey];
  let userClause = "";
  if (userId) {
    userClause = " OR user_id = ?";
    params.push(userId);
  }
  const [rows] = await pool.query(
    `SELECT connection_id, user_id, tenant_id, app_key, auth_type, status, validation_status, is_primary, last_validated_at, last_used_at, account_label
       FROM user_app_connections
      WHERE tenant_id = ?
        AND app_key = ?
        AND status = 'active'
        AND (tenant_id = ?${userClause})
      ORDER BY is_primary DESC, last_validated_at DESC, connected_at DESC
      LIMIT 20`,
    [tenantId, appKey, tenantId, ...(userId ? [userId] : [])]
  ).catch(async () => {
    const [fallbackRows] = await pool.query(
      `SELECT connection_id, user_id, tenant_id, app_key, auth_type, status, validation_status, is_primary, last_validated_at, last_used_at, account_label
         FROM user_app_connections
        WHERE tenant_id = ? AND app_key = ? AND status = 'active'
        ORDER BY is_primary DESC, last_validated_at DESC, connected_at DESC
        LIMIT 20`,
      [tenantId, appKey]
    );
    return [fallbackRows];
  });
  return rows;
}

async function loadCredentialBindings(pool, { tenantId, appKey, capabilityKey }) {
  if (!tenantId) return [];
  const filters = [];
  const params = [tenantId];
  if (appKey) {
    filters.push("(provider_family = ? OR connector_family = ? OR target_key = ?)");
    params.push(appKey, appKey, appKey);
  }
  if (capabilityKey) {
    filters.push("(action_key = ? OR target_key = ?)");
    params.push(capabilityKey, capabilityKey);
  }
  const where = filters.length ? `AND (${filters.join(" OR ")})` : "";
  const [rows] = await pool.query(
    `SELECT binding_id, tenant_id, owner_type, owner_id, user_id, system_id, installation_id, connection_id, action_key, target_key,
            credential_role, credential_ref, provider_family, connector_family, resolution_priority, status
       FROM credential_bindings
      WHERE tenant_id = ?
        AND status = 'active'
        ${where}
      ORDER BY resolution_priority DESC, updated_at DESC
      LIMIT 20`,
    params
  );
  return rows;
}

async function loadDispatchCertification(pool, keyCandidates = []) {
  const keys = unique(keyCandidates.map(normalizeKey));
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT certification_key, surface_key, tool_or_action_key, certification_status, dispatch_allowed, apply_allowed,
            requires_resource_authority, requires_dry_run, requires_readback, last_evidence_ref, last_certified_at, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE (certification_key IN (${placeholders})
         OR tool_or_action_key IN (${placeholders})
         OR surface_key IN (${placeholders}))
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [...keys, ...keys, ...keys]
  );
  return rows;
}

function deriveSourceTiers({ appMap = [], connections = [], credentialBindings = [], operationRisk = "low", policy = {} }) {
  const credentialSources = unique(appMap.map((row) => row.credential_source).filter(Boolean));
  const sourceTiers = [];
  const hasUserConnection = connections.some((row) => row.status === "active");
  const hasBinding = credentialBindings.length > 0;
  const platformBinding = credentialBindings.find((row) => String(row.credential_ref || "").startsWith("platform_secret:") || row.owner_type === "platform");
  const connectionBinding = credentialBindings.find((row) => row.connection_id || String(row.credential_ref || "").includes("connection"));

  if (hasUserConnection || credentialSources.includes("user_connection")) sourceTiers.push("user_owned_personal");
  if (connectionBinding || credentialSources.includes("tenant_connection")) sourceTiers.push("tenant_managed");
  if (credentialSources.includes("mixed")) sourceTiers.push("workspace_owner_managed", "tenant_managed");
  if (credentialSources.includes("target_resolved")) sourceTiers.push("remote_dedicated_runtime");
  if (credentialSources.includes("none")) sourceTiers.push("platform_managed_fallback");
  if (platformBinding || credentialSources.includes("platform_managed")) sourceTiers.push("platform_managed_fallback");
  if (!sourceTiers.length && hasBinding) sourceTiers.push("tenant_managed");

  const configuredOrder = Array.isArray(policy?.source_tier_priority_default) ? policy.source_tier_priority_default : [];
  const riskAwareOrder = ["critical", "high"].includes(operationRisk)
    ? [
        "client_dedicated",
        "remote_dedicated_runtime",
        "brand_managed",
        "tenant_managed",
        "workspace_owner_managed",
        "freelancer_managed_service",
        "agency_managed_service",
        "local_device_runtime",
        "user_owned_personal",
        "platform_managed_fallback",
        "blocked_requires_setup",
      ]
    : null;
  const order = riskAwareOrder || (configuredOrder.length ? configuredOrder : [
    "client_dedicated",
    "brand_managed",
    "user_owned_personal",
    "workspace_owner_managed",
    "freelancer_managed_service",
    "agency_managed_service",
    "tenant_managed",
    "remote_dedicated_runtime",
    "local_device_runtime",
    "platform_managed_fallback",
    "blocked_requires_setup",
  ]);
  const uniqueTiers = unique(sourceTiers);
  const selected = order.find((tier) => uniqueTiers.includes(tier)) || (operationRisk === "low" && uniqueTiers.includes("platform_managed_fallback") ? "platform_managed_fallback" : null);
  return {
    available_source_tiers: uniqueTiers,
    selected_source_tier: selected || "blocked_requires_setup",
    source_tier_order_used: order,
  };
}

export function authorityStatus({
  workspace,
  grants = [],
  platformResourceAuthorityBindings = [],
  principal,
  resourceType,
  resourceUri,
  resourceBranch,
  expectedCommitSha,
  recipeKey,
  operationMode,
  tenantId,
  workspaceId,
  brandKey,
  brandCore,
  activity,
  risk,
  certifications = [],
  sourceTiers,
}) {
  const missing = [];
  const passed = [];
  const grantPermissions = new Set(grants.map((grant) => grant.permission));
  const strongWorkspaceGrant = ["owner", "admin", "manage", "operate", "edit"].some((permission) => grantPermissions.has(permission));
  const platformAuthorityScope = resolveExactAdminResourceAuthority({
    principal,
    bindings: platformResourceAuthorityBindings,
    tenantId,
    workspaceId,
    resourceType,
    resourceUri,
    resourceBranch,
    expectedCommitSha,
    recipeKey,
    operationMode,
  });
  const exactPlatformAuthority = platformAuthorityScope.matched === true;
  const strongAuthority = strongWorkspaceGrant || exactPlatformAuthority;

  if (workspace) passed.push("workspace_resolved");
  else if (["high", "critical"].includes(risk)) missing.push("workspace_context_missing_or_unresolved");

  if (grants.length) passed.push("workspace_resource_grant_present");
  else if (exactPlatformAuthority) passed.push("exact_platform_resource_authority_present");
  else if (["high", "critical"].includes(risk)) missing.push("workspace_resource_grant_missing_for_high_risk_operation");

  if (brandKey) {
    if (brandCore) passed.push("brand_core_row_present");
    else missing.push("brand_core_missing_for_brand_context");
  }

  const brandCoreRequired = String(activity?.brand_core_required || "").toLowerCase() === "true" || String(activity?.brand_core_required || "").toLowerCase() === "required";
  if (brandCoreRequired && !brandCore) missing.push("brand_core_required_by_activity");

  const dispatchRows = certifications.filter((row) => Number(row.dispatch_allowed || 0) === 1);
  if (dispatchRows.length) passed.push("dispatch_certification_present");
  else if (["high", "critical"].includes(risk)) missing.push("dispatch_certification_missing_or_not_allowed");

  if (["high", "critical"].includes(risk) && !strongAuthority) missing.push("elevated_permission_missing");

  if (sourceTiers.selected_source_tier === "platform_managed_fallback") {
    passed.push("platform_fallback_requires_quota_audit_disclosure");
  }
  return {
    passed,
    missing,
    status: missing.length ? "incomplete" : "passed",
    exact_platform_resource_authority: exactPlatformAuthority,
    exact_platform_resource_authority_scope: platformAuthorityScope,
  };
}

export async function runCapabilityResolutionDryRun(args = parseArgs(), deps = {}) {
  const pool = getPool();
  const authorityPool = resolvePlatformResourceAuthorityPool({
    governancePool: deps.governancePool,
    authorityStorePool: deps.authorityStorePool,
  });
  const policyConfig = await loadRuntimeConfig(pool, POLICY_KEY);
  const sourceTierConfig = await loadRuntimeConfig(pool, SOURCE_TIER_POLICY_KEY);
  const policy = policyConfig?.json || {};
  const workspace = await loadWorkspace(pool, args);
  const tenantId = normalizeKey(args.tenantId || workspace?.tenant_id || "");
  const workspaceId = normalizeKey(args.workspaceId || workspace?.workspace_id || "");
  const workspaceType = normalizeKey(args.workspaceType || workspace?.workspace_type || "unknown");
  const brandKey = normalizeKey(args.brandKey || workspace?.linked_brand_key || "");
  const principal = normalizePrincipalContext(args);
  const requestedAuthority = resourceAuthorityContext(args);
  const activity = await loadActivity(pool, args.businessActivityType);
  const app = await loadApp(pool, args.appKey);
  const appMap = await loadAppMap(pool, args.appKey);
  const brandCore = await loadBrandCore(pool, brandKey);
  const workspaceGrantPrincipalId = principal.principal_id;
  const userPrincipalId = principal.principal_type === "user" ? principal.principal_id : "";
  const grants = await loadWorkspaceGrants(pool, { tenantId, userId: workspaceGrantPrincipalId, workspaceId, workspaceKey: workspace?.workspace_key || args.workspaceKey, brandKey, appKey: args.appKey });
  const platformResourceAuthorityBindings = await loadPlatformResourceAuthorityBindings(authorityPool, {
    tenantId,
    workspaceId,
    principal,
    resourceType: requestedAuthority.resource_type,
    resourceUri: requestedAuthority.resource_uri,
    recipeKey: requestedAuthority.recipe_key,
  });
  const connections = await loadConnections(pool, { tenantId, userId: userPrincipalId, appKey: args.appKey });
  const credentialBindings = await loadCredentialBindings(pool, { tenantId, appKey: args.appKey, capabilityKey: args.capabilityKey });
  const certificationCandidates = unique([
    args.capabilityKey,
    args.runtimeSurface,
    `${args.appKey}_v1`,
    `${args.appKey}_${args.operationIntent}_v1`,
    ...appMap.map((row) => row.action_key).filter(Boolean),
  ]);
  const certifications = await loadDispatchCertification(pool, certificationCandidates);
  const risk = riskForOperation(args.operationIntent);
  const sourceTiers = deriveSourceTiers({ appMap, connections, credentialBindings, operationRisk: risk, policy });
  const authority = authorityStatus({
    workspace,
    grants,
    platformResourceAuthorityBindings,
    principal,
    resourceType: requestedAuthority.resource_type,
    resourceUri: requestedAuthority.resource_uri,
    resourceBranch: requestedAuthority.resource_branch,
    expectedCommitSha: requestedAuthority.expected_commit_sha,
    recipeKey: requestedAuthority.recipe_key,
    operationMode: requestedAuthority.operation_mode,
    tenantId,
    workspaceId,
    brandKey,
    brandCore,
    activity,
    risk,
    certifications,
    sourceTiers,
  });
  const availableRuntimeSurfaces = unique([
    ...appMap.map((row) => row.runtime_capability_class).filter(Boolean),
    ...appMap.map((row) => row.connector_family).filter(Boolean),
    args.runtimeSurface,
  ]);
  const blockingGaps = [];
  if (!app) blockingGaps.push("app_integration_missing_or_unresolved");
  if (!tenantId) blockingGaps.push("tenant_id_missing");
  if (!principal.principal_id) blockingGaps.push("user_id_missing");
  if (!args.appKey && !args.capabilityKey) blockingGaps.push("app_key_or_capability_key_required");
  if (!connections.length && !credentialBindings.length && !appMap.some((row) => row.credential_source === "platform_managed" || row.credential_source === "none")) blockingGaps.push("no_active_connection_or_credential_binding_found");
  blockingGaps.push(...authority.missing);

  const approvalRequired = approvalRequiredForRisk(risk) || sourceTiers.selected_source_tier === "platform_managed_fallback";
  const quotaRequired = sourceTiers.selected_source_tier === "platform_managed_fallback" || risk === "critical";
  const readbackRequired = ["medium", "high", "critical"].includes(risk)
    || certifications.some((row) => Number(row.requires_readback || 0) === 1);
  const dispatchAllowed = blockingGaps.length === 0 && sourceTiers.selected_source_tier !== "blocked_requires_setup";
  const applyAllowed = dispatchAllowed && !approvalRequired && !["high", "critical"].includes(risk);
  const decision = dispatchAllowed
    ? (approvalRequired ? "ready_requires_approval" : "ready_for_dispatch")
    : (sourceTiers.selected_source_tier === "blocked_requires_setup" ? "blocked_requires_setup" : "blocked_missing_authority_or_binding");

  return {
    ok: true,
    policy_key: POLICY_KEY,
    source_tier_policy_key: SOURCE_TIER_POLICY_KEY,
    request_context: {
      tenant_id: tenantId || null,
      user_id: principal.principal_type === "user" ? principal.principal_id || null : null,
      principal: principal.principal_id ? principal : null,
      workspace_id: workspaceId || null,
      workspace_key: workspace?.workspace_key || args.workspaceKey || null,
      workspace_type: workspaceType,
      user_role: args.userRole || null,
      brand_key: brandKey || null,
      business_activity_type: args.businessActivityType || null,
      operation_intent: args.operationIntent,
      operation_mode: requestedAuthority.operation_mode || null,
      resource_type: requestedAuthority.resource_type || null,
      resource_uri: requestedAuthority.resource_uri || null,
      resource_branch: authority.exact_platform_resource_authority_scope?.matched ? authority.exact_platform_resource_authority_scope.resource_branch : requestedAuthority.resource_branch || null,
      expected_commit_sha: requestedAuthority.expected_commit_sha || null,
      recipe_key: requestedAuthority.recipe_key || null,
    },
    capability: {
      app_key: args.appKey || null,
      app_display_name: app?.display_name || appMap[0]?.app_display_name || null,
      capability_key: args.capabilityKey || appMap[0]?.action_key || null,
      app_category: app?.category || appMap[0]?.app_category || null,
      auth_type: app?.auth_type || appMap[0]?.app_auth_type || null,
      risk_class: risk,
    },
    selected_source: {
      selected_source_tier: sourceTiers.selected_source_tier,
      available_source_tiers: sourceTiers.available_source_tiers,
      credential_source_candidates: unique(appMap.map((row) => row.credential_source).filter(Boolean)),
      active_connection_count: connections.length,
      active_credential_binding_count: credentialBindings.length,
      runtime_surface_candidates: availableRuntimeSurfaces,
      selected_runtime_surface: args.runtimeSurface || availableRuntimeSurfaces[0] || null,
    },
    authority: {
      status: authority.status,
      passed: authority.passed,
      missing: authority.missing,
      grants: grants.map((grant) => ({ resource_type: grant.resource_type, resource_ref: grant.resource_ref, permission: grant.permission })),
      exact_platform_resource_authority: authority.exact_platform_resource_authority,
      exact_platform_resource_authority_scope: authority.exact_platform_resource_authority_scope,
      platform_resource_authority_bindings: platformResourceAuthorityBindings.map((binding) => ({
        binding_id: binding.binding_id,
        resource_type: binding.resource_type,
        resource_uri: binding.resource_uri,
        recipe_key: binding.recipe_key,
        permission_level: binding.permission_level,
        allowed_modes: parseAllowedModes(binding.allowed_modes_json),
        expires_at: binding.expires_at || null,
      })),
      brand_core_present: Boolean(brandCore),
      dispatch_certifications: certifications.map((row) => ({ certification_key: row.certification_key, surface_key: row.surface_key || null, tool_or_action_key: row.tool_or_action_key || null, dispatch_allowed: Boolean(row.dispatch_allowed), apply_allowed: Boolean(row.apply_allowed), status: row.certification_status })),
    },
    gates: {
      approval_required: approvalRequired,
      quota_required: quotaRequired,
      audit_required: true,
      readback_required: readbackRequired,
      dispatch_allowed: dispatchAllowed,
      apply_allowed: applyAllowed,
      secrets_included: false,
    },
    fallback_chain: sourceTiers.source_tier_order_used,
    blocking_gaps: unique(blockingGaps),
    decision,
    maturity: {
      app_map_rows: appMap.length,
      active_tool_exports: appMap.reduce((sum, row) => sum + Number(row.active_tool_exports || 0), 0),
      active_user_connections: appMap.reduce((sum, row) => sum + Number(row.active_user_connections || 0), 0),
    },
    explain: args.explain ? {
      notes: [
        "This is a dry-run envelope only; no tool/app/runtime was executed.",
        "Workspace_type values are read from the current workspace_registry enum; extended archetypes are policy-level context until a separate schema migration is approved.",
        "Exact platform resource authority may satisfy high-risk resource authority for typed service principals only; a legacy untyped principal id qualifies only when the exact persisted binding proves principal_type=service for the same principal id.",
        "Exact platform resource authority is bound to its stored repository branch and expected commit SHA; ambiguous or mismatched execution scope fails closed.",
        "Resource authority never satisfies dispatch certification, approval, readback, protected-branch, or mutation-policy gates.",
        "No credential values are read or returned; only counts and metadata are exposed.",
      ],
      source_tier_policy: sourceTierConfig?.json || null,
    } : undefined,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCapabilityResolutionDryRun(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
      await closeGovernancePool().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "capability_resolution_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      await closeGovernancePool().catch(() => {});
      process.exitCode = 1;
    });
}
