import { Router } from "express";
import { getPool } from "../db.js";

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

async function resolveDeviceTunnel(userId, deviceId, { isAdmin = false, tenantId = null } = {}) {
  deviceId = await resolveCanonicalDeviceId({ deviceId, userId, tenantId });
  if (userId) {
    const [rows] = await getPool().query(
      `SELECT COALESCE(device_runtime_url, tunnel_url) AS tunnel_url,
              public_gateway_url, device_runtime_url, admin_recovery_url,
              connector_secret, user_id, tenant_id, device_id
         FROM \`local_connector_user_configs\`
        WHERE user_id = ? AND device_id = ? AND is_enabled = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId, deviceId]
    );
    if (rows[0]) return rows[0];
  }

  // Admin/service callers may address a governed device by device_id alone.
  // This keeps the auth facade usable like the direct connector action while
  // still resolving only from enabled registry rows.
  if (isAdmin) {
    const [rows] = await getPool().query(
      `SELECT tunnel_url, connector_secret, user_id, tenant_id, device_id
         FROM \`local_connector_user_configs\`
        WHERE device_id = ? AND is_enabled = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [deviceId]
    );
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

async function proxyToDevice(req, res, deviceId, targetPath) {
  const isUserAuth = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
  const isAdmin = req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true;
  let userId = isUserAuth ? req.auth.user_id : null;
  if (!userId && isAdmin) {
    userId = (req.query.user_id || req.body?.user_id || "").trim() || null;
  }
  if (!userId && !isAdmin) {
    return res.status(401).json({ ok: false, error: { code: "user_identity_required", message: "Sign-in or pass user_id for admin callers." } });
  }

  const device = await resolveDeviceTunnel(userId, deviceId, { isAdmin });
  if (!device) {
    return res.status(404).json({ ok: false, error: { code: "device_not_found", message: `No active connector found for device '${deviceId}'.` } });
  }
  if (!device.tunnel_url) {
    return res.status(503).json({ ok: false, error: { code: "tunnel_not_provisioned", message: "Device tunnel is not provisioned yet. Run /local-connector/install first." } });
  }

  const forwardedQuery = { ...req.query };
  delete forwardedQuery.user_id;
  const queryString = Object.keys(forwardedQuery).length
    ? "?" + new URLSearchParams(forwardedQuery).toString()
    : "";
  const url = `${device.tunnel_url}${targetPath}${queryString}`;

  const baseOptions = {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  };

  if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length) {
    const forwardedBody = { ...req.body };
    delete forwardedBody.user_id;
    baseOptions.body = JSON.stringify(forwardedBody);
  }

  // Current deployed connectors validate BACKEND_API_KEY. Some registry rows
  // also store a per-device connector_secret. Try the per-device secret first
  // and fall back to BACKEND_API_KEY only on auth failure so both generations
  // of connector agents remain usable from the governed auth facade.
  const candidateTokens = uniqueTruthy([device.connector_secret, process.env.BACKEND_API_KEY]);
  if (!candidateTokens.length) {
    return res.status(503).json({ ok: false, error: { code: "connector_auth_unconfigured", message: "No connector auth token is configured for this device proxy." } });
  }

  let last = null;
  for (let i = 0; i < candidateTokens.length; i += 1) {
    const options = {
      ...baseOptions,
      headers: { ...baseOptions.headers, Authorization: `Bearer ${candidateTokens[i]}` },
    };
    const attempt = await fetchConnectorJson(url, options);
    last = attempt;
    if (![401, 403].includes(attempt.response.status)) {
      return res.status(attempt.response.status).json(attempt.data);
    }
  }

  return res.status(last?.response?.status || 502).json({
    ok: false,
    error: {
      code: "connector_auth_failed",
      message: "Connector rejected all configured auth tokens for this device.",
      details: { url: redactUrlForError(url), device_id: deviceId },
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

  // ── GET /connector/:device_id/policy ─────────────────────────────────────
  router.get("/connector/:device_id/policy", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/policy");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── GET /connector/:device_id/health ──────────────────────────────────────
  router.get("/connector/:device_id/health", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/health");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/shell ──────────────────────────────────────
  router.post("/connector/:device_id/shell", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/shell");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/files ──────────────────────────────────────
  router.post("/connector/:device_id/files", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/files");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/fetch-upload ───────────────────────────────
  router.post("/connector/:device_id/dependencies", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/dependencies");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/apps", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/apps");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/browser", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/browser");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/ps", requireBackendApiKey, adminOnly, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/ps");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/win", requireBackendApiKey, adminOnly, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/win");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/n8n", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/n8n");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/cf", requireBackendApiKey, adminOnly, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/cf");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  router.post("/connector/:device_id/fetch-upload", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/fetch-upload");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/github ─────────────────────────────────────
  router.post("/connector/:device_id/github", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/github");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/gcloud ─────────────────────────────────────
  router.post("/connector/:device_id/gcloud", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/gcloud");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/shell-fetch-upload ─────────────────────────
  router.post("/connector/:device_id/shell-fetch-upload", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/shell-fetch-upload");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  return router;
}
