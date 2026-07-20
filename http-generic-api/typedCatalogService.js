import { listOperationContracts } from "./operationContractRegistry.js";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const MAX_LIMIT = 100;

function catalogError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function compact(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function positiveInt(value, fallback, max = MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function principalScope(auth = {}) {
  const mode = compact(auth.mode || auth.caller_type, 64).toLowerCase();
  if (auth.is_admin === true || ADMIN_MODES.has(mode)) return "admin";
  if (mode === "user_jwt" && auth.tenant_id && auth.user_id) return "tenant";
  throw catalogError(403, "CATALOG_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function encodeCursor(catalogKey, value) {
  return Buffer.from(JSON.stringify({ v: 1, catalog_key: catalogKey, after: String(value ?? "") }), "utf8")
    .toString("base64url");
}

function decodeCursor(catalogKey, value) {
  const cursor = compact(value, 1000);
  if (!cursor) return "";
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed?.v !== 1 || parsed?.catalog_key !== catalogKey || typeof parsed?.after !== "string") {
      throw new Error("invalid");
    }
    return parsed.after;
  } catch {
    throw catalogError(400, "CATALOG_CURSOR_INVALID", "The catalog cursor is invalid.", { catalog_key: catalogKey });
  }
}

function yes(value) {
  return ["true", "1", "yes", "active", "enabled"].includes(compact(value, 32).toLowerCase());
}

function mapAction(row = {}) {
  return {
    action_key: row.action_key,
    title: row.action_title || null,
    status: row.status || null,
    module_binding: row.module_binding || null,
    connector_family: row.connector_family || null,
    runtime_capability_class: row.runtime_capability_class || null,
    runtime_callable: yes(row.runtime_callable),
    primary_executor: row.primary_executor || null,
    action_class: row.action_class || null,
    action_scope: row.action_scope || null,
    route_target: row.route_target || null,
    execution_layer: row.execution_layer || null,
    inventory_role: row.inventory_role || null,
    endpoint_group: row.endpoint_group || null,
    review_required: yes(row.review_required),
    structured_api_supported: yes(row.structured_api_supported),
    conversational_trigger_supported: yes(row.conversational_trigger_supported),
    provider_agnostic: yes(row.provider_agnostic),
    allowed_actor_roles: parseJson(row.allowed_actor_roles, row.allowed_actor_roles || null),
    allowed_governance_levels: parseJson(row.allowed_governance_levels, row.allowed_governance_levels || null),
    writeback_scope: row.writeback_scope || null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function mapSurface(row = {}) {
  return {
    surface_key: row.surface_key,
    display_name: row.display_name || null,
    surface_role: row.surface_role || null,
    description: row.description || null,
    supported_modes: parseJson(row.supported_modes_json, []),
    supported_channels: parseJson(row.supported_channels_json, []),
    capabilities: parseJson(row.capabilities_json, []),
    platform_runtime_key: row.platform_runtime_key || null,
    status: row.status || null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function mapPlugin(row = {}) {
  return {
    target_key: row.target_key,
    brand_name: row.brand_name || null,
    brand_domain: row.brand_domain || null,
    site_type: row.site_type || null,
    plugin_validation_status: row.plugin_validation_status || null,
    active_status: row.active_status || null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

const CATALOGS = Object.freeze({
  operation_contracts: Object.freeze({
    catalog_key: "operation_contracts",
    display_name: "Operation contracts",
    principal_scopes: ["admin", "tenant"],
    source: "operation_contract_registry",
    key_field: "operation_key",
  }),
  agent_surfaces: Object.freeze({
    catalog_key: "agent_surfaces",
    display_name: "Agent surfaces",
    principal_scopes: ["admin", "tenant"],
    source: "agent_surface_catalog",
    key_field: "surface_key",
  }),
  actions: Object.freeze({
    catalog_key: "actions",
    display_name: "Runtime actions",
    principal_scopes: ["admin", "tenant"],
    source: "actions",
    key_field: "action_key",
  }),
  plugins: Object.freeze({
    catalog_key: "plugins",
    display_name: "Plugin inventory",
    principal_scopes: ["admin"],
    source: "plugins",
    key_field: "target_key",
  }),
});

function normalizeCatalogKey(value) {
  const key = compact(value, 80).toLowerCase().replace(/[\s.-]+/g, "_");
  const aliases = {
    contracts: "operation_contracts",
    operations: "operation_contracts",
    surfaces: "agent_surfaces",
    agent_surface_catalog: "agent_surfaces",
    runtime_actions: "actions",
    plugin_inventory: "plugins",
  };
  return aliases[key] || key;
}

export function listTypedCatalogs({ auth = {} } = {}) {
  const scope = principalScope(auth);
  return {
    ok: true,
    principal_scope: scope,
    items: Object.values(CATALOGS)
      .filter((catalog) => catalog.principal_scopes.includes(scope))
      .map((catalog) => ({
        catalog_key: catalog.catalog_key,
        display_name: catalog.display_name,
        source: catalog.source,
        pagination: "cursor",
      })),
    secrets_included: false,
  };
}

async function queryRows(pool, sql, params) {
  if (!pool || typeof pool.query !== "function") {
    throw catalogError(500, "CATALOG_POOL_REQUIRED", "Typed catalog queries require a database pool.");
  }
  try {
    const [rows] = await pool.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch (cause) {
    throw catalogError(503, "CATALOG_QUERY_UNAVAILABLE", "The typed catalog is temporarily unavailable.", {
      cause_code: cause?.code || null,
      retryable: true,
    });
  }
}

function paginateItems(catalogKey, keyField, items, limit) {
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;
  const last = pageItems[pageItems.length - 1];
  return {
    items: pageItems,
    page: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(catalogKey, last[keyField]) : null,
    },
  };
}

async function queryOperationContracts({ scope, q, after, limit }) {
  const normalizedQ = q.toLowerCase();
  const items = listOperationContracts({ principalScope: scope })
    .filter((item) => !normalizedQ || JSON.stringify(item).toLowerCase().includes(normalizedQ))
    .filter((item) => String(item.operation_key || "") > after)
    .sort((a, b) => String(a.operation_key || "").localeCompare(String(b.operation_key || "")))
    .slice(0, limit + 1);
  return paginateItems("operation_contracts", "operation_key", items, limit);
}

async function queryAgentSurfaces({ pool, q, after, limit }) {
  const like = `%${q}%`;
  const rows = await queryRows(
    pool,
    `SELECT surface_key, display_name, surface_role, description,
            supported_modes_json, supported_channels_json, capabilities_json,
            platform_runtime_key, status, updated_at
       FROM agent_surface_catalog
      WHERE status = 'active'
        AND surface_key > ?
        AND (? = '' OR surface_key LIKE ? OR display_name LIKE ? OR description LIKE ?)
      ORDER BY surface_key ASC
      LIMIT ?`,
    [after, q, like, like, like, limit + 1],
  );
  return paginateItems("agent_surfaces", "surface_key", rows.map(mapSurface), limit);
}

async function queryActions({ pool, scope, q, after, limit }) {
  const like = `%${q}%`;
  const tenantClause = scope === "tenant"
    ? `AND LOWER(COALESCE(admin_only, 'false')) NOT IN ('true','1','yes')
       AND LOWER(COALESCE(client_allowed, 'true')) NOT IN ('false','0','no')
       AND (allowed_actor_roles IS NULL OR allowed_actor_roles = '' OR LOWER(allowed_actor_roles) LIKE '%tenant%')`
    : "";
  const rows = await queryRows(
    pool,
    `SELECT action_key, status, module_binding, connector_family,
            runtime_capability_class, runtime_callable, primary_executor,
            action_title, action_class, action_scope, route_target, execution_layer,
            inventory_role, endpoint_group, review_required, structured_api_supported,
            conversational_trigger_supported, provider_agnostic, allowed_actor_roles,
            allowed_governance_levels, writeback_scope, updated_at
       FROM actions
      WHERE status = 'active'
        AND action_key > ?
        ${tenantClause}
        AND (? = '' OR action_key LIKE ? OR action_title LIKE ? OR action_scope LIKE ?)
      ORDER BY action_key ASC
      LIMIT ?`,
    [after, q, like, like, like, limit + 1],
  );
  return paginateItems("actions", "action_key", rows.map(mapAction), limit);
}

async function queryPlugins({ pool, q, after, limit }) {
  const like = `%${q}%`;
  const rows = await queryRows(
    pool,
    `SELECT target_key, brand_name, brand_domain, site_type,
            plugin_validation_status, active_status, updated_at
       FROM plugins
      WHERE target_key > ?
        AND LOWER(COALESCE(active_status, 'active')) NOT IN ('inactive','disabled','archived')
        AND (? = '' OR target_key LIKE ? OR brand_name LIKE ? OR brand_domain LIKE ?)
      ORDER BY target_key ASC
      LIMIT ?`,
    [after, q, like, like, like, limit + 1],
  );
  return paginateItems("plugins", "target_key", rows.map(mapPlugin), limit);
}

export async function queryTypedCatalog(input = {}, deps = {}) {
  const scope = principalScope(deps.auth || input.auth || {});
  const catalogKey = normalizeCatalogKey(input.catalog_key || input.catalog);
  const catalog = CATALOGS[catalogKey];
  if (!catalog) {
    throw catalogError(400, "CATALOG_KEY_INVALID", "Unsupported typed catalog.", {
      allowed: Object.values(CATALOGS)
        .filter((item) => item.principal_scopes.includes(scope))
        .map((item) => item.catalog_key),
    });
  }
  if (!catalog.principal_scopes.includes(scope)) {
    throw catalogError(403, "CATALOG_ACCESS_DENIED", "The catalog is not available to this principal.", {
      catalog_key: catalogKey,
      principal_scope: scope,
    });
  }

  const limit = positiveInt(input.limit, 25);
  const q = compact(input.q || input.filter, 200);
  const after = decodeCursor(catalogKey, input.cursor);

  let result;
  if (catalogKey === "operation_contracts") {
    result = await queryOperationContracts({ scope, q, after, limit });
  } else if (catalogKey === "agent_surfaces") {
    result = await queryAgentSurfaces({ pool: deps.pool, q, after, limit });
  } else if (catalogKey === "actions") {
    result = await queryActions({ pool: deps.pool, scope, q, after, limit });
  } else {
    result = await queryPlugins({ pool: deps.pool, q, after, limit });
  }

  return {
    ok: true,
    catalog_key: catalogKey,
    principal_scope: scope,
    filters: { q: q || null },
    ...result,
    completeness: "complete",
    secrets_included: false,
  };
}

export const _testingTypedCatalogService = {
  CATALOGS,
  principalScope,
  normalizeCatalogKey,
  encodeCursor,
  decodeCursor,
  mapAction,
  mapSurface,
  mapPlugin,
  paginateItems,
};
