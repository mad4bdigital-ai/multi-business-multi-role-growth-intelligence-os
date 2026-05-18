import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

const ROUTE_TYPES = new Set([
  "cloudflare_tunnel",
  "direct_public_ip",
  "dynamic_public_ip",
  "vpn_private_ip",
  "lan_private_ip",
  "admin_recovery",
]);

const TLS_MODES = new Set(["required", "self_signed_allowed", "plain_http_internal_only"]);
const AUTH_MODES = new Set(["bearer_connector_secret", "mtls", "none"]);
const HEALTH_STATUSES = new Set(["unknown", "healthy", "degraded", "down"]);
const ADMIN_RECOVERY_HOSTS = new Set(["connector.mad4b.com", "connect.mad4b.com"]);
const DEFAULT_ROUTE_PRIORITIES = Object.freeze({
  vpn_private_ip: 10,
  lan_private_ip: 20,
  direct_public_ip: 30,
  dynamic_public_ip: 40,
  cloudflare_tunnel: 50,
  admin_recovery: 90,
});

function httpError(status, code, message, details = null) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function isAdmin(req) {
  return req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true;
}

function isUserScoped(req) {
  return req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
}

function intOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function boolInt(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return 1;
  if (["0", "false", "no", "off"].includes(normalized)) return 0;
  return fallback ? 1 : 0;
}

function parseRouteUrl(endpointUrl, routeType, tlsMode) {
  let parsed;
  try {
    parsed = new URL(String(endpointUrl || "").trim());
  } catch {
    throw httpError(400, "invalid_endpoint_url", "endpoint_url must be an absolute http or https URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw httpError(400, "invalid_endpoint_url", "endpoint_url must use http or https.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw httpError(400, "invalid_endpoint_url", "endpoint_url must not include credentials, query strings, or fragments.");
  }
  if (parsed.protocol === "http:" && !(routeType === "lan_private_ip" && tlsMode === "plain_http_internal_only")) {
    throw httpError(400, "https_required", "Non-LAN connector routes must use https.");
  }
  return parsed;
}

function validateRouteInput(req, body = {}, { partial = false } = {}) {
  const routeType = String(body.route_type || "").trim();
  if (!partial || routeType) {
    if (!ROUTE_TYPES.has(routeType)) throw httpError(400, "invalid_route_type", "route_type is not supported.");
    if (routeType === "admin_recovery" && !isAdmin(req)) {
      throw httpError(403, "admin_recovery_route_forbidden", "Only admin callers may register admin_recovery routes.");
    }
  }

  const tlsMode = String(body.tls_mode || "required").trim();
  if (!TLS_MODES.has(tlsMode)) throw httpError(400, "invalid_tls_mode", "tls_mode is not supported.");

  const authMode = String(body.auth_mode || "bearer_connector_secret").trim();
  if (!AUTH_MODES.has(authMode)) throw httpError(400, "invalid_auth_mode", "auth_mode is not supported.");

  const healthStatus = String(body.health_status || "unknown").trim();
  if (!HEALTH_STATUSES.has(healthStatus)) throw httpError(400, "invalid_health_status", "health_status is not supported.");

  let parsedUrl = null;
  if (!partial || body.endpoint_url) {
    parsedUrl = parseRouteUrl(body.endpoint_url, routeType, tlsMode);
    const host = parsedUrl.hostname.toLowerCase();
    if (ADMIN_RECOVERY_HOSTS.has(host) && routeType !== "admin_recovery") {
      throw httpError(400, "admin_recovery_host_not_runtime_route", "connector.mad4b.com is reserved for admin recovery, not tenant runtime routing.");
    }
    if (routeType === "admin_recovery" && !ADMIN_RECOVERY_HOSTS.has(host)) {
      throw httpError(400, "invalid_admin_recovery_host", "admin_recovery routes must target the configured admin recovery host.");
    }
  }

  return { routeType, tlsMode, authMode, healthStatus, parsedUrl };
}

async function resolveConfig(req, { user_id = null, tenant_id = null, device_id = null, config_id = null } = {}) {
  const pool = getPool();
  if (config_id) {
    const params = [config_id];
    let sql = "SELECT * FROM `local_connector_user_configs` WHERE config_id = ? AND is_enabled = 1";
    if (!isAdmin(req)) {
      const userId = req.auth?.user_id;
      const tenantId = req.auth?.tenant_id;
      if (!userId) throw httpError(401, "user_identity_required", "Signed-in user identity is required.");
      sql += " AND user_id = ?";
      params.push(userId);
      if (tenantId) {
        sql += " AND tenant_id = ?";
        params.push(tenantId);
      }
    }
    sql += " LIMIT 1";
    const [rows] = await pool.query(sql, params);
    if (rows[0]) return rows[0];
    throw httpError(404, "connector_config_not_found", "No active connector config matched the request.");
  }

  const deviceId = String(device_id || "").trim();
  if (!deviceId) throw httpError(400, "missing_device_id", "device_id is required.");

  const params = [];
  let sql = "SELECT * FROM `local_connector_user_configs` WHERE device_id = ? AND is_enabled = 1";
  params.push(deviceId);
  if (isAdmin(req)) {
    if (user_id) { sql += " AND user_id = ?"; params.push(user_id); }
    if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
  } else if (isUserScoped(req)) {
    if (!req.auth?.user_id) throw httpError(401, "user_identity_required", "Signed-in user identity is required.");
    sql += " AND user_id = ?";
    params.push(req.auth.user_id);
    if (req.auth?.tenant_id) {
      sql += " AND tenant_id = ?";
      params.push(req.auth.tenant_id);
    }
  } else {
    throw httpError(403, "unsupported_auth_mode", "Unsupported authentication mode for device route registration.");
  }
  sql += " ORDER BY updated_at DESC LIMIT 1";
  const [rows] = await pool.query(sql, params);
  if (rows[0]) return rows[0];
  throw httpError(404, "connector_config_not_found", "No active connector config matched the request.");
}

function routeResponse(row) {
  return {
    route_id: row.route_id,
    config_id: row.config_id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    device_id: row.device_id,
    route_type: row.route_type,
    route_label: row.route_label,
    endpoint_url: row.endpoint_url,
    priority: row.priority,
    is_enabled: Boolean(row.is_enabled),
    is_customer_selectable: Boolean(row.is_customer_selectable),
    requires_admin_setup: Boolean(row.requires_admin_setup),
    requires_router_config: Boolean(row.requires_router_config),
    requires_vpn_agent: Boolean(row.requires_vpn_agent),
    tls_mode: row.tls_mode,
    auth_mode: row.auth_mode,
    health_status: row.health_status,
    last_health_at: row.last_health_at,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    last_error_code: row.last_error_code,
    route_metadata: row.route_metadata,
  };
}

export function buildLocalConnectorDeviceRouteRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.get("/local-connector/device-routes", requireBackendApiKey, async (req, res) => {
    try {
      const config = await resolveConfig(req, req.query || {});
      const [rows] = await getPool().query(
        `SELECT * FROM \`local_connector_device_routes\`
          WHERE config_id = ?
          ORDER BY is_enabled DESC, priority ASC, route_type ASC`,
        [config.config_id]
      );
      return res.status(200).json({ ok: true, config_id: config.config_id, device_id: config.device_id, routes: rows.map(routeResponse) });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_routes_list_failed", message: err.message, details: err.details || null } });
    }
  });

  router.post("/local-connector/device-routes", requireBackendApiKey, async (req, res) => {
    try {
      const body = req.body || {};
      const config = await resolveConfig(req, body);
      const { routeType, tlsMode, authMode, healthStatus, parsedUrl } = validateRouteInput(req, body);
      const routeId = randomUUID();
      const priority = intOrDefault(body.priority, routeType === "admin_recovery" ? 90 : 50);
      const isCustomerSelectable = routeType === "admin_recovery" ? 0 : boolInt(body.is_customer_selectable, true);
      const metadata = body.route_metadata && typeof body.route_metadata === "object" ? JSON.stringify(body.route_metadata) : null;

      await getPool().query(
        `INSERT INTO \`local_connector_device_routes\`
          (route_id, config_id, user_id, tenant_id, device_id, route_type, route_label, endpoint_url,
           priority, is_enabled, is_customer_selectable, requires_admin_setup, requires_router_config,
           requires_vpn_agent, tls_mode, auth_mode, health_status, route_metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           route_label = VALUES(route_label),
           priority = VALUES(priority),
           is_enabled = VALUES(is_enabled),
           is_customer_selectable = VALUES(is_customer_selectable),
           requires_admin_setup = VALUES(requires_admin_setup),
           requires_router_config = VALUES(requires_router_config),
           requires_vpn_agent = VALUES(requires_vpn_agent),
           tls_mode = VALUES(tls_mode),
           auth_mode = VALUES(auth_mode),
           health_status = VALUES(health_status),
           route_metadata = VALUES(route_metadata),
           updated_at = NOW()`,
        [
          routeId,
          config.config_id,
          config.user_id,
          config.tenant_id,
          config.device_id,
          routeType,
          String(body.route_label || "").trim() || null,
          parsedUrl.toString().replace(/\/$/, ""),
          priority,
          boolInt(body.is_enabled, true),
          isCustomerSelectable,
          boolInt(body.requires_admin_setup, routeType === "admin_recovery"),
          boolInt(body.requires_router_config, ["direct_public_ip", "dynamic_public_ip"].includes(routeType)),
          boolInt(body.requires_vpn_agent, routeType === "vpn_private_ip"),
          tlsMode,
          authMode,
          healthStatus,
          metadata,
        ]
      );

      const [rows] = await getPool().query(
        `SELECT * FROM \`local_connector_device_routes\`
          WHERE config_id = ? AND route_type = ? AND endpoint_url = ?
          LIMIT 1`,
        [config.config_id, routeType, parsedUrl.toString().replace(/\/$/, "")]
      );
      return res.status(200).json({ ok: true, route: routeResponse(rows[0]), secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_route_upsert_failed", message: err.message, details: err.details || null } });
    }
  });

  router.patch("/local-connector/device-routes/:route_id", requireBackendApiKey, async (req, res) => {
    try {
      const routeId = String(req.params.route_id || "").trim();
      if (!routeId) throw httpError(400, "missing_route_id", "route_id is required.");
      const [existingRows] = await getPool().query("SELECT * FROM `local_connector_device_routes` WHERE route_id = ? LIMIT 1", [routeId]);
      const existing = existingRows[0];
      if (!existing) throw httpError(404, "route_not_found", "Device route was not found.");
      const config = await resolveConfig(req, { config_id: existing.config_id });
      const merged = { ...existing, ...(req.body || {}) };
      const { routeType, tlsMode, authMode, healthStatus, parsedUrl } = validateRouteInput(req, merged, { partial: false });
      const endpoint = parsedUrl.toString().replace(/\/$/, "");
      const metadata = merged.route_metadata && typeof merged.route_metadata === "object" ? JSON.stringify(merged.route_metadata) : existing.route_metadata;

      await getPool().query(
        `UPDATE \`local_connector_device_routes\`
            SET route_type = ?, route_label = ?, endpoint_url = ?, priority = ?, is_enabled = ?,
                is_customer_selectable = ?, requires_admin_setup = ?, requires_router_config = ?,
                requires_vpn_agent = ?, tls_mode = ?, auth_mode = ?, health_status = ?, route_metadata = ?, updated_at = NOW()
          WHERE route_id = ? AND config_id = ?`,
        [
          routeType,
          String(merged.route_label || "").trim() || null,
          endpoint,
          intOrDefault(merged.priority, existing.priority),
          boolInt(merged.is_enabled, Boolean(existing.is_enabled)),
          routeType === "admin_recovery" ? 0 : boolInt(merged.is_customer_selectable, Boolean(existing.is_customer_selectable)),
          boolInt(merged.requires_admin_setup, Boolean(existing.requires_admin_setup)),
          boolInt(merged.requires_router_config, Boolean(existing.requires_router_config)),
          boolInt(merged.requires_vpn_agent, Boolean(existing.requires_vpn_agent)),
          tlsMode,
          authMode,
          healthStatus,
          metadata,
          routeId,
          config.config_id,
        ]
      );
      const [rows] = await getPool().query("SELECT * FROM `local_connector_device_routes` WHERE route_id = ? LIMIT 1", [routeId]);
      return res.status(200).json({ ok: true, route: routeResponse(rows[0]), secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_route_update_failed", message: err.message, details: err.details || null } });
    }
  });

  return router;
}
