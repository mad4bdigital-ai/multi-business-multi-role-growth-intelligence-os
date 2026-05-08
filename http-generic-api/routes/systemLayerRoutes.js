import { Router } from "express";
import { getPool } from "../db.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";

const SYSTEM_LAYER_TOOLS = [
  {
    name: "connector_registry_list",
    description: "List connector systems from the connected_systems registry.",
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        status: { type: "string", enum: ["active", "pending", "error", "archived"] },
        connector_family: { type: "string" },
        provider_family: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: [],
    },
  },
  {
    name: "connector_registry_get",
    description: "Read one connector system, including its installation and grant summary.",
    inputSchema: {
      type: "object",
      properties: {
        system_id: { type: "string" },
      },
      required: ["system_id"],
    },
  },
];

const VALID_STATUSES = new Set(["active", "pending", "error", "archived"]);

function isAdminPrincipal(auth) {
  return auth?.is_admin === true;
}

function principalTenantId(auth) {
  return auth?.tenant_id || null;
}

function scopeFiltersToPrincipal(filters = {}, auth = {}) {
  if (isAdminPrincipal(auth)) return { ...filters };

  const tenantId = principalTenantId(auth);
  if (!tenantId) {
    const err = new Error("Tenant-scoped system tools require a tenant context.");
    err.status = 403;
    err.code = "tenant_context_required";
    throw err;
  }

  if (filters.tenant_id && filters.tenant_id !== tenantId) {
    const err = new Error("Tenant-scoped system tools cannot access another tenant.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }

  return { ...filters, tenant_id: tenantId };
}

function clampLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 200);
}

function parseConfigJson(value) {
  if (!value || typeof value !== "string") return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return { parse_error: true };
  }
}

function systemRow(row) {
  return {
    system_id: row.system_id,
    tenant_id: row.tenant_id,
    system_key: row.system_key,
    display_name: row.display_name,
    provider_family: row.provider_family,
    provider_domain: row.provider_domain,
    connector_family: row.connector_family,
    auth_type: row.auth_type,
    service_mode: row.service_mode,
    self_serve_capable: Boolean(row.self_serve_capable),
    assisted_capable: Boolean(row.assisted_capable),
    managed_capable: Boolean(row.managed_capable),
    status: row.status,
    config: parseConfigJson(row.config_json),
    active_installations: Number(row.active_installations || 0),
    total_installations: Number(row.total_installations || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listConnectorRegistry(filters = {}, auth = null) {
  const scopedFilters = auth ? scopeFiltersToPrincipal(filters, auth) : filters;
  const conditions = ["1=1"];
  const params = [];

  if (scopedFilters.tenant_id) {
    conditions.push("cs.tenant_id = ?");
    params.push(scopedFilters.tenant_id);
  }
  if (scopedFilters.status) {
    if (!VALID_STATUSES.has(scopedFilters.status)) {
      const err = new Error("status must be one of: active, pending, error, archived.");
      err.status = 400;
      err.code = "invalid_status";
      throw err;
    }
    conditions.push("cs.status = ?");
    params.push(scopedFilters.status);
  }
  if (scopedFilters.connector_family) {
    conditions.push("cs.connector_family = ?");
    params.push(scopedFilters.connector_family);
  }
  if (scopedFilters.provider_family) {
    conditions.push("cs.provider_family = ?");
    params.push(scopedFilters.provider_family);
  }

  const limit = clampLimit(scopedFilters.limit);
  params.push(limit);

  const [rows] = await getPool().query(
    `SELECT cs.system_id, cs.tenant_id, cs.system_key, cs.display_name, cs.provider_family,
            cs.provider_domain, cs.connector_family, cs.auth_type, cs.service_mode,
            cs.self_serve_capable, cs.assisted_capable, cs.managed_capable, cs.status,
            cs.config_json, cs.created_at, cs.updated_at,
            SUM(CASE WHEN i.status = 'active' THEN 1 ELSE 0 END) AS active_installations,
            COUNT(i.installation_id) AS total_installations
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY cs.id
      ORDER BY cs.updated_at DESC, cs.created_at DESC
      LIMIT ?`,
    params
  );

  return rows.map(systemRow);
}

async function getConnectorRegistrySystem(systemId, auth = null) {
  if (!systemId) {
    const err = new Error("system_id is required.");
    err.status = 400;
    err.code = "missing_system_id";
    throw err;
  }

  const [rows] = await getPool().query(
    `SELECT cs.system_id, cs.tenant_id, cs.system_key, cs.display_name, cs.provider_family,
            cs.provider_domain, cs.connector_family, cs.auth_type, cs.service_mode,
            cs.self_serve_capable, cs.assisted_capable, cs.managed_capable, cs.status,
            cs.config_json, cs.created_at, cs.updated_at,
            SUM(CASE WHEN i.status = 'active' THEN 1 ELSE 0 END) AS active_installations,
            COUNT(i.installation_id) AS total_installations
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
      WHERE cs.system_id = ?
      GROUP BY cs.id
      LIMIT 1`,
    [systemId]
  );

  if (!rows.length) {
    const err = new Error(`Connector system ${systemId} not found.`);
    err.status = 404;
    err.code = "connector_system_not_found";
    throw err;
  }

  const row = rows[0];
  if (auth && !isAdminPrincipal(auth) && row.tenant_id !== principalTenantId(auth)) {
    const err = new Error("Tenant-scoped system tools cannot access another tenant.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }

  const [installations] = await getPool().query(
    `SELECT installation_id, tenant_id, scope, credential_ref, status, installed_at, expires_at, meta_json
       FROM \`installations\`
      WHERE system_id = ?
      ORDER BY installed_at DESC
      LIMIT 100`,
    [systemId]
  );

  return {
    ...systemRow(row),
    installations: installations.map((installation) => ({
      ...installation,
      meta_json: parseConfigJson(installation.meta_json),
    })),
  };
}

async function callSystemLayerTool(name, args = {}, auth = null) {
  switch (name) {
    case "connector_registry_list":
      return { connectors: await listConnectorRegistry(args, auth) };
    case "connector_registry_get":
      return { connector: await getConnectorRegistrySystem(args.system_id, auth) };
    default: {
      const err = new Error(`Unknown system layer tool: ${name}`);
      err.status = 400;
      err.code = "unknown_tool";
      throw err;
    }
  }
}

function sendError(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: err.message,
    },
  });
}

export function buildSystemLayerRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  const adminOnly = [requireBackendApiKey, requireAdminPrincipal];
  const authenticated = [requireBackendApiKey];

  router.get("/system/tools", ...authenticated, async (req, res) => {
    return res.status(200).json({
      ok: true,
      protocol: "openapi-mcp-facade",
      principal: {
        mode: req.auth?.mode || null,
        is_admin: isAdminPrincipal(req.auth),
        tenant_id: principalTenantId(req.auth),
      },
      tools: SYSTEM_LAYER_TOOLS,
    });
  });

  router.post("/system/tools/call", ...authenticated, async (req, res) => {
    try {
      const { name, arguments: args = {} } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const result = await callSystemLayerTool(name, args, req.auth);
      return res.status(200).json({ ok: true, name, result });
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  router.get("/system/connectors", ...authenticated, async (req, res) => {
    try {
      const connectors = await listConnectorRegistry(req.query || {}, req.auth);
      return res.status(200).json({ ok: true, connectors, count: connectors.length });
    } catch (err) {
      return sendError(res, err, "connector_registry_list_failed");
    }
  });

  router.get("/system/connectors/:system_id", ...authenticated, async (req, res) => {
    try {
      const connector = await getConnectorRegistrySystem(req.params.system_id, req.auth);
      return res.status(200).json({ ok: true, connector });
    } catch (err) {
      return sendError(res, err, "connector_registry_get_failed");
    }
  });

  router.get("/admin/system/connectors", ...adminOnly, async (req, res) => {
    try {
      const connectors = await listConnectorRegistry(req.query || {}, req.auth);
      return res.status(200).json({ ok: true, connectors, count: connectors.length });
    } catch (err) {
      return sendError(res, err, "connector_registry_list_failed");
    }
  });

  router.get("/admin/system/connectors/:system_id", ...adminOnly, async (req, res) => {
    try {
      const connector = await getConnectorRegistrySystem(req.params.system_id, req.auth);
      return res.status(200).json({ ok: true, connector });
    } catch (err) {
      return sendError(res, err, "connector_registry_get_failed");
    }
  });

  router.get("/admin/system/tools", ...adminOnly, async (_req, res) => {
    return res.status(200).json({
      ok: true,
      protocol: "openapi-mcp-facade",
      tools: SYSTEM_LAYER_TOOLS,
    });
  });

  router.post("/admin/system/tools/call", ...adminOnly, async (req, res) => {
    try {
      const { name, arguments: args = {} } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const result = await callSystemLayerTool(name, args, req.auth);
      return res.status(200).json({ ok: true, name, result });
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  return router;
}

export {
  SYSTEM_LAYER_TOOLS,
  callSystemLayerTool,
  getConnectorRegistrySystem,
  listConnectorRegistry,
};
