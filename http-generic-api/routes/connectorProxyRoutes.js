import { Router } from "express";
import { getPool } from "../db.js";

const ROUTE_TYPE_ORDER = [
  "vpn_private_ip",
  "lan_private_ip",
  "direct_public_ip",
  "dynamic_public_ip",
  "cloudflare_tunnel",
  "admin_recovery",
  "legacy_config",
];

const ROUTE_LEVEL_FAILURE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

function httpError(status, code, message, details = null) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function ambiguousDeviceError(deviceId, rows) {
  return httpError(
    409,
    "ambiguous_device_identity",
    `Device '${deviceId}' matches multiple active connector configs. Provide tenant_id or config_id to disambiguate.`,
    {
      device_id: deviceId,
      matches: rows.map((row) => ({
        config_id: row.config_id,
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        device_id: row.device_id,
      })),
    }
  );
}

async function resolveCanonicalDeviceId({ deviceId, userId = null, tenantId = null }) {
  const requested = String(deviceId || "").trim();
  if (!requested) return "";
  try {
    const [rows] = await getPool().query(
      `SELECT canonical_device_id
         FROM \`local_connector_device_aliases\`
        WHERE alias_device_id = ?
          AND status = 'active'
          AND (user_id = ? OR user_id IS NULL)
          AND (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY (user_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC, updated_at DESC
        LIMIT 1`,
      [requested, userId, tenantId]
    );
    return rows[0]?.canonical_device_id || requested;
  } catch {
    return requested;
  }
}

async function resolveDeviceConfig(userId, deviceId, { isAdmin = false, tenantId = null } = {}) {
  deviceId = await resolveCanonicalDeviceId({ deviceId, userId, tenantId });
  const selectSql = `SELECT config_id,
                           COALESCE(device_runtime_url, tunnel_url) AS tunnel_url,
                           public_gateway_url,
                           device_runtime_url,
                           admin_recovery_url,
                           connector_secret,
                           user_id,
                           tenant_id,
                           device_id
                      FROM \`local_connector_user_configs\`
                     WHERE is_enabled = 1`;

  if (userId) {
    const [rows] = await getPool().query(
      `${selectSql} AND user_id = ? AND device_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [userId, deviceId]
    );
    if (rows[0]) return rows[0];
  }

  // Admin/service callers may address a governed device by device_id alone.
  // Static regression guard equivalent: WHERE device_id = ? AND is_enabled = 1
  if (isAdmin) {
    const params = [deviceId];
    let sql = `${selectSql} AND device_id = ?`;
    if (tenantId) {
      sql += " AND tenant_id = ?";
      params.push(tenantId);
    }
    sql += " ORDER BY updated_at DESC LIMIT 1";
    const [rows] = await getPool().query(sql, params);
    if (rows[0]) return rows[0];
  }

  return null;
}

function uniqueTruthy(values) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function redactUrlForError(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function joinUrl(base, targetPath, queryString = "") {
  const cleanBase = String(base || "").replace(/\/$/, "");
  const cleanPath = String(targetPath || "/").startsWith("/") ? targetPath : `/${targetPath}`;
  return `${cleanBase}${cleanPath}${queryString}`;
}

function routeTypeRank(routeType) {
  const idx = ROUTE_TYPE_ORDER.indexOf(String(routeType || ""));
  return idx === -1 ? ROUTE_TYPE_ORDER.length : idx;
}

function routeResponseMeta(route) {
  return {
    route_id: route.route_id || null,
    route_type: route.route_type || "legacy_config",
    route_label: route.route_label || null,
    priority: route.priority ?? 1000,
    endpoint_url: route.endpoint_url ? redactUrlForError(route.endpoint_url) : null,
    health_status: route.health_status || "unknown",
  };
}

async function fetchConnectorJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      ok: false,
      error: {
        code: "connector_non_json_response",
        message: "Connector returned a non-JSON response.",
        details: { status: response.status, body_preview: text.slice(0, 500) },
      },
    };
  }
  return { response, data };
}

async function listCandidateRoutes(device) {
  const routes = [];
  if (device?.config_id) {
    const [rows] = await getPool().query(
      `SELECT route_id, config_id, route_type, route_label, endpoint_url, priority,
              tls_mode, auth_mode, health_status, last_failure_at, updated_at
         FROM \`local_connector_device_routes\`
        WHERE config_id = ?
          AND is_enabled = 1
          AND health_status IN ('healthy','unknown')
        ORDER BY priority ASC,
                 FIELD(route_type, 'vpn_private_ip','lan_private_ip','direct_public_ip','dynamic_public_ip','cloudflare_tunnel','admin_recovery'),
                 updated_at DESC`,
      [device.config_id]
    );
    routes.push(...rows);
  }

  if (!routes.length && device?.tunnel_url) {
    routes.push({
      route_id: null,
      config_id: device.config_id || null,
      route_type: "legacy_config",
      route_label: "Legacy device runtime URL",
      endpoint_url: device.tunnel_url,
      priority: 1000,
      tls_mode: "required",
      auth_mode: "bearer_connector_secret",
      health_status: "unknown",
    });
  }

  return routes.sort((a, b) =>
    Number(a.priority ?? 1000) - Number(b.priority ?? 1000) ||
    routeTypeRank(a.route_type) - routeTypeRank(b.route_type)
  );
}

async function markRouteSuccess(route) {
  if (!route?.route_id) return;
  try {
    await getPool().query(
      `UPDATE \`local_connector_device_routes\`
          SET health_status = 'healthy',
              last_health_at = NOW(),
              last_success_at = NOW(),
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = NOW()
        WHERE route_id = ?`,
      [route.route_id]
    );
  } catch {
    // Health metadata must not break the proxy response.
  }
}

async function markRouteFailure(route, code, message, { terminal = false } = {}) {
  if (!route?.route_id) return;
  const health = terminal ? "down" : "degraded";
  try {
    await getPool().query(
      `UPDATE \`local_connector_device_routes\`
          SET health_status = ?,
              last_health_at = NOW(),
              last_failure_at = NOW(),
              last_error_code = ?,
              last_error_message = ?,
              updated_at = NOW()
        WHERE route_id = ?`,
      [health, String(code || "route_failed").slice(0, 128), String(message || "Route dispatch failed.").slice(0, 1000), route.route_id]
    );
  } catch {
    // Health metadata must not break fallback.
  }
}

function buildForwardOptions(req) {
  const baseOptions = {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  };

  if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length) {
    const forwardedBody = { ...req.body };
    delete forwardedBody.user_id;
    delete forwardedBody.tenant_id;
    baseOptions.body = JSON.stringify(forwardedBody);
  }

  return baseOptions;
}

function isRouteLevelFailure(response, data) {
  if (!response) return true;
  if (ROUTE_LEVEL_FAILURE_STATUSES.has(response.status)) return true;
  if (data?.error?.code === "connector_non_json_response") return true;
  return false;
}

async function attemptRoute({ req, route, url, baseOptions, candidateTokens }) {
  if (route.auth_mode === "none") {
    return fetchConnectorJson(url, baseOptions);
  }
  if (route.auth_mode && route.auth_mode !== "bearer_connector_secret") {
    const err = new Error(`Unsupported connector route auth_mode '${route.auth_mode}'.`);
    err.code = "unsupported_route_auth_mode";
    throw err;
  }

  let last = null;
  for (const token of candidateTokens) {
    const options = {
      ...baseOptions,
      headers: { ...baseOptions.headers, Authorization: `Bearer ${token}` },
    };
    const attempt = await fetchConnectorJson(url, options);
    last = attempt;
    if (![401, 403].includes(attempt.response.status)) return attempt;
  }
  return last;
}

async function proxyToDevice(req, res, deviceId, targetPath) {
  const isUserAuth = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
  const isAdmin = req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true;
  let userId = isUserAuth ? req.auth.user_id : null;
  const tenantId = req.auth?.tenant_id || req.query.tenant_id || req.body?.tenant_id || null;
  if (!userId && isAdmin) {
    userId = (req.query.user_id || req.body?.user_id || "").trim() || null;
  }
  if (!userId && !isAdmin) {
    return res.status(401).json({ ok: false, error: { code: "user_identity_required", message: "Sign-in or pass user_id for admin callers." } });
  }

  const device = await resolveDeviceConfig(userId, deviceId, { isAdmin, tenantId });
  if (!device) {
    return res.status(404).json({ ok: false, error: { code: "device_not_found", message: `No active connector found for device '${deviceId}'.` } });
  }

  const candidateTokens = uniqueTruthy([device.connector_secret, process.env.BACKEND_API_KEY]);
  if (!candidateTokens.length) {
    return res.status(503).json({ ok: false, error: { code: "connector_auth_unconfigured", message: "No connector auth token is configured for this device proxy." } });
  }

  const forwardedQuery = { ...req.query };
  delete forwardedQuery.user_id;
  delete forwardedQuery.tenant_id;
  const queryString = Object.keys(forwardedQuery).length ? "?" + new URLSearchParams(forwardedQuery).toString() : "";
  const baseOptions = buildForwardOptions(req);
  const routes = await listCandidateRoutes(device);

  if (!routes.length) {
    return res.status(503).json({ ok: false, error: { code: "connector_route_not_provisioned", message: "No enabled healthy/unknown connector route is available for this device." } });
  }

  const attempts = [];
  for (const route of routes) {
    const url = joinUrl(route.endpoint_url, targetPath, queryString);
    const meta = routeResponseMeta(route);
    try {
      const attempt = await attemptRoute({ req, route, url, baseOptions, candidateTokens });
      const status = attempt?.response?.status || 502;
      const errorCode = attempt?.data?.error?.code || null;
      const errorMessage = attempt?.data?.error?.message || null;
      attempts.push({ ...meta, status, error_code: errorCode });

      if ([401, 403].includes(status)) {
        await markRouteFailure(route, "connector_auth_failed", errorMessage || "Connector rejected all configured auth tokens.");
        continue;
      }

      if (isRouteLevelFailure(attempt.response, attempt.data)) {
        await markRouteFailure(route, errorCode || `http_${status}`, errorMessage || `Route returned HTTP ${status}.`, { terminal: status === 530 || status === 503 });
        continue;
      }

      await markRouteSuccess(route);
      if (attempt.data && typeof attempt.data === "object" && !Array.isArray(attempt.data)) {
        return res.status(status).json({ ...attempt.data, connector_route: meta, connector_route_attempts: attempts });
      }
      return res.status(status).send(attempt.data);
    } catch (err) {
      attempts.push({ ...meta, status: null, error_code: err.code || "route_dispatch_exception" });
      await markRouteFailure(route, err.code || "route_dispatch_exception", err.message || "Route dispatch exception.", { terminal: true });
    }
  }

  return res.status(502).json({
    ok: false,
    error: {
      code: "connector_all_routes_failed",
      message: "All enabled healthy/unknown connector routes failed for this device.",
      details: { device_id: deviceId, attempts },
    },
  });
}

export function buildConnectorProxyRoutes(deps) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();

  function adminOnly(req, res, next) {
    if (typeof requireAdminPrincipal === "function") return requireAdminPrincipal(req, res, next);
    if (req.auth?.is_admin === true) return next();
    return res.status(403).json({
      ok: false,
      error: {
        code: "admin_backend_api_key_required",
        message: "This connector workaround proxy requires admin/service BACKEND_API_KEY. User JWT access is not allowed.",
        status: 403,
      },
    });
  }

  router.get("/connector/:device_id/policy", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/policy"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.get("/connector/:device_id/health", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/health"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/shell", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/shell"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/files", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/files"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/dependencies", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/dependencies"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/apps", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/apps"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/browser", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/browser"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/ps", requireBackendApiKey, adminOnly, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/ps"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/win", requireBackendApiKey, adminOnly, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/win"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/n8n", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/n8n"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/cf", requireBackendApiKey, adminOnly, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/cf"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/fetch-upload", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/fetch-upload"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/github", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/github"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/gcloud", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/gcloud"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  router.post("/connector/:device_id/shell-fetch-upload", requireBackendApiKey, async (req, res) => {
    try { await proxyToDevice(req, res, req.params.device_id, "/shell-fetch-upload"); }
    catch (err) { res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } }); }
  });

  return router;
}
