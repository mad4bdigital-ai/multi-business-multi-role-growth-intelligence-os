import express from "express";
import { getPool } from "../db.js";

function normalizeLimit(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.trunc(parsed), 500);
}

function compactEndpoint(row = {}) {
  return {
    id: row.id,
    endpoint_id: row.endpoint_id,
    parent_action_key: row.parent_action_key,
    endpoint_key: row.endpoint_key,
    provider_domain: row.provider_domain,
    provider_family: row.provider_family,
    method: row.method,
    endpoint_path_or_function: row.endpoint_path_or_function,
    openai_action_name: row.openai_action_name,
    module_binding: row.module_binding,
    connector_family: row.connector_family,
    status: row.status,
    execution_readiness: row.execution_readiness,
    endpoint_role: row.endpoint_role,
    execution_mode: row.execution_mode,
    transport_required: row.transport_required,
    runtime_binding_profile: row.runtime_binding_profile,
    admin_only: row.admin_only,
    updated_at: row.updated_at
  };
}

function requireNonEmpty(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`${name} is required`);
    err.status = 400;
    err.code = "missing_required_field";
    throw err;
  }
  return normalized;
}

export function buildSqlEndpointRegistryRoutes(deps = {}) {
  const router = express.Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());

  router.get(
    "/admin/sql/endpoint-registry/endpoints",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (req, res) => {
      try {
        const parentActionKey = String(req.query.parent_action_key || "").trim();
        const endpointKey = String(req.query.endpoint_key || "").trim();
        const status = String(req.query.status || "active").trim();
        const limit = normalizeLimit(req.query.limit, 100);

        const where = [];
        const params = [];
        if (parentActionKey) {
          where.push("parent_action_key = ?");
          params.push(parentActionKey);
        }
        if (endpointKey) {
          where.push("endpoint_key = ?");
          params.push(endpointKey);
        }
        if (status) {
          where.push("status = ?");
          params.push(status);
        }

        const [rows] = await getPool().query(
          `SELECT * FROM endpoints ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY parent_action_key, endpoint_key LIMIT ?`,
          [...params, limit]
        );

        return res.json({
          ok: true,
          source: "sql",
          table: "endpoints",
          count: rows.length,
          endpoints: rows.map(compactEndpoint)
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: {
            code: error.code || "sql_endpoint_registry_list_failed",
            message: error.message
          }
        });
      }
    }
  );

  router.get(
    "/admin/sql/endpoint-registry/resolve",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (req, res) => {
      try {
        const parentActionKey = requireNonEmpty(req.query.parent_action_key, "parent_action_key");
        const endpointKey = requireNonEmpty(req.query.endpoint_key, "endpoint_key");

        const [rows] = await getPool().query(
          `SELECT * FROM endpoints
           WHERE parent_action_key = ?
             AND endpoint_key = ?
             AND status NOT IN ('deprecated', 'archived')
           ORDER BY FIELD(status, 'active') DESC, id DESC
           LIMIT 1`,
          [parentActionKey, endpointKey]
        );

        if (!rows.length) {
          return res.status(404).json({
            ok: false,
            source: "sql",
            error: {
              code: "endpoint_not_found",
              message: `Endpoint not found in SQL endpoints table: ${parentActionKey}/${endpointKey}`
            }
          });
        }

        return res.json({
          ok: true,
          source: "sql",
          table: "endpoints",
          endpoint: compactEndpoint(rows[0])
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: {
            code: error.code || "sql_endpoint_registry_resolve_failed",
            message: error.message
          }
        });
      }
    }
  );

  return router;
}
