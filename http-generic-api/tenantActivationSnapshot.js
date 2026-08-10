import { getPool } from "./db.js";

const IDENTIFIER = /^[A-Za-z0-9_]+$/;
export const CORE_TENANT_METRICS = Object.freeze([
  "active_memberships",
  "devices_registered",
  "connected_apps",
  "user_connections",
  "resource_grants_active",
  "skills_available",
]);

function sqlIdentifier(value) {
  const name = String(value || "").trim();
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `\`${name}\``;
}

export function metricResult({ key, value = null, state, table = null, scope = null, warning = null, error = null }) {
  return {
    key,
    value: state === "available" ? Number(value || 0) : null,
    state,
    source_table: table,
    scope,
    warning,
    error_code: error,
  };
}

async function tableShape(pool, table) {
  const [rows] = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return {
    exists: Array.isArray(rows) && rows.length > 0,
    columns: new Set((rows || []).map((row) => String(row.column_name || "").toLowerCase())),
  };
}

function statusFilter(values = ["active"], column = "status", negate = false) {
  return ({ columns, clauses, params, warnings }) => {
    if (!columns.has(column)) {
      warnings.push(`${column}_filter_column_missing`);
      return;
    }
    clauses.push(`LOWER(COALESCE(${sqlIdentifier(column)}, '')) ${negate ? "NOT " : ""}IN (${values.map(() => "?").join(",")})`);
    params.push(...values.map((value) => String(value).toLowerCase()));
  };
}

function booleanFilter(column = "is_enabled") {
  return ({ columns, clauses, warnings }) => {
    if (columns.has(column)) clauses.push(`${sqlIdentifier(column)} = 1`);
    else warnings.push(`${column}_filter_column_missing`);
  };
}

const METRICS = Object.freeze([
  { key: "active_memberships", table: "memberships", userScoped: true, configure: statusFilter() },
  { key: "devices_registered", table: "local_connector_user_configs", userScoped: true },
  { key: "devices_active", table: "local_connector_user_configs", userScoped: true, configure: booleanFilter() },
  { key: "connected_apps", table: "connected_systems" },
  { key: "connected_apps_active", table: "connected_systems", configure: statusFilter() },
  { key: "user_connections", table: "user_app_connections", userScoped: true },
  { key: "user_connections_active", table: "user_app_connections", userScoped: true, configure: statusFilter() },
  {
    key: "user_connections_validated",
    table: "user_app_connections",
    userScoped: true,
    configure: ({ columns, clauses, params, warnings }) => {
      statusFilter()({ columns, clauses, params, warnings });
      statusFilter(["valid", "validated", "passed", "healthy", "active"], "validation_status")({ columns, clauses, params, warnings });
    },
  },
  { key: "integration_policies", table: "tenant_integration_policies" },
  { key: "integration_policies_active", table: "tenant_integration_policies", configure: statusFilter() },
  { key: "resource_grants", table: "workspace_resource_grants", userScoped: true, userColumns: ["grantee_user_id"] },
  { key: "resource_grants_active", table: "workspace_resource_grants", userScoped: true, userColumns: ["grantee_user_id"], configure: statusFilter() },
  { key: "workspace_assets", table: "workspace_assets", configure: statusFilter(["deleted"], "lifecycle_status", true) },
  { key: "workspace_vaults", table: "workspace_vaults" },
  { key: "workspace_vaults_active", table: "workspace_vaults", configure: statusFilter() },
  { key: "cms_sites_accessible", table: "cms_site_access_grants", userScoped: true, distinct: "site_id", configure: statusFilter() },
  { key: "sessions_active", table: "customer_sessions", userScoped: true, configure: statusFilter(["completed", "closed"], "session_status", true) },
  { key: "pending_tasks_open", table: "platform_pending_tasks", scopeMode: "activation_pending_tasks", configure: statusFilter(["pending", "in_progress", "blocked"]) },
  { key: "pending_tasks_blocked", table: "platform_pending_tasks", scopeMode: "activation_pending_tasks", configure: statusFilter(["blocked"]) },
  { key: "execution_plans", table: "execution_plans" },
  { key: "execution_plans_actionable", table: "execution_plans", configure: statusFilter(["validated", "approved", "in_progress", "running"], "plan_status") },
  { key: "workflow_runs", table: "workflow_runs" },
  { key: "workflow_runs_active", table: "workflow_runs", configure: statusFilter(["pending", "queued", "running", "in_progress"]) },
  { key: "output_artifacts", table: "output_artifacts" },
  { key: "approval_holds_pending", table: "approval_holds", configure: statusFilter(["pending", "requested", "waiting", "open"]) },
  { key: "support_tickets_open", table: "tickets", userScoped: true, configure: statusFilter(["closed", "completed", "resolved", "cancelled", "canceled"], "status", true) },
  { key: "skill_grants_active", table: "agent_skill_grants", includeGlobal: true, configure: statusFilter() },
  { key: "skills_available", table: "agent_skill_grants", includeGlobal: true, distinct: "skill_id", configure: statusFilter() },
  { key: "agents_with_skills", table: "agent_skill_grants", includeGlobal: true, distinct: "agent_id", configure: statusFilter() },
]);

function applyActivationPendingTaskScope({ definition, context, shape, clauses, params, warnings }) {
  const { key, table } = definition;
  if (!context.tenantId || !shape.columns.has("tenant_id")) {
    return metricResult({ key, state: "unscoped", table, scope: "tenant_required", warning: "tenant_scope_required" });
  }

  clauses.push("tenant_id = ?");
  params.push(context.tenantId);
  let scope = "tenant_activation";

  if (shape.columns.has("activation_visibility")) {
    clauses.push("activation_visibility = 1");
  } else {
    warnings.push("activation_visibility_filter_column_missing");
  }

  const ownerVisible = context.profile === "admin"
    || ["owner", "admin"].includes(String(context.role || "").toLowerCase());
  if (shape.columns.has("owner_scope")) {
    if (ownerVisible) {
      clauses.push("LOWER(COALESCE(owner_scope, '')) IN ('tenant','user')");
      scope = "tenant_owner_visible";
    } else if (context.userId && shape.columns.has("user_id")) {
      clauses.push("(LOWER(COALESCE(owner_scope, '')) = 'tenant' OR (LOWER(COALESCE(owner_scope, '')) = 'user' AND user_id = ?))");
      params.push(context.userId);
      scope = "tenant_user_visible";
    } else {
      clauses.push("LOWER(COALESCE(owner_scope, '')) = 'tenant'");
      scope = "tenant_visible";
    }
  } else {
    warnings.push("owner_scope_filter_column_missing");
  }

  return { scope };
}

async function countMetric(pool, definition, context) {
  const { key, table } = definition;
  let shape;
  try {
    shape = await tableShape(pool, table);
  } catch (error) {
    return metricResult({ key, state: "failed", table, scope: "metadata_lookup", error: error?.code || "table_shape_failed" });
  }
  if (!shape.exists) return metricResult({ key, state: "unavailable", table, scope: "table_missing", warning: "source_table_missing" });

  const clauses = [];
  const params = [];
  const warnings = [];
  let scope = null;

  if (definition.scopeMode === "activation_pending_tasks") {
    const pendingScope = applyActivationPendingTaskScope({ definition, context, shape, clauses, params, warnings });
    if (pendingScope?.state) return pendingScope;
    scope = pendingScope.scope;
  } else if (context.tenantId && shape.columns.has("tenant_id")) {
    clauses.push(definition.includeGlobal ? "(tenant_id = ? OR tenant_id IS NULL)" : "tenant_id = ?");
    params.push(context.tenantId);
    scope = definition.includeGlobal ? "tenant_plus_global" : "tenant";
    if (definition.userScoped && context.userId) {
      const userColumn = [...(definition.userColumns || []), "user_id"].find((column) => shape.columns.has(column));
      if (userColumn) {
        clauses.push(`${sqlIdentifier(userColumn)} = ?`);
        params.push(context.userId);
        scope = "tenant_user";
      } else if (!(context.profile === "admin" || ["owner", "admin"].includes(String(context.role || "").toLowerCase()))) {
        return metricResult({ key, state: "unscoped", table, scope: "tenant_user_column_missing", warning: "tenant_wide_count_forbidden_for_non_owner" });
      }
    }
  } else if (context.userId && shape.columns.has("user_id")) {
    clauses.push("user_id = ?");
    params.push(context.userId);
    scope = "user";
  } else {
    return metricResult({ key, state: "unscoped", table, scope: "scope_column_missing", warning: "global_count_forbidden" });
  }

  if (typeof definition.configure === "function") definition.configure({ columns: shape.columns, clauses, params, warnings });
  const countExpression = definition.distinct && shape.columns.has(String(definition.distinct).toLowerCase())
    ? `COUNT(DISTINCT ${sqlIdentifier(definition.distinct)})`
    : "COUNT(*)";
  try {
    const [rows] = await pool.query(
      `SELECT ${countExpression} AS count FROM ${sqlIdentifier(table)} WHERE ${clauses.join(" AND ")}`,
      params
    );
    return metricResult({ key, value: rows?.[0]?.count || 0, state: "available", table, scope, warning: warnings.length ? warnings.join("|") : null });
  } catch (error) {
    return metricResult({ key, state: "failed", table, scope, error: error?.code || "metric_query_failed" });
  }
}

function brandKeys(value) {
  const raw = String(value || "").trim();
  return [...new Set([raw, raw.replace(/^brand:/i, "").trim()].filter(Boolean))];
}

async function managedBrands(pool, { profile, tenantId, userId, role }) {
  if (!tenantId) return { metric: metricResult({ key: "brands_visible", state: "unscoped", table: "v_workspace_resource_grant_effective", scope: "tenant_required" }), items: [] };
  const shape = await tableShape(pool, "v_workspace_resource_grant_effective");
  if (!shape.exists) return { metric: metricResult({ key: "brands_visible", state: "unavailable", table: "v_workspace_resource_grant_effective", scope: "table_missing" }), items: [] };

  const ownerScope = profile === "admin" || ["owner", "admin"].includes(String(role || "").toLowerCase());
  const params = [tenantId];
  const userClause = !ownerScope && userId ? "AND grantee_user_id = ?" : "";
  if (userClause) params.push(userId);
  try {
    const [grants] = await pool.query(
      `SELECT grant_id, grantee_user_id, resource_ref, permission, source, granted_at, expires_at
         FROM v_workspace_resource_grant_effective
        WHERE tenant_id = ? AND resource_type = 'brand' ${userClause}
        ORDER BY resource_ref LIMIT 200`,
      params
    );
    const lookup = [...new Set((grants || []).flatMap((row) => brandKeys(row.resource_ref)))];
    let brandRows = [];
    if (lookup.length && (await tableShape(pool, "brands")).exists) {
      [brandRows] = await pool.query(
        `SELECT brand_name, normalized_brand_name, brand_domain, target_key, base_url, status, brand_core_ready
           FROM brands
          WHERE target_key IN (?) OR normalized_brand_name IN (?) OR brand_name IN (?) LIMIT 200`,
        [lookup, lookup, lookup]
      );
    }
    const map = new Map();
    for (const row of brandRows || []) {
      for (const key of [row.target_key, row.normalized_brand_name, row.brand_name].flatMap(brandKeys)) map.set(key.toLowerCase(), row);
    }
    const items = (grants || []).map((grant) => {
      const meta = brandKeys(grant.resource_ref).map((key) => map.get(key.toLowerCase())).find(Boolean) || null;
      return {
        brand_ref: grant.resource_ref,
        display_name: meta?.brand_name || brandKeys(grant.resource_ref).at(-1) || grant.resource_ref,
        target_key: meta?.target_key || null,
        brand_domain: meta?.brand_domain || null,
        base_url: meta?.base_url || null,
        status: meta?.status || null,
        brand_core_ready: meta?.brand_core_ready || null,
        permission: grant.permission,
        permission_source: grant.source || "workspace_resource_grant",
        grantee_scope: grant.grantee_user_id === userId ? "self" : "workspace",
        granted_at: grant.granted_at,
        expires_at: grant.expires_at,
      };
    });
    return { metric: metricResult({ key: "brands_visible", value: items.length, state: "available", table: "v_workspace_resource_grant_effective", scope: ownerScope ? "tenant_owner_visible" : "tenant_user" }), items };
  } catch (error) {
    return { metric: metricResult({ key: "brands_visible", state: "failed", table: "v_workspace_resource_grant_effective", scope: "tenant", error: error?.code || "brand_snapshot_failed" }), items: [] };
  }
}

function coreReady(value) {
  return [true, 1, "1", "true", "ready"].includes(typeof value === "string" ? value.toLowerCase() : value);
}

export async function buildTenantActivationSnapshot({ profile = "tenant", tenantId = null, userId = null, role = null, pool = getPool() } = {}) {
  const context = { profile, tenantId, userId, role };
  const entries = await Promise.all(METRICS.map((definition) => countMetric(pool, definition, context)));
  const metrics = Object.fromEntries(entries.map((metric) => [metric.key, metric]));
  metrics.current_workspace = tenantId
    ? metricResult({ key: "current_workspace", value: 1, state: "available", table: "tenants", scope: "tenant" })
    : metricResult({ key: "current_workspace", state: "unscoped", table: "tenants", scope: "tenant_required" });

  const brandSnapshot = await managedBrands(pool, context);
  metrics.brands_visible = brandSnapshot.metric;
  const items = brandSnapshot.items;
  const derivedBrandMetric = (key, value, table) => metricResult({ key, value, state: brandSnapshot.metric.state, table, scope: brandSnapshot.metric.scope, error: brandSnapshot.metric.error_code });
  metrics.brands_active = derivedBrandMetric("brands_active", items.filter((item) => String(item.status || "active").toLowerCase().includes("active")).length, "brands");
  metrics.brands_manageable = derivedBrandMetric("brands_manageable", items.filter((item) => ["owner", "admin", "manage"].includes(String(item.permission || "").toLowerCase())).length, "v_workspace_resource_grant_effective");
  metrics.brands_brand_core_ready = derivedBrandMetric("brands_brand_core_ready", items.filter((item) => coreReady(item.brand_core_ready)).length, "brands");

  const counts = Object.fromEntries(Object.entries(metrics).map(([key, metric]) => [key, metric.value]));
  counts.workspaces_or_tenants = metrics.current_workspace.value;
  counts.brands_total = metrics.brands_visible.value;

  const coreStates = Object.fromEntries(CORE_TENANT_METRICS.map((key) => [key, metrics[key]?.state || "missing"]));
  const unavailableCore = Object.entries(coreStates).filter(([, state]) => state !== "available").map(([key]) => key);
  return {
    ok: unavailableCore.length === 0,
    status: unavailableCore.length === 0 ? "ready" : "degraded_data",
    scope: { profile, tenant_id: tenantId, user_id: userId, role },
    counts,
    metrics,
    managed_brands: items,
    data_quality: {
      core_metric_states: coreStates,
      available_metric_count: Object.values(metrics).filter((metric) => metric.state === "available").length,
      total_metric_count: Object.keys(metrics).length,
      unavailable_core_metrics: unavailableCore,
      failed_metrics: Object.entries(metrics).filter(([, metric]) => metric.state === "failed").map(([key]) => key),
      false_zero_prevention: true,
      unavailable_values_are_null: true,
    },
    observed_at: new Date().toISOString(),
    secrets_included: false,
  };
}

export const _testingTenantActivationSnapshot = {
  METRICS,
  countMetric,
  applyActivationPendingTaskScope,
};
