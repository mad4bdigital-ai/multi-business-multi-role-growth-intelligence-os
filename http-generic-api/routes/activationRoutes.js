import { randomUUID } from "crypto";
import { Router } from "express";
import { getPool } from "../db.js";
import { resolveActivationBootstrapConfig } from "../activationBootstrapConfig.js";
import { loadSessionSummaryGraphMemory } from "../sessionSummaryService.js";
import { resolvePlatformGraphMemory } from "../services/platformGraphMemoryResolver.js";
import { buildHardActivationEvidenceMatrix } from "../activationHardEvidence.js";
import {
  buildActivationOperationalDashboardEvidence,
  buildDynamicToolCatalogEvidence,
  buildRepoCanonicalRuntimeEvidence,
} from "../activationDynamicEvidence.js";
import { buildActivationDynamicTabsEvidence } from "../activationDynamicTabsEvidence.js";
import { buildActivationOperationalIntelligenceEvidence } from "../activationOperationalIntelligenceEvidence.js";
import {
  resolveActivationSessionLifecycle,
  acknowledgeActivationRun,
  markActivationRunPrepared,
  markActivationRunDelivered,
} from "../activationSessionLifecycleService.js";
import {
  buildProfiledHardActivationResponse,
  recordPreparedActivationResponse,
  normalizeActivationResponseProfile,
  projectActivationSessionContext,
} from "../activationHardResponseService.js";
import { readActivationDynamicTabDetail } from "../activationAwarenessService.js";
import { buildTenantGrowthDashboard } from "../tenantGrowthDashboardService.js";
import { maybeChunkToolResponseBody } from "./gptToolsRoutes.js";
import {
  REGISTRY_SPREADSHEET_ID,
  ACTIVITY_SPREADSHEET_ID,
  ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
  ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
  REGISTRY_CACHE_TTL_SECONDS,
  ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS,
  ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS,
} from "../config.js";
export function capLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export const SESSION_CONTEXT_DEFAULT_LIMIT = 10;
export const SESSION_CONTEXT_MAX_LIMIT = 50;

export function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function parseScopes(value) {
  return String(value || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function truncateText(value, maxLength = 2000) {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 15)}...[truncated]`;
}

function asBoolean(value) {
  if (value === true) return true;
  return String(value || "").trim().toLowerCase() === "true";
}

function queryStringValue(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function asCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readinessFromResult(result, active = true) {
  if (!result?.ok) return "degraded";
  return active ? "active" : "empty";
}

function splitRegistryList(value) {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonSafe(value) {
  if (!value || typeof value !== "string") return value && typeof value === "object" ? value : null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickFirstString(source, keys) {
  if (!source || typeof source !== "object") return null;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
}

export function buildEnvelopeTranscript(row = {}) {
  const request = parseJsonSafe(row.request_json);
  const userRequest = pickFirstString(request, [
    "raw_input",
    "user_input",
    "prompt",
    "message",
    "question",
    "request",
    "input"
  ]);
  const aiResponse = pickFirstString(request, [
    "ai_response",
    "assistant_response",
    "response",
    "output",
    "answer"
  ]);

  return {
    user_request: truncateText(userRequest),
    ai_response: truncateText(aiResponse),
    request_fields_available: request ? Object.keys(request).sort() : []
  };
}

function attachEnvelopeTranscript(row, options = {}) {
  const { request_json: _requestJson, ...safeRow } = row;
  const rawRequest = options.include_raw === true ? truncateText(row.request_json, options.raw_max_chars) : undefined;
  return {
    ...safeRow,
    transcript: buildEnvelopeTranscript(row),
    ...(rawRequest !== undefined ? { raw_dump: { request_json: rawRequest } } : {})
  };
}

async function safeQuery(sql, params) {
  try {
    const [rows] = await getPool().query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return {
      ok: false,
      rows: [],
      error: {
        code: err.code || "query_failed",
        message: err.message
      }
    };
  }
}

async function countQuery(surface, sql, params = [], queryFn = safeQuery) {
  const result = await queryFn(sql, params);
  const row = result.rows[0] || {};
  return {
    surface,
    result,
    count: asCount(row.count)
  };
}

export async function buildActivationPlatformAccess(req, deps = {}) {
  const queryFn = deps.query || safeQuery;
  const isAdmin = req.auth?.is_admin === true;
  const principalType = req.auth?.mode || (isAdmin ? "backend_api_key" : "unknown");

  const [
    brands,
    brandTargets,
    actions,
    runtimeActions,
    plugins,
    activePluginInventories,
    logics,
    activeLogics,
    workflowEngines,
    executionEngines
  ] = await Promise.all([
    countQuery("brands", "SELECT COUNT(*) AS count FROM `brands`", [], queryFn),
    countQuery("brand_targets", "SELECT COUNT(DISTINCT target_key) AS count FROM `brands` WHERE target_key IS NOT NULL AND TRIM(target_key) <> ''", [], queryFn),
    countQuery("actions", "SELECT COUNT(*) AS count FROM `actions`", [], queryFn),
    countQuery(
      "runtime_callable_actions",
      `SELECT COUNT(*) AS count FROM \`actions\`
       WHERE LOWER(TRIM(COALESCE(runtime_callable, ''))) IN ('1','true','yes','y','active','enabled','callable')`,
      [],
      queryFn
    ),
    countQuery("plugin_inventories", "SELECT COUNT(*) AS count FROM `plugins`", [], queryFn),
    countQuery(
      "active_plugin_inventories",
      `SELECT COUNT(*) AS count FROM \`plugins\`
       WHERE TRIM(COALESCE(active_plugins, '')) <> ''
          OR LOWER(TRIM(COALESCE(active_status, ''))) IN ('1','true','yes','y','active','enabled')`,
      [],
      queryFn
    ),
    countQuery("logic_definitions", "SELECT COUNT(*) AS count FROM `logic_definitions`", [], queryFn),
    countQuery(
      "active_logic_definitions",
      "SELECT COUNT(*) AS count FROM `logic_definitions` WHERE LOWER(TRIM(COALESCE(status, ''))) = 'active'",
      [],
      queryFn
    ),
    queryFn(
      `SELECT mapped_engines, linked_engines, engine_order
       FROM \`workflows\`
       WHERE mapped_engines IS NOT NULL OR linked_engines IS NOT NULL OR engine_order IS NOT NULL`,
      []
    ),
    queryFn(
      `SELECT used_engine_names, used_engine_registry_refs
       FROM \`execution_log\`
       WHERE used_engine_names IS NOT NULL OR used_engine_registry_refs IS NOT NULL
       ORDER BY created_at DESC LIMIT 500`,
      []
    )
  ]);

  const engineSet = new Set();
  if (workflowEngines.ok) {
    for (const row of workflowEngines.rows) {
      for (const value of [row.mapped_engines, row.linked_engines, row.engine_order]) {
        for (const engine of splitRegistryList(value)) engineSet.add(engine);
      }
    }
  }
  if (executionEngines.ok) {
    for (const row of executionEngines.rows) {
      for (const value of [row.used_engine_names, row.used_engine_registry_refs]) {
        for (const engine of splitRegistryList(value)) engineSet.add(engine);
      }
    }
  }

  const surfaces = [
    brands,
    brandTargets,
    actions,
    runtimeActions,
    plugins,
    activePluginInventories,
    logics,
    activeLogics,
    { surface: "workflow_engine_references", result: workflowEngines },
    { surface: "execution_engine_references", result: executionEngines }
  ];

  const counts = {
    brands: {
      total: brands.count,
      distinct_targets: brandTargets.count
    },
    actions: {
      total: actions.count,
      runtime_callable: runtimeActions.count
    },
    plugins: {
      inventory_rows: plugins.count,
      active_inventory_rows: activePluginInventories.count
    },
    logics: {
      total: logics.count,
      active: activeLogics.count
    },
    engines: {
      distinct_references: engineSet.size,
      sample: [...engineSet].sort().slice(0, 25)
    }
  };

  return {
    principal: {
      type: principalType,
      is_admin: isAdmin,
      user_id: req.auth?.user_id || null,
      tenant_id: req.auth?.tenant_id || null
    },
    access_scope: isAdmin ? "platform_admin_all" : "user_scoped",
    access: {
      brands: isAdmin ? "all_brands" : "tenant_or_user_scoped",
      plugins: isAdmin ? "all_plugin_inventory" : "tenant_or_user_scoped",
      logics: isAdmin ? "all_logic_definitions" : "tenant_or_user_scoped",
      engines: isAdmin ? "all_engine_references" : "tenant_or_user_scoped",
      actions: isAdmin ? "all_runtime_actions" : "tenant_or_user_scoped"
    },
    counts,
    readiness: {
      brands: readinessFromResult(brands.result, counts.brands.total > 0),
      plugins: readinessFromResult(plugins.result, counts.plugins.inventory_rows > 0),
      logics: readinessFromResult(logics.result, counts.logics.active > 0),
      engines: readinessFromResult(workflowEngines, counts.engines.distinct_references > 0),
      actions: readinessFromResult(actions.result, counts.actions.runtime_callable > 0)
    },
    degraded_surfaces: surfaces
      .filter(({ result }) => !result.ok)
      .map(({ surface, result }) => ({ surface, error: result.error }))
  };
}

function hasTruthyRuntimeFlag(value) {
  return ["1", "true", "yes", "y", "active", "enabled", "callable"].includes(String(value || "").trim().toLowerCase());
}

function compactDelimitedList(value, max = 20) {
  return splitRegistryList(value).slice(0, max);
}

function rowsOrEmpty(result) {
  return result?.ok ? result.rows : [];
}

function surfaceError(surface, result) {
  return result?.ok ? null : { surface, error: result?.error || { code: "unknown", message: "Unknown authorization surface error" } };
}

const ACTIVATION_SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const ACTIVATION_BLOCKED_COLUMN_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json)/i;

function quoteActivationIdentifier(value) {
  const text = String(value || "").trim();
  if (!ACTIVATION_SAFE_IDENTIFIER.test(text)) {
    const err = new Error(`Unsafe activation surface identifier: ${text}`);
    err.code = "unsafe_activation_surface_identifier";
    throw err;
  }
  return `\`${text}\``;
}

function safeActivationColumns(value) {
  const columns = Array.isArray(value) ? value : parseJsonSafe(value) || [];
  return columns
    .map((column) => String(column || "").trim())
    .filter((column) => ACTIVATION_SAFE_IDENTIFIER.test(column))
    .filter((column) => !ACTIVATION_BLOCKED_COLUMN_PATTERN.test(column))
    .slice(0, 40);
}

function stripSensitiveActivationFields(row = {}) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !ACTIVATION_BLOCKED_COLUMN_PATTERN.test(key))
  );
}

function normalizedActivationSet(values = []) {
  return new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

function actionPermissionCandidates(row = {}) {
  const actionKey = String(row.action_key || "").trim();
  const connectorFamily = String(row.connector_family || "").trim();
  const capabilityClass = String(row.runtime_capability_class || "").trim();
  const values = [];
  for (const value of [actionKey, connectorFamily, capabilityClass]) {
    if (!value) continue;
    values.push(value, `${value}:execute`, `${value}:read`, `${value}:write`, `${value}:*`);
  }
  if (actionKey) values.push(`action:${actionKey}`, `action:${actionKey}:execute`);
  if (connectorFamily && actionKey) values.push(`${connectorFamily}:${actionKey}`, `${connectorFamily}:${actionKey}:execute`);
  return values;
}

function isRuntimeActionAuthorizedForSubject(row = {}, context = {}) {
  if (context.isAdmin === true) return true;
  const permissionSet = normalizedActivationSet(context.permissionKeys || []);
  const connectorSet = normalizedActivationSet(context.connectorFamilies || []);
  const connectorFamily = String(row.connector_family || "").trim().toLowerCase();
  const connectorEvidenceOk = !connectorFamily || connectorSet.has(connectorFamily);
  const permissionEvidenceOk = actionPermissionCandidates(row).some((candidate) => permissionSet.has(String(candidate || "").toLowerCase()));
  return connectorEvidenceOk && permissionEvidenceOk;
}

async function loadActivationRegisteredSurfaces(req, subject, deps = {}) {
  const queryFn = deps.query || safeQuery;
  const isAdmin = subject.is_admin === true;
  const tenantId = subject.tenant_id || req.auth?.tenant_id || null;
  const userId = subject.user_id || req.auth?.user_id || null;
  const baseLimit = capLimit(req.query?.authorized_surface_limit, 10, 50);

  const registry = await queryFn(
    `SELECT surface_key, display_name, description, source_table, result_key_column, result_label_column,
            tenant_column, user_column, status_column, active_status_values_json, result_columns_json,
            include_for_admin, include_for_tenant, max_rows, sort_order, status
       FROM \`activation_authorized_surface_registry\`
      WHERE status = 'active'
        AND (? = 1 OR include_for_tenant = 1)
        AND (? = 0 OR include_for_admin = 1)
      ORDER BY sort_order ASC, surface_key ASC
      LIMIT 50`,
    [isAdmin ? 1 : 0, isAdmin ? 1 : 0]
  );

  if (!registry.ok) {
    const missing = /doesn't exist|ER_NO_SUCH_TABLE/i.test(String(registry.error?.message || ""));
    return {
      ok: missing,
      source: "activation_authorized_surface_registry",
      registered_surface_count: 0,
      surfaces: [],
      skipped: missing,
      reason: missing ? "activation_authorized_surface_registry_not_installed" : null,
      degraded_surfaces: missing ? [] : [{ surface: "activation_authorized_surface_registry", error: registry.error }],
      secrets_included: false,
    };
  }

  const surfaces = [];
  const degraded = [];

  for (const row of registry.rows || []) {
    try {
      const sourceTable = quoteActivationIdentifier(row.source_table);
      const tenantColumn = row.tenant_column ? quoteActivationIdentifier(row.tenant_column) : null;
      const userColumn = row.user_column ? quoteActivationIdentifier(row.user_column) : null;
      const statusColumn = row.status_column ? quoteActivationIdentifier(row.status_column) : null;
      const columns = safeActivationColumns(row.result_columns_json);
      if (!columns.length) {
        degraded.push({ surface: row.surface_key, error: { code: "no_safe_result_columns", message: "No safe result columns registered." } });
        continue;
      }
      if (!isAdmin && !tenantColumn && !userColumn) {
        degraded.push({ surface: row.surface_key, error: { code: "tenant_surface_requires_scope_column", message: "Tenant activation surface requires tenant_column or user_column." } });
        continue;
      }

      const selectSql = columns.map(quoteActivationIdentifier).join(", ");
      const where = [];
      const params = [];
      if (isAdmin) {
        if (tenantColumn && tenantId) {
          where.push(`${tenantColumn} = ?`);
          params.push(tenantId);
        }
        if (userColumn && userId) {
          where.push(`${userColumn} = ?`);
          params.push(userId);
        }
      } else {
        if (tenantColumn && tenantId) {
          where.push(`${tenantColumn} = ?`);
          params.push(tenantId);
        } else if (userColumn && userId) {
          where.push(`${userColumn} = ?`);
          params.push(userId);
        } else {
          where.push("1 = 0");
        }
      }

      const activeStatuses = parseJsonSafe(row.active_status_values_json) || [];
      if (statusColumn && Array.isArray(activeStatuses) && activeStatuses.length) {
        where.push(`${statusColumn} IN (?)`);
        params.push(activeStatuses.map((item) => String(item)));
      }

      const maxRows = Math.min(Math.max(Number(row.max_rows || baseLimit) || baseLimit, 1), baseLimit);
      const result = await queryFn(
        `SELECT ${selectSql}
           FROM ${sourceTable}
          WHERE ${where.length ? where.join(" AND ") : "1 = 1"}
          LIMIT ${maxRows}`,
        params
      );
      if (!result.ok) {
        degraded.push({ surface: row.surface_key, error: result.error });
        continue;
      }
      surfaces.push({
        surface_key: row.surface_key,
        display_name: row.display_name,
        source_table: row.source_table,
        row_count: result.rows.length,
        rows: result.rows.map(stripSensitiveActivationFields),
        secrets_included: false,
      });
    } catch (err) {
      degraded.push({ surface: row.surface_key, error: { code: err.code || "activation_registered_surface_failed", message: err.message } });
    }
  }

  return {
    ok: degraded.length === 0,
    source: "activation_authorized_surface_registry",
    registered_surface_count: registry.rows.length,
    surfaces,
    degraded_surfaces: degraded,
    secrets_included: false,
  };
}

export async function buildActivationAuthorizedAccess(req, subject = resolveSessionContextSubject(req), deps = {}) {
  const queryFn = deps.query || safeQuery;
  const isAdmin = subject.is_admin === true;
  const tenantId = subject.tenant_id || req.auth?.tenant_id || null;
  const userId = subject.user_id || req.auth?.user_id || null;
  const limit = capLimit(req.query?.authorized_access_limit, 25, 100);
  const tenantFilter = isAdmin ? "(? IS NULL OR tenant_id = ?)" : "tenant_id = ?";
  const tenantParams = isAdmin ? [tenantId, tenantId] : [tenantId];

  const [memberships, roles, workspaces, systems, installations, grants, runtimeActions, adminTools, registeredSurfaces] = await Promise.all([
    userId
      ? queryFn(
          `SELECT tenant_id, role, status, granted_at, updated_at
             FROM \`memberships\`
            WHERE user_id = ?
              AND (? IS NULL OR tenant_id = ?)
              AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT ${limit}`,
          [userId, tenantId, tenantId]
        )
      : { ok: true, rows: [], skipped: true, reason: "no_user_subject" },
    userId
      ? queryFn(
          `SELECT tenant_id, role, status, granted_at, expires_at
             FROM \`role_assignments\`
            WHERE user_id = ?
              AND (? IS NULL OR tenant_id = ?)
              AND status = 'active'
              AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
            ORDER BY granted_at DESC
            LIMIT ${limit}`,
          [userId, tenantId, tenantId]
        )
      : { ok: true, rows: [], skipped: true, reason: "no_user_subject" },
    queryFn(
      `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type,
              bootstrap_status, linked_brand_key, linked_system_ids, created_by, updated_at
         FROM \`workspace_registry\`
        WHERE ${tenantFilter}
          AND bootstrap_status IN ('ready','in_progress','degraded')
        ORDER BY FIELD(bootstrap_status, 'ready', 'in_progress', 'degraded'), updated_at DESC
        LIMIT ${limit}`,
      tenantParams
    ),
    queryFn(
      `SELECT system_id, tenant_id, system_key, display_name, provider_family,
              connector_family, auth_type, service_mode, status, updated_at
         FROM \`connected_systems\`
        WHERE ${tenantFilter}
          AND status <> 'archived'
        ORDER BY FIELD(status, 'active', 'pending', 'error'), updated_at DESC
        LIMIT ${limit}`,
      tenantParams
    ),
    queryFn(
      `SELECT installation_id, system_id, tenant_id, scope, status, installed_at, expires_at
         FROM \`installations\`
        WHERE ${tenantFilter}
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
        ORDER BY installed_at DESC
        LIMIT ${limit}`,
      tenantParams
    ),
    queryFn(
      `SELECT permission_key, tenant_id, installation_id, granted, granted_at
         FROM \`permission_grants\`
        WHERE ${tenantFilter}
          AND granted = 1
        ORDER BY granted_at DESC
        LIMIT ${limit * 2}`,
      tenantParams
    ),
    queryFn(
      `SELECT action_key, action_title, action_class, connector_family,
              runtime_capability_class, runtime_callable, admin_only,
              client_allowed, team_allowed, allowed_actor_roles, allowed_governance_levels
         FROM \`actions\`
        WHERE LOWER(TRIM(COALESCE(runtime_callable, ''))) IN ('1','true','yes','y','active','enabled','callable')
          AND (? = 1 OR LOWER(TRIM(COALESCE(admin_only, ''))) NOT IN ('1','true','yes','y'))
        ORDER BY action_key ASC
        LIMIT ${isAdmin ? limit : Math.min(limit * 20, 500)}`,
      [isAdmin ? 1 : 0]
    ),
    isAdmin
      ? queryFn(
          `SELECT tool_key, display_name, http_method, http_path, tags, is_enabled, sort_order
             FROM \`admin_platform_endpoint_tools\`
            WHERE is_enabled = 1
            ORDER BY sort_order ASC, tool_key ASC
            LIMIT ${limit}`,
          []
        )
      : { ok: true, rows: [], skipped: true, reason: "admin_tools_require_admin_principal" },
    loadActivationRegisteredSurfaces(req, subject, { query: queryFn })
  ]);

  const permissionKeys = [...new Set(rowsOrEmpty(grants).map((row) => row.permission_key).filter(Boolean))].sort();
  const roleKeys = [...new Set([...rowsOrEmpty(memberships), ...rowsOrEmpty(roles)].map((row) => row.role).filter(Boolean))].sort();
  const connectorFamilies = [...new Set(rowsOrEmpty(systems).map((row) => row.connector_family || row.provider_family).filter(Boolean))].sort();
  const filteredRuntimeActions = rowsOrEmpty(runtimeActions)
    .filter((row) => isRuntimeActionAuthorizedForSubject(row, { isAdmin, permissionKeys, connectorFamilies }))
    .slice(0, limit);
  const actionRows = filteredRuntimeActions.map((row) => ({
    action_key: row.action_key,
    action_title: row.action_title || null,
    action_class: row.action_class || null,
    connector_family: row.connector_family || null,
    runtime_capability_class: row.runtime_capability_class || null,
    admin_only: hasTruthyRuntimeFlag(row.admin_only),
    actor_roles: compactDelimitedList(row.allowed_actor_roles),
    governance_levels: compactDelimitedList(row.allowed_governance_levels),
  }));

  const degraded = [
    surfaceError("memberships", memberships),
    surfaceError("role_assignments", roles),
    surfaceError("workspace_registry", workspaces),
    surfaceError("connected_systems", systems),
    surfaceError("installations", installations),
    surfaceError("permission_grants", grants),
    surfaceError("actions", runtimeActions),
    surfaceError("admin_platform_endpoint_tools", adminTools),
  ].filter(Boolean);

  const authGaps = [];
  if (!isAdmin && !tenantId) authGaps.push("missing_tenant_id");
  if (!isAdmin && !userId) authGaps.push("missing_user_id");
  if (!isAdmin && rowsOrEmpty(memberships).length === 0) authGaps.push("no_active_membership_for_subject");
  if (rowsOrEmpty(systems).length === 0) authGaps.push("no_visible_connected_systems");
  if (!isAdmin && rowsOrEmpty(grants).length === 0) authGaps.push("no_active_permission_grants");

  return {
    source: "activation_dynamic_authorization_envelope",
    principal: {
      is_admin: isAdmin,
      user_id: userId,
      tenant_id: tenantId,
      auth_mode: req.auth?.mode || null,
    },
    scope_resolution: isAdmin ? "platform_admin_all_with_optional_subject_filter" : "tenant_user_authorized_only",
    counts: {
      memberships: rowsOrEmpty(memberships).length,
      roles: rowsOrEmpty(roles).length,
      workspaces: rowsOrEmpty(workspaces).length,
      connected_systems: rowsOrEmpty(systems).length,
      active_installations: rowsOrEmpty(installations).length,
      permission_grants: permissionKeys.length,
      runtime_actions: actionRows.length,
      admin_tools: rowsOrEmpty(adminTools).length,
      registered_surfaces: registeredSurfaces.surfaces?.length || 0,
    },
    authorized: {
      roles: roleKeys,
      permission_keys: permissionKeys.slice(0, 100),
      connector_families: connectorFamilies,
      workspaces: rowsOrEmpty(workspaces).map((row) => ({
        workspace_id: row.workspace_id,
        tenant_id: row.tenant_id,
        workspace_key: row.workspace_key,
        display_name: row.display_name,
        workspace_type: row.workspace_type,
        bootstrap_status: row.bootstrap_status,
        linked_brand_key: row.linked_brand_key || null,
        linked_system_ids: compactDelimitedList(row.linked_system_ids),
      })),
      connected_systems: rowsOrEmpty(systems).map((row) => ({
        system_id: row.system_id,
        tenant_id: row.tenant_id,
        system_key: row.system_key,
        display_name: row.display_name,
        provider_family: row.provider_family,
        connector_family: row.connector_family || null,
        auth_type: row.auth_type || null,
        service_mode: row.service_mode,
        status: row.status,
      })),
      installations: rowsOrEmpty(installations).map((row) => ({
        installation_id: row.installation_id,
        system_id: row.system_id,
        tenant_id: row.tenant_id,
        status: row.status,
        scopes: compactDelimitedList(row.scope, 50),
        expires_at: row.expires_at || null,
      })),
      runtime_actions: actionRows,
      admin_tools: rowsOrEmpty(adminTools).map((row) => ({
        tool_key: row.tool_key,
        display_name: row.display_name,
        http_method: row.http_method,
        http_path: row.http_path,
        tags: compactDelimitedList(row.tags),
      })),
      registered_surfaces: registeredSurfaces.surfaces || [],
    },
    activation_policy: {
      use_authorized_access_for_context_selection: true,
      do_not_infer_access_from_global_counts: true,
      do_not_return_secret_values: true,
      secrets_included: false,
    },
    readiness: degraded.length || registeredSurfaces.degraded_surfaces?.length ? "degraded" : "active",
    auth_gaps: authGaps,
    degraded_surfaces: [...degraded, ...(registeredSurfaces.degraded_surfaces || [])],
    secrets_included: false,
  };
}

export function resolveSessionContextSubject(req) {
  const requestedUserId = queryStringValue(req.query.user_id);
  const requestedTenantId = queryStringValue(req.query.tenant_id);
  const authUserId = queryStringValue(req.auth?.user_id);
  const authTenantId = queryStringValue(req.auth?.tenant_id);
  const isAdmin = req.auth?.is_admin === true;
  const userId = requestedUserId || authUserId;
  const tenantId = requestedTenantId || authTenantId;

  if (!isAdmin && requestedUserId && requestedUserId !== authUserId) {
    const err = new Error("User JWT cannot inspect another user's activation session context.");
    err.status = 403;
    err.code = "session_context_user_scope_forbidden";
    throw err;
  }

  return {
    user_id: userId || null,
    tenant_id: tenantId || null,
    is_admin: isAdmin
  };
}

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_EVOLUTION_BRAND_KEY = "growth_intelligence_platform";
const PLATFORM_EVOLUTION_TENANT_ID = "00000000-0000-4000-a000-000000000010";
const PLATFORM_EVOLUTION_SCOPE_KEY = `brand:${PLATFORM_EVOLUTION_BRAND_KEY}|tenant:${PLATFORM_EVOLUTION_TENANT_ID}`;

export function resolveRequestedEvolutionScope(query = {}, subject = {}) {
  const explicitScope = String(query.evolution_scope_key || query.scope_key || "").trim();
  if (explicitScope) return explicitScope;

  const brandKey = String(query.evolution_brand_key || query.brand_key || "").trim();
  const tenantId = String(query.evolution_tenant_id || query.tenant_id || subject.tenant_id || "").trim();
  if (brandKey && tenantId) return `brand:${brandKey}|tenant:${tenantId}`;

  if (subject.is_admin) return PLATFORM_EVOLUTION_SCOPE_KEY;
  return null;
}

async function loadPlatformEvolutionCheckpointContext(subject = {}, query = {}) {
  const requestedScopeKey = resolveRequestedEvolutionScope(query, subject);
  if (!requestedScopeKey) {
    return {
      ok: true,
      requested: false,
      available: false,
      scope_key: null,
      access_state: "not_requested",
      card: null,
      secrets_included: false,
    };
  }

  try {
    if (!subject.is_admin) {
      const access = await safeQuery(
        `SELECT scope_key, access_state
           FROM \`v_platform_evolution_scope_access\`
          WHERE scope_key = ?
            AND (? IS NULL OR tenant_id = ?)
            AND (? IS NULL OR user_id = ?)
            AND access_state = 'allowed'
          LIMIT 1`,
        [requestedScopeKey, subject.tenant_id, subject.tenant_id, subject.user_id, subject.user_id]
      );
      if (!access.ok) {
        return {
          ok: false,
          requested: true,
          available: false,
          scope_key: requestedScopeKey,
          access_state: "validation_error",
          card: null,
          error: access.error,
          secrets_included: false,
        };
      }
      if (!access.rows.length) {
        return {
          ok: true,
          requested: true,
          available: false,
          scope_key: requestedScopeKey,
          access_state: "not_granted",
          card: null,
          secrets_included: false,
        };
      }
    }

    const card = await safeQuery(
      `SELECT *
         FROM \`v_platform_evolution_activation_card\`
        WHERE scope_key = ?
        LIMIT 1`,
      [requestedScopeKey]
    );
    if (!card.ok) {
      return {
        ok: false,
        requested: true,
        available: false,
        scope_key: requestedScopeKey,
        access_state: subject.is_admin ? "admin_allowed" : "allowed",
        card: null,
        error: card.error,
        secrets_included: false,
      };
    }

    return {
      ok: true,
      requested: true,
      available: card.rows.length > 0,
      scope_key: requestedScopeKey,
      access_state: subject.is_admin ? "admin_allowed" : "allowed",
      card: card.rows[0] || null,
      source: "v_platform_evolution_activation_card",
      next_action: card.rows[0]
        ? "Use platform_evolution_thread_map and platform_evolution_open_evidence for detailed checkpoint drilldown."
        : "Create a platform_evolution checkpoint for this scope.",
      secrets_included: false,
    };
  } catch (err) {
    return {
      ok: false,
      requested: true,
      available: false,
      scope_key: requestedScopeKey,
      access_state: "error",
      card: null,
      error: { code: err.code || "platform_evolution_context_failed", message: err.message },
      secrets_included: false,
    };
  }
}

async function getPlatformPendingTaskColumnFlags() {
  const result = await safeQuery(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'platform_pending_tasks'
        AND COLUMN_NAME IN ('brief', 'activation_prompt', 'conversation_context_ref')`,
    []
  );

  if (!result.ok) {
    console.warn("[activation] failed to inspect platform_pending_tasks columns", result.error);
  }

  const columns = new Set(
    result.rows
      .map((row) => row.COLUMN_NAME || row.column_name)
      .filter(Boolean)
  );

  return {
    hasBrief: columns.has("brief"),
    hasActivationPrompt: columns.has("activation_prompt"),
    hasConversationContextRef: columns.has("conversation_context_ref")
  };
}

async function loadActivationPendingTasks(subject = {}, maxLimit = 20) {
  const limit = Math.min(Math.max(Number(maxLimit) || 20, 1), 50);
  const params = [];
  let scopeWhere = "";

  if (!subject.is_admin) {
    // Platform-scoped pending tasks are admin-only. Tenant/user/device callers
    // may only see tasks explicitly assigned to their tenant/user/device scope.
    const scopeParts = [];
    if (subject.tenant_id) {
      scopeParts.push("(owner_scope = 'tenant' AND tenant_id = ?)");
      params.push(subject.tenant_id);
    }
    if (subject.user_id) {
      scopeParts.push("(owner_scope = 'user' AND user_id = ?)");
      params.push(subject.user_id);
    }
    if (!scopeParts.length) {
      scopeParts.push("1 = 0");
    }
    scopeWhere = `AND (${scopeParts.join(" OR ")})`;
  }

  const pendingTaskColumns = await getPlatformPendingTaskColumnFlags();
  const briefSelect = pendingTaskColumns.hasBrief ? "brief" : "NULL AS brief";
  const activationPromptSelect = pendingTaskColumns.hasActivationPrompt
    ? "activation_prompt"
    : "NULL AS activation_prompt";
  const conversationContextRefSelect = pendingTaskColumns.hasConversationContextRef
    ? "conversation_context_ref"
    : "NULL AS conversation_context_ref";

  const result = await safeQuery(
    `SELECT task_id, task_key, title, description, ${briefSelect}, ${activationPromptSelect},
            task_type, priority, status, blocker_level, owner_scope,
            tenant_id, user_id, device_id, source_surface, source_ref,
            ${conversationContextRefSelect}, activation_visibility, context_json,
            due_at, completed_at, created_at, updated_at
       FROM \`platform_pending_tasks\`
      WHERE activation_visibility = 1
        AND status IN ('pending','in_progress','blocked','deferred')
        ${scopeWhere}
      ORDER BY FIELD(priority, 'critical', 'high', 'medium', 'low'),
               FIELD(status, 'blocked', 'in_progress', 'pending', 'deferred'),
               updated_at DESC
      LIMIT ${limit}`,
    params
  );

  return {
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      context_json: parseJsonSafe(row.context_json) || row.context_json || null,
      non_blocking: row.blocker_level === "none" && row.task_type !== "blocker"
    }))
  };
}

function parseConversationContextRefs(value = "") {
  const refs = [];
  const text = String(value || "");
  for (const part of text.split(/[;,\n]/)) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(?:(?<label>[a-z0-9_-]+):)?gpt_session_turns:(?<sessionId>[a-f0-9-]{36})$/i);
    if (match?.groups?.sessionId) {
      refs.push({
        label: match.groups.label || "session",
        source: "gpt_session_turns",
        session_id: match.groups.sessionId,
      });
    }
  }
  return refs;
}

function compactSummary(row = {}) {
  return {
    summary_id: row.summary_id,
    session_id: row.session_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    workspace_key: row.workspace_key,
    summary_preview: truncateText(row.summary_text, 1200),
    tags: {
      tasks_completed: truncateText(row.tasks_completed, 500),
      blockers: truncateText(row.blockers, 500),
      feature_requests: truncateText(row.feature_requests, 500),
      integration_needs: truncateText(row.integration_needs, 500),
      complexity: row.complexity || null,
    },
    turn_count: asCount(row.turn_count),
    created_at: row.created_at,
  };
}

function compactTurn(row = {}, rawMaxChars = 1200) {
  return {
    session_id: row.session_id,
    turn_id: row.turn_id,
    turn_index: asCount(row.turn_index),
    role: row.role,
    action_key: row.action_key,
    content_preview: truncateText(row.content_preview || row.content, rawMaxChars),
    content_sha256: row.content_sha256 || null,
    storage_mode: row.storage_mode || null,
    drive_doc_id: row.drive_doc_id || null,
    drive_anchor: row.drive_anchor || null,
    created_at: row.created_at,
  };
}

async function loadConversationMemoryContext(pool, subject = {}, options = {}) {
  const tenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const userId = subject.user_id || null;
  const limit = capLimit(options.limit, 10, 25);
  const includeTurns = options.include_turns === true;
  const turnsLimit = capLimit(options.turns_limit, includeTurns ? 20 : 0, 100);
  const rawMaxChars = capLimit(options.raw_max_chars, 1200, 6000);
  const pendingTasks = Array.isArray(options.pending_tasks) ? options.pending_tasks : [];
  const gptSessions = Array.isArray(options.gpt_sessions) ? options.gpt_sessions : [];
  const gptSessionIds = gptSessions.map((row) => row.session_id).filter(Boolean);

  let summaryMemory = {
    ok: false,
    count: 0,
    items: [],
    source: "session_summary_graph_memory",
    fallback_used: false,
    error: null,
    secrets_included: false,
  };
  let summaries = { ok: true, rows: [], source: "session_summary_graph_memory" };
  try {
    summaryMemory = await loadSessionSummaryGraphMemory({
      pool,
      tenant_id: tenantId,
      user_id: userId,
      limit,
    });
    summaries = {
      ok: summaryMemory.ok !== false,
      rows: (summaryMemory.items || []).map((item) => ({
        summary_id: item.summary_id,
        session_id: item.session_id,
        tenant_id: item.tenant_id,
        user_id: item.user_id,
        workspace_key: item.workspace_key,
        summary_text: item.summary_text,
        tasks_completed: JSON.stringify(item.tasks_completed || []),
        blockers: JSON.stringify(item.blockers || []),
        feature_requests: JSON.stringify(item.feature_requests || []),
        integration_needs: JSON.stringify(item.integration_needs || []),
        complexity: item.complexity || null,
        turn_count: item.turn_count || 0,
        created_at: item.created_at,
        graph_edge_id: item.graph_edge_id || null,
        graph_topology_present: item.graph_topology_present === true,
      })),
      source: "session_summary_graph_memory",
      graph_memory: summaryMemory,
    };
  } catch (err) {
    summaryMemory = {
      ok: false,
      count: 0,
      items: [],
      source: "session_summary_graph_memory",
      fallback_used: true,
      error: { code: err.code || "session_summary_graph_memory_failed", message: err.message },
      secrets_included: false,
    };
    summaries = await safeQuery(
      `SELECT summary_id, session_id, tenant_id, user_id, workspace_key, summary_text,
              tasks_completed, blockers, feature_requests, integration_needs,
              complexity, turn_count, created_at
         FROM \`session_summaries\`
        WHERE tenant_id = ?
          AND (? IS NULL OR user_id = ?)
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      [tenantId, userId, userId]
    );
    summaries.source = "session_summaries_sql_fallback";
    summaries.fallback_used = true;
    summaries.fallback_reason = summaryMemory.error;
  }

  const referencedRefs = [];
  for (const task of pendingTasks) {
    const refs = parseConversationContextRefs(task.conversation_context_ref || task.context_json?.conversation_context_ref || "");
    for (const ref of refs) {
      referencedRefs.push({
        ...ref,
        task_key: task.task_key,
        task_title: task.title,
      });
    }
  }
  const referencedSessionIds = [...new Set(referencedRefs.map((ref) => ref.session_id))];
  const allRelevantSessionIds = [...new Set([...gptSessionIds, ...referencedSessionIds])].slice(0, 50);

  const turnStats = allRelevantSessionIds.length
    ? await safeQuery(
        `SELECT COUNT(*) AS turn_count,
                COUNT(DISTINCT session_id) AS session_count,
                MAX(created_at) AS last_turn_at
           FROM \`gpt_session_turns\`
          WHERE session_id IN (?)`,
        [allRelevantSessionIds]
      )
    : { ok: true, rows: [{ turn_count: 0, session_count: 0, last_turn_at: null }] };

  const storedTurnPreviews = includeTurns && allRelevantSessionIds.length
    ? await safeQuery(
        `SELECT session_id, turn_id, turn_index, role, content, content_preview,
                content_sha256, storage_mode, action_key, drive_doc_id, drive_anchor, created_at
           FROM \`gpt_session_turns\`
          WHERE session_id IN (?)
          ORDER BY created_at DESC, turn_index DESC
          LIMIT ${turnsLimit}`,
        [allRelevantSessionIds]
      )
    : { ok: true, rows: [], skipped: true, reason: "include_turns=false" };

  const conversationRefs = allRelevantSessionIds.length
    ? await safeQuery(
        `SELECT ref_id, session_id, interface_scope, interface_display_name,
                gpt_app_id, gpt_slug, conversation_id, personal_conversation_url,
                share_id, share_url, source, captured_by, status, updated_at
           FROM \`gpt_session_conversation_refs\`
          WHERE session_id IN (?)
            AND status = 'active'
          ORDER BY updated_at DESC
          LIMIT 50`,
        [allRelevantSessionIds]
      )
    : { ok: true, rows: [], skipped: true, reason: "no_relevant_sessions" };

  let graphMemory = {
    requested: false,
    resolved: false,
    asset_count: 0,
    assets: [],
    selection_policy: {},
    reason: "not_requested",
    secrets_included: false,
  };
  try {
    graphMemory = await resolvePlatformGraphMemory({
      input: {
        request_type: "activation_session_context",
        diagnostic_surface: "conversation_memory_context",
        node_id: "platform.global",
        tenant_id: tenantId,
        user_id: userId,
        depth: 1,
        memory_limit: 5,
      },
      limit: 5,
    });
  } catch (err) {
    graphMemory = {
      requested: true,
      resolved: false,
      asset_count: 0,
      assets: [],
      error: { code: err.code || "session_context_graph_memory_failed", message: err.message },
      selection_policy: {},
      secrets_included: false,
    };
  }

  const statsRow = turnStats.rows[0] || {};
  return {
    status: {
      session_context_reachable: true,
      new_session_opened: true,
      parallel_sessions_allowed: true,
      native_chatgpt_history_available: false,
      platform_stored_sessions_available: gptSessions.length > 0,
      stored_turns_available: asCount(statsRow.turn_count) > 0,
      turn_content_loaded: includeTurns,
      summary_strategy: "prefer_graph_backed_session_summary_memory_then_sql_fallback",
      graph_assisted_lookup: Boolean(graphMemory.requested),
      graph_backed_session_summaries: summaries.source === "session_summary_graph_memory",
      session_summary_fallback_used: summaries.fallback_used === true,
      sources_checked: [
        "customer_sessions",
        "gpt_session_turns",
        "gpt_session_conversation_refs",
        "session_summaries",
        "platform_pending_tasks.conversation_context_ref",
        "platform_graph_memory",
      ],
    },
    turn_availability: {
      stored_turn_count: asCount(statsRow.turn_count),
      stored_session_count: asCount(statsRow.session_count),
      last_turn_at: statsRow.last_turn_at || null,
      include_turns: includeTurns,
      turns_limit: includeTurns ? turnsLimit : 0,
    },
    recent_session_summaries: summaries.rows.map(compactSummary),
    session_summary_memory: {
      source: summaries.source || "unknown",
      graph_backed: summaries.source === "session_summary_graph_memory",
      fallback_used: summaries.fallback_used === true,
      fallback_reason: summaries.fallback_reason || null,
      count: summaries.rows.length,
      surface_authority: summaryMemory.surface_authority || null,
      secrets_included: false,
    },
    referenced_contexts: referencedRefs.slice(0, 50),
    chatgpt_conversation_refs: {
      ok: conversationRefs.ok !== false,
      count: conversationRefs.rows.length,
      rows: conversationRefs.rows,
      note: "Personal ChatGPT conversation URLs are private to the GPT account owner; share URLs are optional shareable references.",
      secrets_included: false,
      error: conversationRefs.error || null,
    },
    stored_turn_previews: storedTurnPreviews.rows.map((row) => compactTurn(row, rawMaxChars)),
    graph_memory: {
      requested: Boolean(graphMemory.requested),
      resolved: Boolean(graphMemory.resolved),
      asset_count: Number(graphMemory.asset_count || 0),
      asset_keys: Array.isArray(graphMemory.assets) ? graphMemory.assets.map((asset) => asset.asset_key).filter(Boolean) : [],
      selection_policy: graphMemory.selection_policy || {},
      error: graphMemory.error || null,
      secrets_included: false,
    },
    degraded_surfaces: [
      ["session_summaries", summaries],
      ["gpt_session_turns", turnStats],
      ["gpt_session_turn_previews", storedTurnPreviews],
    ]
      .filter(([, result]) => !result.ok)
      .map(([surface, result]) => ({ surface, error: result.error })),
  };
}

async function autoOpenGptSession(pool, subject, options = {}) {
  const userId = subject.user_id || null;
  const tenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const closePreviousSessions = options.close_previous_sessions === true;

  const [[activeBeforeRow]] = await pool.query(
    `SELECT COUNT(*) AS active_count
       FROM \`customer_sessions\`
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (? IS NULL OR user_id = ?)
        AND session_status IN ('pending', 'active')`,
    [tenantId, userId, userId]
  );

  let closeResult = { affectedRows: 0 };
  if (closePreviousSessions) {
    [closeResult] = await pool.query(
      `UPDATE \`customer_sessions\`
       SET session_status = 'completed', ended_at = COALESCE(ended_at, NOW())
       WHERE originator = 'gpt_action'
         AND tenant_id = ?
         AND (? IS NULL OR user_id = ?)
         AND session_status IN ('pending', 'active')`,
      [tenantId, userId, userId]
    );
  }

  const sessionId = randomUUID();
  const startedAt = new Date();
  const archiveStatus = "deferred_until_first_turn";
  await pool.query(
    `INSERT INTO \`customer_sessions\`
       (session_id, tenant_id, user_id, originator, session_status, started_at, archive_status)
     VALUES (?, ?, ?, 'gpt_action', 'active', ?, ?)`,
    [sessionId, tenantId, userId, startedAt, archiveStatus]
  );

  // Do not create Drive files during activation/session-context open. The archive
  // is allocated lazily by recordGptSessionTurn() on the first real user,
  // assistant, or tool turn. This prevents repeated diagnostics or accidental
  // same-chat session-context calls from producing duplicate Google Docs by the
  // platform service account before there is transcript content to preserve.
  const activeBefore = asCount(activeBeforeRow?.active_count);
  return {
    session_id: sessionId,
    closed_sessions: closeResult.affectedRows || 0,
    archive_status: archiveStatus,
    session_management: {
      mode: "open_new_session",
      parallel_sessions_allowed: true,
      close_previous_sessions_requested: closePreviousSessions,
      active_sessions_before_open: activeBefore,
      active_sessions_after_open: closePreviousSessions ? 1 : activeBefore + 1,
      status_written: "active",
      archive_allocation: "lazy_on_first_turn",
    },
  };
}

export function shouldOpenActivationSession(query = {}) {
  return !(
    asBoolean(query.no_open_session) ||
    asBoolean(query.read_only) ||
    asBoolean(query.context_only)
  );
}

async function readOnlyGptSessionContext(pool, subject) {
  const userId = subject.user_id || null;
  const tenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const [[activeRow]] = await pool.query(
    `SELECT COUNT(*) AS active_count
       FROM \`customer_sessions\`
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (? IS NULL OR user_id = ?)
        AND session_status IN ('pending', 'active')`,
    [tenantId, userId, userId]
  );
  const [latestRows] = await pool.query(
    `SELECT session_id, archive_status
       FROM \`customer_sessions\`
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (? IS NULL OR user_id = ?)
        AND session_status IN ('pending', 'active')
      ORDER BY started_at DESC
      LIMIT 1`,
    [tenantId, userId, userId]
  );
  const latest = latestRows[0] || null;
  const activeCount = asCount(activeRow?.active_count);
  return {
    session_id: latest?.session_id || null,
    closed_sessions: 0,
    archive_status: latest?.archive_status || "not_opened",
    session_management: {
      mode: "read_only_existing_session",
      parallel_sessions_allowed: true,
      close_previous_sessions_requested: false,
      active_sessions_before_open: activeCount,
      active_sessions_after_open: activeCount,
      status_written: null,
      note: "Session Context read-only mode can inspect context without minting a fresh session id; use it before ChatGPT conversation ref capture diagnostics.",
    },
  };
}

export async function buildActivationSessionContext(req) {
  const pool = getPool();
  const subject = resolveSessionContextSubject(req);

  // Parallel conversations are the default; explicit close_previous_sessions preserves the old single-session behavior when needed.
  // Read-only callers can inspect context without minting a fresh session id, which prevents accidental ChatGPT URL ref relinking during diagnostics.
  const lifecycleOptions = {
    read_only: !shouldOpenActivationSession(req.query),
    session_policy: queryStringValue(req.query.session_policy) || (shouldOpenActivationSession(req.query) ? "reuse_or_create" : "read_only"),
    idempotency_key: queryStringValue(req.query.idempotency_key) || null,
    conversation_ref: queryStringValue(req.query.conversation_ref) || null,
    response_profile: normalizeActivationResponseProfile(req.query.response_profile),
    close_previous_sessions: asBoolean(req.query.close_previous_sessions) || asBoolean(req.query.close_previous),
    reuse_window_hours: req.query.reuse_window_hours,
  };
  const sessionOpen = await resolveActivationSessionLifecycle({
    pool,
    subject,
    options: lifecycleOptions,
    openSession: () => autoOpenGptSession(pool, subject, {
      close_previous_sessions: lifecycleOptions.close_previous_sessions,
    }),
  });
  const { session_id: newSessionId, run_id: activationRunId, closed_sessions } = sessionOpen;

  const limit = capLimit(req.query.limit, SESSION_CONTEXT_DEFAULT_LIMIT, SESSION_CONTEXT_MAX_LIMIT);
  const offset = normalizeOffset(req.query.offset);
  const includeRaw = asBoolean(req.query.include_raw);
  const rawMaxChars = capLimit(req.query.raw_max_chars, 4000, 20000);
  const conditions = [];
  const params = [];

  if (subject.user_id) {
    conditions.push("user_id = ?");
    params.push(subject.user_id);
  }
  if (subject.tenant_id) {
    conditions.push("tenant_id = ?");
    params.push(subject.tenant_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const envelopes = await safeQuery(
    `SELECT envelope_id, tenant_id, user_id, actor_type, intent_key, brand_key, target_key,
            service_mode, access_decision, decision_reason, risk_level, request_json, resolved_at, created_at
     FROM \`request_envelopes\` ${where}
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const auditConditions = [];
  const auditParams = [];
  if (subject.user_id) {
    auditConditions.push("actor_id = ?");
    auditParams.push(subject.user_id);
  }
  if (subject.tenant_id) {
    auditConditions.push("tenant_id = ?");
    auditParams.push(subject.tenant_id);
  }
  const auditWhere = auditConditions.length ? `WHERE ${auditConditions.join(" AND ")}` : "";
  const audit = await safeQuery(
    `SELECT audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
            service_mode, occurred_at
     FROM \`audit_log\` ${auditWhere}
     ORDER BY occurred_at DESC LIMIT ${limit} OFFSET ${offset}`,
    auditParams
  );

  const developerApps = await safeQuery(
    `SELECT app_id, tenant_id, app_name, app_type, scopes, status, created_by, created_at
     FROM \`developer_apps\`
     WHERE (? IS NULL OR tenant_id = ?) AND (? IS NULL OR created_by = ?)
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [subject.tenant_id, subject.tenant_id, subject.user_id, subject.user_id]
  );

  const apiCredentials = await safeQuery(
    `SELECT credential_id, app_id, tenant_id, key_prefix, label, scopes, status, expires_at, created_at
     FROM \`api_credentials\`
     WHERE (? IS NULL OR tenant_id = ?)
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [subject.tenant_id, subject.tenant_id]
  );

  const installations = await safeQuery(
    `SELECT installation_id, system_id, tenant_id, scope, status, installed_at, expires_at
     FROM \`installations\`
     WHERE (? IS NULL OR tenant_id = ?)
     ORDER BY installed_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [subject.tenant_id, subject.tenant_id]
  );

  const executionTranscript = subject.is_admin
    ? await safeQuery(
        `SELECT id, run_date, start_time, end_time, entry_type, execution_class,
                source_layer, user_input, route_keys, selected_workflows,
                execution_status, output_summary, failure_reason, created_at
         FROM \`execution_log\`
         WHERE user_input IS NOT NULL OR output_summary IS NOT NULL
         ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        []
      )
    : {
        ok: true,
        rows: [],
        skipped: true,
        reason_code: "execution_log_not_user_scoped",
        reason: "execution_log transcript is not user-scoped; user JWT callers receive request_envelope transcripts only."
      };
  const transcriptSourceStatus = executionTranscript.skipped
    ? {
        source: "execution_log",
        status: "skipped",
        tenant_safe: true,
        reason_code: executionTranscript.reason_code || "not_available",
        fallback_source: "request_envelopes"
      }
    : {
        source: "execution_log",
        status: executionTranscript.ok ? "available" : "degraded",
        tenant_safe: Boolean(subject.is_admin),
        event_count: executionTranscript.rows.length,
        reason_code: executionTranscript.ok ? null : "execution_log_query_failed"
      };

  const scopeSet = new Set();
  for (const row of [...developerApps.rows, ...apiCredentials.rows]) {
    for (const scope of parseScopes(row.scopes)) scopeSet.add(scope);
  }
  for (const row of installations.rows) {
    for (const scope of parseScopes(row.scope)) scopeSet.add(scope);
  }
  const sessionHistory = envelopes.rows.map((row) => attachEnvelopeTranscript(row, {
    include_raw: includeRaw,
    raw_max_chars: rawMaxChars
  }));

  for (const row of sessionHistory) {
    for (const key of [row.intent_key, row.brand_key, row.target_key, row.service_mode, row.risk_level]) {
      if (key) scopeSet.add(String(key));
    }
  }
  const gptSessionsTenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const includeSmokeSessions = asBoolean(req.query.include_smoke_sessions);
  const gptOriginatorWhere = includeSmokeSessions
    ? "originator IN ('gpt_action', 'gpt_action_smoke')"
    : "originator = 'gpt_action'";
  const gptSessions = await safeQuery(
    `SELECT session_id, tenant_id, user_id, session_status, turn_count,
            started_at, ended_at, drive_export_url
     FROM \`customer_sessions\`
     WHERE ${gptOriginatorWhere}
       AND tenant_id = ?
       AND (? IS NULL OR user_id = ?)
     ORDER BY started_at DESC
     LIMIT 10`,
    [gptSessionsTenantId, subject.user_id, subject.user_id]
  );

  const platformAccess = await buildActivationPlatformAccess(req);
  const authorizedAccess = await buildActivationAuthorizedAccess(req, subject);
  const pendingTasks = await loadActivationPendingTasks(subject, 25);
  const pendingTaskRows = pendingTasks.rows || [];
  const pendingTaskSummary = {
    total_visible: pendingTaskRows.length,
    blockers: pendingTaskRows.filter((task) => task.blocker_level !== "none" || task.task_type === "blocker").length,
    non_blocking: pendingTaskRows.filter((task) => task.blocker_level === "none" && task.task_type !== "blocker").length,
    by_status: pendingTaskRows.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {}),
    by_type: pendingTaskRows.reduce((acc, task) => {
      acc[task.task_type] = (acc[task.task_type] || 0) + 1;
      return acc;
    }, {})
  };

  const conversationMemory = await loadConversationMemoryContext(pool, subject, {
    limit,
    include_turns: asBoolean(req.query.include_turns),
    turns_limit: capLimit(req.query.turns_limit, 20, 100),
    raw_max_chars: rawMaxChars,
    gpt_sessions: gptSessions.rows,
    pending_tasks: pendingTaskRows,
  });

  const platformEvolution = await loadPlatformEvolutionCheckpointContext(subject, req.query || {});

  return {
    session_id: newSessionId,
    run_id: activationRunId || sessionOpen.run_id || null,
    idempotency_key: sessionOpen.idempotency_key || null,
    session_policy: sessionOpen.session_policy || lifecycleOptions.session_policy,
    session_reused: sessionOpen.reused === true,
    closed_sessions,
    session_management: sessionOpen.session_management,
    subject,
    pagination: {
      limit,
      offset,
      include_raw: includeRaw,
      raw_max_chars: includeRaw ? rawMaxChars : undefined,
      has_more_session_history: sessionHistory.length === limit
    },
    last_session: sessionHistory[0] || null,
    session_history: sessionHistory,
    related_scopes: [...scopeSet].sort(),
    history: {
      session_envelopes_count: sessionHistory.length,
      audit_events: audit.rows,
      transcript_events: executionTranscript.rows.map((row) => ({
        id: row.id,
        run_date: row.run_date,
        start_time: row.start_time,
        end_time: row.end_time,
        entry_type: row.entry_type,
        execution_class: row.execution_class,
        source_layer: row.source_layer,
        route_keys: row.route_keys,
        selected_workflows: row.selected_workflows,
        execution_status: row.execution_status,
        failure_reason: truncateText(row.failure_reason),
        created_at: row.created_at,
        transcript: {
          user_request: truncateText(row.user_input),
          ai_response: truncateText(row.output_summary)
        },
        ...(includeRaw && subject.is_admin ? {
          raw_dump: {
            user_input: truncateText(row.user_input, rawMaxChars),
            output_summary: truncateText(row.output_summary, rawMaxChars)
          }
        } : {})
      })),
      transcript_source_status: transcriptSourceStatus,
      developer_apps: developerApps.rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) })),
      api_credentials: apiCredentials.rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) })),
      installations: installations.rows.map((row) => ({ ...row, scope: parseScopes(row.scope) }))
    },
    gpt_sessions: gptSessions.rows,
    turn_capture_policy: {
      status: "required_for_full_transcript",
      write_tool: "gpt_session_turns_write_batch",
      write_path: `/gpt/sessions/${newSessionId}/turns`,
      intended_use: "After each conversational exchange, write the user prompt and assistant reply together so Drive archives contain non-tool transcript turns.",
      sql_content_mode: "preview_hash_only",
      full_content_storage: "drive_doc_and_jsonl",
      current_session_id: newSessionId,
      secrets_included: false,
    },
    conversation_ref_capture_policy: {
      status: "required_when_chatgpt_url_available",
      source_of_truth: "activation_session_context.current_session_id",
      current_session_id: newSessionId,
      primary_tool: "gpt_session_conversation_ref_mark_primary",
      capture_current_tool: "gpt_session_conversation_ref_capture_current",
      upsert_tool: "gpt_session_conversation_ref_upsert",
      primary_path: `/gpt/sessions/${newSessionId}/conversation-ref/mark-primary`,
      capture_current_path: `/gpt/sessions/${newSessionId}/conversation-ref/capture-current`,
      supported_sources: ["manual_user_supplied", "browser_connector", "browser_extension"],
      intended_use: "When a personal ChatGPT conversation URL or share URL is available, attach it to current_session_id and mark it primary; never infer the session from recency, tenant/admin status, or tool activity.",
      accepted_url_kinds: ["personal_conversation_url", "share_url"],
      supported_interfaces: ["admin_custom_gpt", "tenant_custom_gpt"],
      personal_urls_are_owner_private: true,
      supersede_policy: "Older refs for the same ChatGPT conversation/share id are retained and marked superseded_by_ref_id.",
      secrets_included: false,
    },
    conversation_memory: conversationMemory,
    platform_access: platformAccess,
    authorized_access: authorizedAccess,
    platform_evolution: platformEvolution,
    pending_tasks: {
      summary: pendingTaskSummary,
      items: pendingTaskRows
    },
    degraded_surfaces: [
      ["request_envelopes", envelopes],
      ["audit_log", audit],
      ["developer_apps", developerApps],
      ["api_credentials", apiCredentials],
      ["installations", installations],
      ["execution_log", executionTranscript],
      ["gpt_sessions", gptSessions],
      ["pending_tasks", pendingTasks],
      ["conversation_memory", { ok: conversationMemory.degraded_surfaces.length === 0, error: { code: "conversation_memory_degraded", details: conversationMemory.degraded_surfaces } }],
      ["platform_access", { ok: platformAccess.degraded_surfaces.length === 0, error: { code: "platform_access_degraded", details: platformAccess.degraded_surfaces } }],
      ["platform_evolution", { ok: platformEvolution.ok !== false, error: platformEvolution.error || { code: "platform_evolution_degraded" } }]
    ]
      .filter(([, result]) => !result.ok)
      .map(([surface, result]) => ({ surface, error: result.error }))
  };
}

export function buildActivationRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.get("/activation/env-bootstrap", requireBackendApiKey, async (_req, res) => {
    const githubAppPrivateKeyConfigured = Boolean(process.env.GITHUB_APP_PRIVATE_KEY);
    const githubAppConfigured = Boolean(
      process.env.GITHUB_APP_INSTALLATION_ID &&
      process.env.GITHUB_APP_ID &&
      githubAppPrivateKeyConfigured
    );
    const githubPatConfigured = Boolean(process.env.GITHUB_TOKEN);

    return res.status(200).json({
      ok: true,
      activation_layer: "env_bootstrap",
      source: "cloud_run_env",
      sheets_required: false,
      bootstrap_authority: "backend_runtime",
      bootstrap: {
        registry_spreadsheet_id: REGISTRY_SPREADSHEET_ID,
        activity_spreadsheet_id: ACTIVITY_SPREADSHEET_ID,
        activation_google_workspace_probe_spreadsheet_id: ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
        legacy_activation_bootstrap_spreadsheet_id_alias: ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
        activation_bootstrap_authority: "db_runtime",
        activation_bootstrap_config_sheet: ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
        activation_bootstrap_config_range: ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
      },
      cache_policy: {
        registry_cache_ttl_seconds: REGISTRY_CACHE_TTL_SECONDS,
        activation_workbook_cache_ttl_seconds: ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS,
        activation_bootstrap_row_cache_ttl_seconds: ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS,
      },
      env_presence: {
        google_auth_mode: process.env.GOOGLE_AUTH_MODE || "default",
        google_application_credentials_configured: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
        google_sa_json_configured: Boolean(process.env.GOOGLE_SA_JSON),
        google_refresh_token_configured: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
        github_auth_configured: githubAppConfigured || githubPatConfigured,
        github_auth_mode: githubAppConfigured ? "github_app" : (githubPatConfigured ? "pat" : "unconfigured"),
        github_app_configured: githubAppConfigured,
        github_app_installation_id_configured: Boolean(process.env.GITHUB_APP_INSTALLATION_ID),
        github_app_id_configured: Boolean(process.env.GITHUB_APP_ID),
        github_app_private_key_configured: Boolean(process.env.GITHUB_APP_PRIVATE_KEY),
        github_token_configured: githubPatConfigured,
        activation_github_repository_configured: Boolean(process.env.ACTIVATION_GITHUB_REPOSITORY),
        activation_github_owner_configured: Boolean(process.env.ACTIVATION_GITHUB_OWNER),
        activation_github_repo_configured: Boolean(process.env.ACTIVATION_GITHUB_REPO),
        activation_github_branch_configured: Boolean(process.env.ACTIVATION_GITHUB_BRANCH),
        cloudflare_account_id_configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
        cloudflare_api_token_configured: Boolean(process.env.CLOUDFLARE_API_TOKEN),
        hostinger_cloud_plan_key_configured: Boolean(process.env.HOSTINGER_CLOUD_PLAN_01_API_KEY),
        connector_local_api_key_configured: Boolean(process.env.CONNECTOR_LOCAL_API_KEY),
      },
      note: "Sheets readback is no longer required. Use GET /activation/bootstrap-config for the authoritative runtime bootstrap row.",
    });
  });

  router.get("/activation/bootstrap-config", requireBackendApiKey, async (req, res) => {
    try {
      const pool = getPool();
      const activationBootstrap = await resolveActivationBootstrapConfig();

      // Pull live platform state from DB
      const [[platform]] = await pool.query(
        `SELECT
           COUNT(DISTINCT t.tenant_id)                           AS tenant_count,
           COUNT(DISTINCT m.id)                                  AS membership_count,
           COUNT(DISTINCT tbc.connection_id)                     AS connection_count,
           SUM(CASE WHEN tbc.status = 'active' THEN 1 ELSE 0 END) AS active_connections,
           MAX(tbc.activated_at)                                 AS last_activation_at
         FROM tenants t
         LEFT JOIN memberships m ON CAST(m.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(t.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci
         LEFT JOIN tenant_backend_connections tbc ON CAST(tbc.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(t.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci`
      );

      const [[deviceRow]] = await pool.query(
        `SELECT COUNT(*) AS device_count,
                SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) AS enabled_devices
         FROM local_connector_user_configs`
      );

      const bootstrapRow = {
        system_name:        "MAD4B Growth Intelligence Platform",
        api_base_url:       process.env.API_BASE_URL || "https://auth.mad4b.com",
        environment:        process.env.NODE_ENV || "production",
        registry_sheet_id:  REGISTRY_SPREADSHEET_ID || null,
        activity_sheet_id:  ACTIVITY_SPREADSHEET_ID || null,
        github_repo:        activationBootstrap.ok
          ? `${activationBootstrap.config.github_owner}/${activationBootstrap.config.github_repo}`
          : (process.env.ACTIVATION_GITHUB_REPOSITORY || process.env.ACTIVATION_GITHUB_REPO || null),
        cloudflare_zone:    process.env.CLOUDFLARE_ZONE_ID || null,
        connector_url:      process.env.CONNECTOR_URL || "https://connector.mad4b.com",
        bootstrap_version:  process.env.SERVICE_VERSION || "backend_runtime",
        activated_at:       platform?.last_activation_at || null,
      };

      return res.status(200).json({
        ok: true,
        activation_layer: "bootstrap_config",
        source: "backend_runtime",
        sheets_required: false,
        bootstrap_row: bootstrapRow,
        activation_bootstrap: activationBootstrap.ok
          ? {
              ok: true,
              source: activationBootstrap.source,
              sheets_required: false,
              github_parent_action_key: activationBootstrap.config.github_parent_action_key,
              github_endpoint_key: activationBootstrap.config.github_endpoint_key,
              github_owner: activationBootstrap.config.github_owner,
              github_repo: activationBootstrap.config.github_repo,
              github_branch: activationBootstrap.config.github_branch,
            }
          : {
              ok: false,
              source: "unresolved",
              error: activationBootstrap.error,
              db_error: activationBootstrap.db_error,
              env_error: activationBootstrap.env_error,
            },
        platform_state: {
          tenant_count:       Number(platform?.tenant_count || 0),
          membership_count:   Number(platform?.membership_count || 0),
          connection_count:   Number(platform?.connection_count || 0),
          active_connections: Number(platform?.active_connections || 0),
          device_count:       Number(deviceRow?.device_count || 0),
          enabled_devices:    Number(deviceRow?.enabled_devices || 0),
          last_activation_at: platform?.last_activation_at || null,
        },
        note: "Authoritative backend runtime bootstrap. GitHub activation binding resolves from DB runtime config first, then server env fallback. Sheets readback is diagnostic only.",
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "bootstrap_config_failed", message: err.message },
      });
    }
  });

  router.post("/activation/hard-run/legacy-full", requireBackendApiKey, async (req, res) => {
    let sessionContext = null;
    let providerBootstrap = null;
    try {
      const sessionReq = {
        ...req,
        query: {
          ...(req.query || {}),
          ...(req.body?.tenant_id ? { tenant_id: req.body.tenant_id } : {}),
          ...(req.body?.user_id ? { user_id: req.body.user_id } : {}),
          ...(req.body?.limit ? { limit: req.body.limit } : {}),
          ...(req.body?.include_raw !== undefined ? { include_raw: req.body.include_raw } : {}),
          ...(req.body?.close_previous_sessions !== undefined ? { close_previous_sessions: req.body.close_previous_sessions } : {}),
        },
      };
      const context = await buildActivationSessionContext(sessionReq);
      sessionContext = { ok: true, activation_layer: "session_context", ...context };
    } catch (err) {
      sessionContext = { ok: false, activation_layer: "session_context", error: { code: err.code || "session_context_failed", message: err.message } };
    }

    try {
      const internalBase = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
      const response = await fetch(`${internalBase}/admin/system/tools/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: process.env.BACKEND_API_KEY ? `Bearer ${process.env.BACKEND_API_KEY}` : (req.headers.authorization || ""),
        },
        body: JSON.stringify({ name: "activation_provider_bootstrap_validate", arguments: req.body?.provider_arguments || {} }),
        signal: AbortSignal.timeout(300000),
      });
      const payload = await response.json().catch(() => ({}));
      providerBootstrap = payload?.result || payload;
      if (payload?.ok === false && providerBootstrap?.ok !== false) {
        providerBootstrap = { ok: false, activation_layer: "provider_bootstrap_system_tool", error: payload.error };
      }
    } catch (err) {
      providerBootstrap = { ok: false, activation_layer: "provider_bootstrap_system_tool", error: { code: err.code || "provider_bootstrap_failed", message: err.message } };
    }

    const hard = buildHardActivationEvidenceMatrix({
      sessionContext,
      providerBootstrap,
      repoCanonicals: await buildRepoCanonicalRuntimeEvidence(),
      toolCatalog: buildDynamicToolCatalogEvidence({ platformAccess: sessionContext?.platform_access || null, authorizedAccess: sessionContext?.authorized_access || null }),
    });

    return res.status(hard.activation_complete ? 200 : 424).json({
      ok: hard.activation_complete,
      activation_layer: "hard_activation_orchestrator",
      activation_complete: hard.activation_complete,
      runtime_classification: {
        activation_status: hard.activation_status,
        status_authority: hard.status_authority,
        reason_code: hard.reason_code,
      },
      evidence_matrix: hard.evidence_matrix,
      dynamic_tabs: await buildActivationDynamicTabsEvidence({ sessionContext }), operational_intelligence: await buildActivationOperationalIntelligenceEvidence({ sessionContext }), operational_dashboard: await buildActivationOperationalDashboardEvidence({ sessionContext }), session_context_evidence: hard.evidence_matrix.session_context,
      provider_bootstrap_evidence: hard.evidence_matrix.provider_bootstrap,
      provider_bootstrap: providerBootstrap,
      degraded_surfaces: hard.degraded_surfaces,
      report_policy: {
        may_report_session_context_loaded: hard.evidence_matrix.session_context.ok === true,
        may_report_activation_complete: hard.activation_complete === true,
        session_context_claim_requires: "getActivationSessionContext evidence with activation_layer=session_context and session_id",
      },
      secrets_included: false,
    });
  });

  router.get("/activation/session-context/read-only", requireBackendApiKey, async (req, res) => {
    try {
      const context = await buildActivationSessionContext({
        ...req,
        query: {
          ...req.query,
          read_only: "true",
        },
      });
      return res.status(200).json({
        ok: true,
        activation_layer: "session_context",
        read_only: true,
        ...context
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "activation_session_context_read_only_failed",
          message: err.message
        }
      });
    }
  });

  router.get("/activation/session-context", requireBackendApiKey, async (req, res) => {
    try {
      const context = await buildActivationSessionContext(req);
      return res.status(200).json({
        ok: true,
        activation_layer: "session_context",
        ...context
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "activation_session_context_failed",
          message: err.message
        }
      });
    }
  });

  router.get("/activation/platform-access", requireBackendApiKey, async (req, res) => {
    try {
      const access = await buildActivationPlatformAccess(req);
      return res.status(200).json({
        ok: true,
        activation_layer: "platform_access",
        ...access
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "activation_platform_access_failed",
          message: err.message
        }
      });
    }
  });

  return router;
}
