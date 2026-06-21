#!/usr/bin/env node
import { getPool } from "../db.js";

const POLICY_KEY = "dynamic_capability_resolution_policy_v1";
const SOURCE_TIER_POLICY_KEY = "dynamic_capability_source_tiers_v1";
const APP_KEY_LOOKUP_ALIASES = Object.freeze({
  mysql: "remote_mysql_database",
});

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    tenantId: "",
    userId: "",
    workspaceId: "",
    workspaceKey: "",
    workspaceType: "",
    userRole: "",
    brandKey: "",
    businessActivityType: "",
    appKey: "",
    capabilityKey: "",
    operationIntent: "read",
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
    else if (key === "--workspace-id") { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-key") { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-type") { args.workspaceType = value || ""; if (consume) i += 1; }
    else if (key === "--user-role") { args.userRole = value || ""; if (consume) i += 1; }
    else if (key === "--brand-key") { args.brandKey = value || ""; if (consume) i += 1; }
    else if (key === "--business-activity-type") { args.businessActivityType = value || ""; if (consume) i += 1; }
    else if (key === "--app-key") { args.appKey = value || ""; if (consume) i += 1; }
    else if (key === "--capability-key") { args.capabilityKey = value || ""; if (consume) i += 1; }
    else if (key === "--operation-intent") { args.operationIntent = value || "read"; if (consume) i += 1; }
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

function resolveAppLookupKey(value = "") {
  const key = normalizeKey(value);
  return APP_KEY_LOOKUP_ALIASES[key] || key;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
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

async function loadAppMap(pool, appKey) {
  if (!appKey) return [];
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
}

async function loadApplyAuthorizationPolicy(pool, { appKey, capabilityKey, operationIntent, runtimeSurface }) {
  if (!appKey || !capabilityKey || !runtimeSurface) return null;
  const [rows] = await pool.query(
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
            allow_external_write, allow_no_credential_binding, requires_ready_for_dispatch,
            requires_dispatch_allowed, requires_zero_blocking_gaps, requires_audit_evidence,
            requires_readback, requires_typed_confirmation, requires_same_cycle_dry_run
       FROM capability_apply_authorization_policy_registry
      WHERE app_key = ?
        AND capability_key = ?
        AND runtime_surface = ?
        AND status = 'active'
        AND (operation_intent IS NULL OR operation_intent = '' OR operation_intent = ?)
      ORDER BY CASE WHEN operation_intent = ? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [appKey, capabilityKey, runtimeSurface, operationIntent || "", operationIntent || ""]
  );
  return rows?.[0] || null;
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

async function loadWorkspaceGrants(pool, { tenantId, userId, workspaceId, workspaceKey, brandKey, appKey }) {
  if (!tenantId || !userId) return [];
  // Legacy membership backfills used tenant_id as the workspace resource_ref.
  // New grants use workspace_id; workspace_key remains a supported human-readable alias.
  const refs = unique([workspaceId, workspaceKey, tenantId, brandKey, appKey]);
  if (!refs.length) return [];
  const [rows] = await pool.query(
    `SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, grant_status, membership_role, membership_status, expires_at
       FROM v_workspace_resource_grant_effective
      WHERE tenant_id = ?
        AND grantee_user_id = ?
        AND grant_status = 'active'
        AND membership_status = 'active'
        AND resource_ref IN (${refs.map(() => "?").join(",")})`,
    [tenantId, userId, ...refs]
  );
  return rows;
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

function deriveSourceTiers({ appMap = [], connections = [], credentialBindings = [], operationRisk = "low", policy = {}, platformNoCredentialAllowed = false }) {
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
  if (platformNoCredentialAllowed) sourceTiers.push("platform_managed_fallback");
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

function authorityStatus({ workspace, grants = [], brandKey, brandCore, activity, risk, certifications = [], sourceTiers }) {
  const missing = [];
  const passed = [];
  const grantPermissions = new Set(grants.map((grant) => grant.permission));
  const strongGrant = ["owner", "admin", "manage", "operate", "edit"].some((permission) => grantPermissions.has(permission));
  if (workspace) passed.push("workspace_resolved");
  else if (["high", "critical"].includes(risk)) missing.push("workspace_context_missing_or_unresolved");

  if (grants.length) passed.push("workspace_resource_grant_present");
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

  if (["high", "critical"].includes(risk) && !strongGrant) missing.push("elevated_permission_missing");

  if (sourceTiers.selected_source_tier === "platform_managed_fallback") {
    passed.push("platform_fallback_requires_quota_audit_disclosure");
  }
  return { passed, missing, status: missing.length ? "incomplete" : "passed" };
}

export async function runCapabilityResolutionDryRun(args = parseArgs(), dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const policyConfig = await loadRuntimeConfig(pool, POLICY_KEY);
  const sourceTierConfig = await loadRuntimeConfig(pool, SOURCE_TIER_POLICY_KEY);
  const policy = policyConfig?.json || {};
  const workspace = await loadWorkspace(pool, args);
  const tenantId = normalizeKey(args.tenantId || workspace?.tenant_id || "");
  const workspaceId = normalizeKey(args.workspaceId || workspace?.workspace_id || "");
  const workspaceType = normalizeKey(args.workspaceType || workspace?.workspace_type || "unknown");
  const brandKey = normalizeKey(args.brandKey || workspace?.linked_brand_key || "");
  const activity = await loadActivity(pool, args.businessActivityType);
  const appLookupKey = resolveAppLookupKey(args.appKey);
  const app = await loadApp(pool, appLookupKey);
  const appMap = await loadAppMap(pool, appLookupKey);
  const brandCore = await loadBrandCore(pool, brandKey);
  const grants = await loadWorkspaceGrants(pool, { tenantId, userId: args.userId, workspaceId, workspaceKey: workspace?.workspace_key || args.workspaceKey, brandKey, appKey: args.appKey });
  const connections = await loadConnections(pool, { tenantId, userId: args.userId, appKey: appLookupKey });
  const credentialBindings = await loadCredentialBindings(pool, { tenantId, appKey: args.appKey, capabilityKey: args.capabilityKey });
  const applyAuthorizationPolicy = await loadApplyAuthorizationPolicy(pool, {
    appKey: args.appKey,
    capabilityKey: args.capabilityKey,
    operationIntent: args.operationIntent,
    runtimeSurface: args.runtimeSurface,
  });
  const platformNoCredentialAllowed = Boolean(
    applyAuthorizationPolicy &&
    Number(applyAuthorizationPolicy.allow_no_credential_binding || 0) === 1 &&
    Number(applyAuthorizationPolicy.allow_external_write || 0) === 0
  );
  const certificationCandidates = unique([
    args.capabilityKey,
    args.runtimeSurface,
    `${args.appKey}_v1`,
    `${args.appKey}_${args.operationIntent}_v1`,
    ...appMap.map((row) => row.action_key).filter(Boolean),
  ]);
  const certifications = await loadDispatchCertification(pool, certificationCandidates);
  const risk = riskForOperation(args.operationIntent);
  const sourceTiers = deriveSourceTiers({
    appMap,
    connections,
    credentialBindings,
    operationRisk: risk,
    policy,
    platformNoCredentialAllowed,
  });
  const authority = authorityStatus({ workspace, grants, brandKey, brandCore, activity, risk, certifications, sourceTiers });
  const availableRuntimeSurfaces = unique([
    ...appMap.map((row) => row.runtime_capability_class).filter(Boolean),
    ...appMap.map((row) => row.connector_family).filter(Boolean),
    args.runtimeSurface,
  ]);
  const blockingGaps = [];
  if (!app) blockingGaps.push("app_integration_missing_or_unresolved");
  if (!tenantId) blockingGaps.push("tenant_id_missing");
  if (!args.userId) blockingGaps.push("user_id_missing");
  if (!args.appKey && !args.capabilityKey) blockingGaps.push("app_key_or_capability_key_required");
  if (!connections.length && !credentialBindings.length && !platformNoCredentialAllowed && !appMap.some((row) => row.credential_source === "platform_managed" || row.credential_source === "none")) blockingGaps.push("no_active_connection_or_credential_binding_found");
  blockingGaps.push(...authority.missing);

  const approvalRequired = approvalRequiredForRisk(risk) || sourceTiers.selected_source_tier === "platform_managed_fallback";
  const quotaRequired = sourceTiers.selected_source_tier === "platform_managed_fallback" || risk === "critical";
  const readbackRequired = ["medium", "high", "critical"].includes(risk);
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
      user_id: args.userId || null,
      workspace_id: workspaceId || null,
      workspace_key: workspace?.workspace_key || args.workspaceKey || null,
      workspace_type: workspaceType,
      user_role: args.userRole || null,
      brand_key: brandKey || null,
      business_activity_type: args.businessActivityType || null,
      operation_intent: args.operationIntent,
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
      credential_source_candidates: unique([
        ...appMap.map((row) => row.credential_source).filter(Boolean),
        ...(platformNoCredentialAllowed ? ["none"] : []),
      ]),
      active_connection_count: connections.length,
      active_credential_binding_count: credentialBindings.length,
      runtime_surface_candidates: availableRuntimeSurfaces,
      selected_runtime_surface: args.runtimeSurface || availableRuntimeSurfaces[0] || null,
      apply_authorization_policy_key: applyAuthorizationPolicy?.policy_key || null,
    },
    authority: {
      status: authority.status,
      passed: authority.passed,
      missing: authority.missing,
      grants: grants.map((grant) => ({ resource_type: grant.resource_type, resource_ref: grant.resource_ref, permission: grant.permission })),
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
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "capability_resolution_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
