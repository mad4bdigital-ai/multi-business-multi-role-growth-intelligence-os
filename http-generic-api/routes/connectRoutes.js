import { Router } from "express";
import { getPool } from "../db.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import jwt from "jsonwebtoken";
import { provisionLocalConnectorInstall } from "./localConnectorInstallRoutes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONNECT_STATIC = join(__dirname, "../public/connect");

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const VALID_N8N_ACTIVATION_MODES = new Set(["managed_main_server", "self_hosted_local"]);

// ── Auth helpers ──────────────────────────────────────────────────────────────

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(403).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." } });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

// ── DB query helpers ──────────────────────────────────────────────────────────

async function fetchUser(userId) {
  const [rows] = await getPool().query(
    "SELECT user_id, email, display_name FROM `users` WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function fetchActiveMembership(userId) {
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role, t.display_name AS tenant_display_name
     FROM memberships m
     JOIN tenants t ON t.tenant_id = m.tenant_id
     WHERE m.user_id = ? AND m.status = 'active'
     ORDER BY m.granted_at ASC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function fetchTenantConnection(tenantId) {
  const [rows] = await getPool().query(
    "SELECT * FROM `tenant_backend_connections` WHERE tenant_id = ? LIMIT 1",
    [tenantId]
  );
  return rows[0] || null;
}

async function fetchUserDevices(userId, tenantId) {
  const [rows] = await getPool().query(
    "SELECT device_id, tunnel_url, is_enabled FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ?",
    [userId, tenantId]
  );
  return rows;
}

// ── HTML page ─────────────────────────────────────────────────────────────────

function buildConnectHtml(googleClientId) {
  return `<!doctype html>
<html lang="en" data-theme="light" data-type="manrope-inter" data-accent="default" data-density="comfortable">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>MAD4B · /connect</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/connect/assets/tokens.css"/>
</head>
<body>
  <div id="root"></div>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
  <script>window.__GOOGLE_CLIENT_ID__ = ${JSON.stringify(googleClientId)};</script>
  <script type="text/babel" src="/connect/assets/tweaks-panel.jsx"></script>
  <script type="text/babel" src="/connect/assets/core.jsx"></script>
  <script type="text/babel" src="/connect/assets/steps-1.jsx"></script>
  <script type="text/babel" src="/connect/assets/steps-2.jsx"></script>
  <script type="text/babel" src="/connect/assets/steps-2-hub.jsx"></script>
  <script type="text/babel" src="/connect/assets/steps-3.jsx"></script>
  <script type="text/babel" src="/connect/assets/steps-4.jsx"></script>
  <script type="text/babel" src="/connect/assets/evidence.jsx"></script>
  <script type="text/babel" src="/connect/assets/app.jsx"></script>
</body>
</html>`;
}

// ── Route builder ─────────────────────────────────────────────────────────────

export function buildConnectRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // Serve connect page static assets
  const ALLOWED_ASSETS = new Set(['tokens.css','tweaks-panel.jsx','core.jsx','steps-1.jsx','steps-2.jsx','steps-2-hub.jsx','steps-3.jsx','steps-4.jsx','evidence.jsx','app.jsx']);

  router.get("/connect/assets/:file", (req, res) => {
    const { file } = req.params;
    if (!ALLOWED_ASSETS.has(file)) return res.status(404).end();
    try {
      const content = readFileSync(join(CONNECT_STATIC, file));
      const ext = file.split('.').pop();
      res.setHeader('Content-Type', ext === 'css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(content);
    } catch {
      res.status(404).end();
    }
  });

  // GET /policy — tenant GPT governance scope (no auth required)
  router.get("/policy", (_req, res) => {
    return res.json({
      ok: true,
      scope: "tenant",
      version: "1.0",
      permitted_operations: [
        "auth.register — create a new tenant account (email + password)",
        "auth.login — sign in with email and password",
        "auth.google — sign in with a Google ID token from /connect page",
        "connect.status — check your tenant connection state (user JWT required)",
        "connect.activate — activate managed or dedicated backend connection (user JWT required)",
        "connect.device_install — provision local connector for your device (user JWT required)",
        "local_connector.install — full Cloudflare tunnel provisioning (user JWT required)",
        "local_connector.health — check connector reachability (user JWT required)",
        "app_connections — store encrypted Cloudflare / Hostinger credentials (user JWT required)",
      ],
      platform_admin_required: [
        "activation/* — platform bootstrap and session context (admin BACKEND_API_KEY only)",
        "dispatch — intent routing (admin BACKEND_API_KEY only)",
        "admin/* — admin CLI and control (admin BACKEND_API_KEY only)",
        "http-execute — governed HTTP executor (admin BACKEND_API_KEY only)",
      ],
      connection_modes: ["managed", "dedicated"],
      access_model: "Sign in via POST /auth/login, /auth/register, or /auth/google. Use the returned token as Authorization: Bearer <token> on all subsequent calls. For Google Sign-In, complete the flow at https://auth.mad4b.com/connect and use the token shown on the final step.",
      onboarding_url: "https://auth.mad4b.com/connect",
      activation_sequence: [
        "1. GET /policy — understand scope (no auth)",
        "2. POST /auth/login or /auth/register — get user JWT",
        "   OR: direct user to https://auth.mad4b.com/connect for Google Sign-In",
        "3. GET /connect/status — verify tenant connection with user JWT",
        "4. If not connected: POST /connect/activate with mode managed or dedicated",
      ],
    });
  });

  // GET /connect — serve HTML page (no auth required)
  router.get("/connect", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildConnectHtml(GOOGLE_CLIENT_ID));
  });

  // GET /connect/status — requires user JWT (web channel: no backend API key needed)
  router.get("/connect/status", requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const [user, membership] = await Promise.all([
        fetchUser(user_id),
        fetchActiveMembership(user_id),
      ]);
      if (!user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });

      const resolvedTenantId = tenant_id || membership?.tenant_id;
      const [connection, devices] = await Promise.all([
        resolvedTenantId ? fetchTenantConnection(resolvedTenantId) : Promise.resolve(null),
        resolvedTenantId ? fetchUserDevices(user_id, resolvedTenantId) : Promise.resolve([]),
      ]);

      return res.json({
        ok: true,
        user: { user_id: user.user_id, email: user.email, display_name: user.display_name },
        tenant: {
          tenant_id: resolvedTenantId || null,
          display_name: membership?.tenant_display_name || null,
          role: membership?.role || null,
        },
        connection: connection ? {
          mode: connection.connection_mode,
          status: connection.status,
          cloudflare_mode: connection.cloudflare_mode,
          google_auth_mode: connection.google_auth_mode,
          n8n_activation_mode: connection.n8n_activation_mode || "managed_main_server",
          device_count: connection.device_count,
          activated_at: connection.activated_at,
        } : { mode: null, status: null, cloudflare_mode: "managed", google_auth_mode: "managed", n8n_activation_mode: "managed_main_server", device_count: 0, activated_at: null },
        devices: devices.map(d => ({ device_id: d.device_id, tunnel_url: d.tunnel_url, is_enabled: Boolean(d.is_enabled) })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "status_failed", message: err.message } });
    }
  });

  // POST /connect/activate — requires user JWT
  router.post("/connect/activate", requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const { mode, cloudflare_mode, google_auth_mode, n8n_activation_mode = "managed_main_server", cf_api_token, cf_account_id, hostinger_api_key } = req.body || {};

      if (!mode || !["managed", "dedicated"].includes(mode)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_mode", message: "mode must be 'managed' or 'dedicated'." } });
      }
      if (!VALID_N8N_ACTIVATION_MODES.has(n8n_activation_mode)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_n8n_activation_mode", message: "n8n_activation_mode must be 'managed_main_server' or 'self_hosted_local'." } });
      }

      const membership = await fetchActiveMembership(user_id);
      const resolvedTenantId = tenant_id || membership?.tenant_id;
      if (!resolvedTenantId) {
        return res.status(403).json({ ok: false, error: { code: "no_tenant", message: "No active tenant found for this user." } });
      }

      const pool = getPool();

      // If dedicated + CF token provided: register in connected_systems (token not stored)
      if (mode === "dedicated" && cf_api_token) {
        const systemId = randomUUID();
        const configJson = JSON.stringify({ cf_account_id: cf_account_id || null, note: "CF API token must be set as CLOUDFLARE_API_TOKEN env var; not stored here." });
        await pool.query(
          `INSERT INTO \`connected_systems\` (system_id, tenant_id, system_key, display_name, provider_family, auth_type, service_mode, config_json, status)
           VALUES (?, ?, 'cloudflare_connector', 'Cloudflare (Dedicated)', 'cloudflare', 'api_token', 'self_serve', ?, 'active')
           ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), status = 'active', updated_at = NOW()`,
          [systemId, resolvedTenantId, configJson]
        );
      }

      // Upsert tenant_backend_connections
      const connectionId = randomUUID();
      const cfMode = cloudflare_mode || "managed";
      const gaMode = google_auth_mode || "managed";
      await pool.query(
        `INSERT INTO \`tenant_backend_connections\`
           (connection_id, tenant_id, connection_mode, cloudflare_mode, google_auth_mode, n8n_activation_mode, status, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE
           connection_mode = VALUES(connection_mode),
           cloudflare_mode = VALUES(cloudflare_mode),
           google_auth_mode = VALUES(google_auth_mode),
           n8n_activation_mode = VALUES(n8n_activation_mode),
           status = 'active',
           activated_at = COALESCE(activated_at, NOW()),
           updated_at = NOW()`,
        [connectionId, resolvedTenantId, mode, cfMode, gaMode, n8n_activation_mode]
      );

      const connection = await fetchTenantConnection(resolvedTenantId);
      return res.json({
        ok: true,
        connection: {
          mode: connection.connection_mode,
          status: connection.status,
          cloudflare_mode: connection.cloudflare_mode,
          google_auth_mode: connection.google_auth_mode,
          n8n_activation_mode: connection.n8n_activation_mode || n8n_activation_mode,
          device_count: connection.device_count,
          activated_at: connection.activated_at,
        },
        ...(mode === "dedicated" && cf_api_token ? { notice: "CF API token received but not stored in DB. Set it as CLOUDFLARE_API_TOKEN env var on your Cloud Run service." } : {}),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "activate_failed", message: err.message } });
    }
  });

  // POST /connect/device-install — requires user JWT
  router.post("/connect/device-install", requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const { device_id, hostname = null, cloudflare_connection_id = null, hostinger_connection_id = null, local_apps = [] } = req.body || {};

      if (!device_id || !/^[a-zA-Z0-9_-]{2,64}$/.test(device_id)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_device_id", message: "device_id must be 2-64 alphanumeric/dash/underscore characters." } });
      }

      // Validate tenant membership
      const membership = await fetchActiveMembership(user_id);
      const resolvedTenantId = tenant_id || membership?.tenant_id;
      if (!resolvedTenantId) {
        return res.status(403).json({ ok: false, error: { code: "no_tenant", message: "No active tenant found for this user." } });
      }

      const connection = await fetchTenantConnection(resolvedTenantId);
      const useManagedProvisioning = (connection?.cloudflare_mode || "managed") === "managed";
      const result = await provisionLocalConnectorInstall(req, {
        user_id,
        tenant_id: resolvedTenantId,
        device_id,
        hostname,
        cloudflare_connection_id,
        hostinger_connection_id,
        local_apps,
        provisioning_credential_mode: useManagedProvisioning ? "managed" : "dedicated",
      });
      await getPool().query(
        "UPDATE `tenant_backend_connections` SET device_count = (SELECT COUNT(*) FROM `local_connector_user_configs` WHERE tenant_id = ? AND is_enabled = 1) WHERE tenant_id = ?",
        [resolvedTenantId, resolvedTenantId]
      );
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "device_install_failed", message: err.message } });
    }
  });

  // POST /connect/preferences — save tenant onboarding preferences
  router.post("/connect/preferences", requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const membership = await fetchActiveMembership(user_id);
      const resolvedTenantId = tenant_id || membership?.tenant_id;
      if (!resolvedTenantId) return res.status(403).json({ ok: false, error: { code: "no_tenant", message: "No active tenant." } });
      const prefs = req.body || {};
      await getPool().query(
        `UPDATE \`tenants\` SET metadata_json = JSON_SET(COALESCE(metadata_json, '{}'), '$.onboarding_preferences', CAST(? AS JSON)), updated_at = NOW() WHERE tenant_id = ?`,
        [JSON.stringify(prefs), resolvedTenantId]
      );
      return res.status(201).json({ ok: true, tenant_id: resolvedTenantId });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "preferences_failed", message: err.message } });
    }
  });

  // POST /connect/profile — save tenant business profile
  router.post("/connect/profile", requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const membership = await fetchActiveMembership(user_id);
      const resolvedTenantId = tenant_id || membership?.tenant_id;
      if (!resolvedTenantId) return res.status(403).json({ ok: false, error: { code: "no_tenant", message: "No active tenant." } });
      const profile = req.body || {};
      await getPool().query(
        `UPDATE \`tenants\` SET metadata_json = JSON_SET(COALESCE(metadata_json, '{}'), '$.business_profile', CAST(? AS JSON)), updated_at = NOW() WHERE tenant_id = ?`,
        [JSON.stringify(profile), resolvedTenantId]
      );
      return res.status(201).json({ ok: true, tenant_id: resolvedTenantId });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "profile_failed", message: err.message } });
    }
  });

  return router;
}
