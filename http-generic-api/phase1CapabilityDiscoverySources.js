const ACTIVE_VALUES = ["active", "beta", "certified", "enabled", "ready", "ready_for_dispatch"];

export const PHASE1_CAPABILITY_DISCOVERY_SOURCES = Object.freeze([
  ["actions", "actions", "action", ["action_key"], [], [], [], ["tags"], ["exposure_scope"], ["status"], ["runtime_callable", "primary_executor", "runtime_capability_class"]],
  ["endpoints", "endpoints", "endpoint", ["endpoint_key"], ["parent_action_key"], ["method", "http_method"], ["path", "path_template", "endpoint_path", "http_path"], ["tags"], ["exposure_scope", "scope_class"], ["status"], ["execution_mode", "runtime_callable", "execution_readiness"]],
  ["admin_tools", "admin_platform_endpoint_tools", "admin_tool", ["tool_key"], [], ["http_method"], ["http_path"], ["tags"], [], ["is_enabled"], ["display_name", "description"], "admin"],
  ["tenant_tools", "tenant_platform_endpoint_tools", "tenant_tool", ["tool_key"], [], ["http_method"], ["http_path"], ["tags"], [], ["is_enabled"], ["display_name", "description"], "tenant"],
  ["app_tool_bindings", "app_integration_tool_bindings", "app_tool_binding", ["tool_key"], ["app_key"], [], [], ["tags"], ["exposure_scope"], ["status"], ["tool_surface", "binding_role", "credential_source"]],
  ["app_action_bindings", "app_integration_action_bindings", "app_action_binding", ["action_key"], ["app_key"], [], [], ["tags"], ["exposure_scope", "exposure_default"], ["status"], ["binding_role", "credential_source"]],
  ["platform_endpoint_tool_exports", "platform_endpoint_tool_exports", "tool_export", ["tool_name", "export_key"], ["parent_action_key"], ["http_method"], ["http_path"], ["tags"], ["scope_class", "exposure_scope"], ["status", "export_status"], ["endpoint_key", "source_endpoint_id"]],
  ["task_routes", "task_routes", "intent_route", ["intent_key", "task_key", "route_key"], ["action_key", "workflow_key"], [], [], ["tags"], ["actor_scope", "exposure_scope"], ["status", "active_status", "active"], ["route_mode", "allowed_states", "governance_level"]],
].map(([source, table, surface_family, key_candidates, parent_candidates, method_candidates, path_candidates, tag_candidates, exposure_candidates, status_candidates, extra_candidates, exposure_default = null]) => ({
  source, table, surface_family, key_candidates, parent_candidates, method_candidates,
  path_candidates, tag_candidates, exposure_candidates, status_candidates,
  extra_candidates, exposure_default,
})));

export function clampDiscoveryInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

function quoteIdentifier(identifier) {
  const value = String(identifier || "");
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `\`${value}\``;
}

function sourceColumns(source) {
  return [...new Set([
    ...source.key_candidates, ...source.parent_candidates, ...source.method_candidates,
    ...source.path_candidates, ...source.tag_candidates, ...source.exposure_candidates,
    ...source.status_candidates, ...source.extra_candidates,
  ])];
}

async function columnsFor(pool, table) {
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [table],
  );
  return rows.map((row) => String(row.COLUMN_NAME));
}

function activeWhere(columns, source) {
  const available = new Set(columns);
  if (available.has("is_enabled")) return "COALESCE(`is_enabled`, 0) = 1";
  for (const key of source.status_candidates) {
    if (!available.has(key)) continue;
    if (["active", "is_active", "enabled"].includes(key)) return `COALESCE(${quoteIdentifier(key)}, 0) = 1`;
    return `LOWER(COALESCE(${quoteIdentifier(key)}, '')) IN (${ACTIVE_VALUES.map((value) => `'${value}'`).join(",")})`;
  }
  return "1 = 1";
}

export async function loadPhase1DiscoverySource(pool, source, scanLimit) {
  const columns = await columnsFor(pool, source.table);
  const available = new Set(columns);
  const keyColumn = source.key_candidates.find((key) => available.has(key));
  if (!columns.length || !keyColumn) {
    return {
      ...source,
      source_status: columns.length ? "schema_incompatible" : "missing",
      total_active: 0,
      scanned_count: 0,
      truncated: false,
      rows: [],
    };
  }
  const where = activeWhere(columns, source);
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total_active FROM ${quoteIdentifier(source.table)} WHERE ${where}`);
  const selected = sourceColumns(source).filter((key) => available.has(key)).map(quoteIdentifier).join(", ");
  const [rows] = await pool.query(
    `SELECT ${selected} FROM ${quoteIdentifier(source.table)} WHERE ${where} ORDER BY ${quoteIdentifier(keyColumn)} LIMIT ${scanLimit}`,
  );
  const totalActive = Number(countRows[0]?.total_active || 0);
  return {
    ...source,
    source_status: "ready",
    total_active: totalActive,
    scanned_count: rows.length,
    truncated: totalActive > rows.length,
    rows,
  };
}
