import { Router } from "express";
import { getPool } from "../db.js";

function clampLimit(value, fallback = 100, max = 500) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function optionalFilter(clauses, params, column, value) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  clauses.push(`${column} = ?`);
  params.push(normalized);
}

export function buildConnectorTaxonomyRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  const requireAdmin = typeof requireAdminPrincipal === "function"
    ? requireAdminPrincipal
    : (_req, _res, next) => next();

  router.get("/admin/connector-taxonomy/summary", requireBackendApiKey, requireAdmin, async (_req, res) => {
    try {
      const pool = getPool();
      const [[families]] = await pool.query(
        `SELECT COUNT(*) AS connector_families,
                SUM(status = 'active') AS active_connector_families,
                COUNT(DISTINCT protocol_type) AS protocol_types
           FROM connector_family_registry`
      );
      const [[bindings]] = await pool.query(
        `SELECT COUNT(*) AS app_action_bindings,
                SUM(status = 'active') AS active_app_action_bindings,
                COUNT(DISTINCT app_key) AS bound_apps,
                COUNT(DISTINCT action_key) AS bound_actions
           FROM app_integration_action_bindings`
      );
      const [[toolBindings]] = await pool.query(
        `SELECT COUNT(*) AS app_tool_bindings,
                SUM(status = 'active') AS active_app_tool_bindings,
                COUNT(DISTINCT app_key) AS tool_bound_apps,
                COUNT(DISTINCT tool_key) AS bound_tools
           FROM app_integration_tool_bindings`
      );
      const [[coverage]] = await pool.query(
        `SELECT SUM(action_count) AS action_count,
                SUM(active_action_count) AS active_action_count,
                SUM(endpoint_count) AS endpoint_count,
                SUM(active_endpoint_count) AS active_endpoint_count,
                SUM(connected_system_count) AS connected_system_count,
                SUM(active_connected_system_count) AS active_connected_system_count
           FROM v_connector_family_coverage`
      );
      const [[quality]] = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM actions WHERE status = 'active' AND (connector_family IS NULL OR connector_family = '')) AS actions_null_connector,
           (SELECT COUNT(*) FROM endpoints WHERE status = 'active' AND (connector_family IS NULL OR connector_family = '')) AS endpoints_null_connector,
           (SELECT COUNT(*) FROM endpoints WHERE status = 'active' AND connector_family IN ('github', 'github_actions_connector')) AS legacy_github_connector_aliases,
           (SELECT COUNT(*) FROM app_integration_action_bindings b
             LEFT JOIN app_integrations ai ON CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
             LEFT JOIN actions a ON CONVERT(a.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE ai.app_key IS NULL OR a.action_key IS NULL) AS orphan_app_action_bindings`
      );
      return res.status(200).json({ ok: true, families, bindings, tool_bindings: toolBindings, coverage, quality });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_taxonomy_summary_failed", message: err.message } });
    }
  });

  router.get("/admin/connector-taxonomy/app-map", requireBackendApiKey, requireAdmin, async (req, res) => {
    try {
      const clauses = [];
      const params = [];
      optionalFilter(clauses, params, "app_key", req.query.app_key);
      optionalFilter(clauses, params, "app_category", req.query.app_category);
      optionalFilter(clauses, params, "action_key", req.query.action_key);
      optionalFilter(clauses, params, "credential_source", req.query.credential_source);
      optionalFilter(clauses, params, "exposure_default", req.query.exposure_default);
      if (String(req.query.only_unbound || "").trim() === "true") clauses.push("action_key IS NULL");
      if (String(req.query.only_connected || "").trim() === "true") clauses.push("active_user_connections > 0");
      const limit = clampLimit(req.query.limit, 100, 500);
      const sql = `SELECT app_key, app_display_name, app_category, app_auth_type, app_status,
                          action_key, binding_role, credential_source, exposure_default, binding_status,
                          connector_family, runtime_capability_class, runtime_callable, primary_executor, api_key_mode,
                          active_endpoints, active_tool_exports, active_user_connections
                     FROM v_app_integration_capability_map
                    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
                    ORDER BY app_key, action_key
                    LIMIT ${limit}`;
      const [rows] = await getPool().query(sql, params);
      return res.status(200).json({ ok: true, count: rows.length, items: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_taxonomy_app_map_failed", message: err.message } });
    }
  });

  router.get("/admin/connector-taxonomy/family-coverage", requireBackendApiKey, requireAdmin, async (req, res) => {
    try {
      const clauses = [];
      const params = [];
      optionalFilter(clauses, params, "connector_family", req.query.connector_family);
      optionalFilter(clauses, params, "provider_family", req.query.provider_family);
      optionalFilter(clauses, params, "protocol_type", req.query.protocol_type);
      optionalFilter(clauses, params, "runtime_layer", req.query.runtime_layer);
      optionalFilter(clauses, params, "registry_status", req.query.registry_status);
      if (String(req.query.only_in_use || "").trim() === "true") {
        clauses.push("(active_action_count > 0 OR active_endpoint_count > 0 OR active_connected_system_count > 0)");
      }
      const limit = clampLimit(req.query.limit, 100, 500);
      const sql = `SELECT connector_family, provider_family, display_name, protocol_type,
                          provider_domain_mode, connection_scope, runtime_layer, default_auth_mode,
                          registry_status, action_count, active_action_count, endpoint_count,
                          active_endpoint_count, connected_system_count, active_connected_system_count
                     FROM v_connector_family_coverage
                    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
                    ORDER BY active_endpoint_count DESC, connector_family
                    LIMIT ${limit}`;
      const [rows] = await getPool().query(sql, params);
      return res.status(200).json({ ok: true, count: rows.length, items: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_taxonomy_family_coverage_failed", message: err.message } });
    }
  });

  return router;
}
