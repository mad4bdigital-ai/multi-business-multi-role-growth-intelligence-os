import { Router } from "express";
import { getPool } from "../db.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import jwt from "jsonwebtoken";
import { provisionLocalConnectorInstall } from "./localConnectorInstallRoutes.js";
import {
  activationModeCatalog,
  resolveActivationModePolicy,
  CANONICAL_CONNECTION_MODES,
} from "../activationModePolicy.js";
import {
  assessDedicatedIntegrationReadiness,
  dedicatedIntegrationCatalog,
} from "../dedicatedIntegrationPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONNECT_STATIC = join(__dirname, "../public/connect");

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

// Fields accepted by POST /connect/preferences. Anything outside this list is
// dropped server-side, so a frontend regression cannot start saving arbitrary
// blobs to tenants.metadata_json.onboarding_preferences. Add new keys here.
const PREFERENCES_FIELD_ALLOWLIST = new Set([
  "tz", "language", "currency", "comms", "tone", "hours", "goals", "notify",
  "niches", "networks", "perks", "seats", "services",
]);

// Fields accepted by POST /connect/profile. Same drop-rule as preferences.
// cmsKey, application_password, api_key, secret, token, credential -- and any
// key containing those substrings -- are also stripped by the secret blocklist.
const BUSINESS_PROFILE_FIELD_ALLOWLIST = new Set([
  "bizType", "industry", "brandVoice", "tagline", "story", "audience",
  "locations", "products", "socials", "cms", "cmsUrl", "analytics",
]);

const SECRET_KEY_SUBSTRINGS = [
  "password", "passwd", "secret", "token", "credential", "private_key",
  "api_key", "apikey", "auth_key", "authkey", "cmskey", "appkey", "app_key",
  "client_secret", "access_token", "refresh_token", "encrypted",
];

const PROFILE_MAX_BYTES = 65536; // 64 KiB upper bound for metadata_json payloads

function isSensitiveKey(key) {
  const lower = String(key || "").toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((s) => lower.includes(s));
}

// Drop tenant_id (auth-derived only) plus any key matching the sensitive
// pattern, then restrict to the allowlist if one is supplied. Returns the
// sanitized object and a list of dropped/forbidden keys so the route can
// echo a clear notice without exposing the raw values.
function sanitizeMetadataPayload(rawBody, allowlist = null) {
  const source = (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) ? rawBody : {};
  const sanitized = {};
  const dropped = [];

  for (const [key, value] of Object.entries(source)) {
    if (key === "tenant_id" || key === "user_id") { dropped.push(key); continue; }
    if (isSensitiveKey(key)) { dropped.push(key); continue; }
    if (allowlist && !allowlist.has(key)) { dropped.push(key); continue; }
    sanitized[key] = value;
  }

  return { sanitized, dropped };
}

export function _testingSanitizeMetadataPayload(rawBody, allowlist) {
  return sanitizeMetadataPayload(rawBody, allowlist);
}
export const _testingAllowlists = {
  PREFERENCES_FIELD_ALLOWLIST,
  BUSINESS_PROFILE_FIELD_ALLOWLIST,
  SECRET_KEY_SUBSTRINGS,
  PROFILE_MAX_BYTES,
};

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
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." } });
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

async function fetchActiveMemberships(userId) {
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.granted_at ASC`,
    [userId]
  );
  return rows;
}

function workspaceDisplayName(value, user) {
  const cleaned = String(value || "").trim().slice(0, 120);
  if (cleaned) return cleaned;
  return `${user?.display_name || user?.email || "User"}'s workspace`;
}

function buildOnboardingState({ resolvedTenantId, connection, devices = [] }) {
  if (!resolvedTenantId) {
    return {
      state: "workspace_required",
      workspace_required: true,
      allowed_actions: ["create_workspace", "escalate"],
    };
  }
  if (!connection) {
    return {
      state: "workspace_ready_not_activated",
      workspace_required: false,
      allowed_actions: ["activate", "escalate"],
    };
  }
  if (!devices.length) {
    return {
      state: "activated_no_device",
      workspace_required: false,
      allowed_actions: ["install_device", "escalate"],
    };
  }
  return {
    state: "healthy",
    workspace_required: false,
    allowed_actions: ["open_gpt", "install_device", "escalate"],
  };
}

async function resolveConnectState(userId, jwtTenantId = null) {
  const [user, memberships] = await Promise.all([
    fetchUser(userId),
    fetchActiveMemberships(userId),
  ]);
  if (!user) return { user: null };

  const activeMembership = jwtTenantId
    ? memberships.find((m) => m.tenant_id === jwtTenantId) || memberships[0] || null
    : memberships[0] || null;
  const resolvedTenantId = jwtTenantId || activeMembership?.tenant_id || null;
  const [connection, devices] = await Promise.all([
    resolvedTenantId ? fetchTenantConnection(resolvedTenantId) : Promise.resolve(null),
    resolvedTenantId ? fetchUserDevices(userId, resolvedTenantId) : Promise.resolve([]),
  ]);
  const dedicatedIntegrationReadiness = resolvedTenantId
    ? await assessDedicatedIntegrationReadiness({ tenantId: resolvedTenantId, userId, connection })
    : null;
  return {
    user,
    memberships,
    membership: activeMembership,
    resolvedTenantId,
    connection,
    devices,
    dedicatedIntegrationReadiness,
    onboarding: buildOnboardingState({ resolvedTenantId, connection, devices }),
  };
}

async function createWorkspaceForUser({ userId, displayName = null, source = "connect_workspace_create" } = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userRows] = await connection.query(
      "SELECT user_id, email, display_name FROM `users` WHERE user_id = ? AND status = 'active' LIMIT 1",
      [userId]
    );
    const user = userRows[0];
    if (!user) {
      const err = new Error("User not found or inactive.");
      err.status = 404;
      err.code = "user_not_found";
      throw err;
    }

    const [existing] = await connection.query(
      `SELECT m.tenant_id, m.role, t.display_name AS tenant_display_name
         FROM memberships m
         JOIN tenants t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY m.granted_at ASC
        LIMIT 1`,
      [userId]
    );
    if (existing[0]) {
      await connection.commit();
      return { created: false, user, tenant_id: existing[0].tenant_id, display_name: existing[0].tenant_display_name, role: existing[0].role };
    }

    const tenantId = randomUUID();
    const tenantName = workspaceDisplayName(displayName, user);
    await connection.query(
      `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
       VALUES (?, 'managed_client_account', ?, 'active', ?)`,
      [tenantId, tenantName, JSON.stringify({ source, user_id: userId })]
    );
    await connection.query(
      `INSERT INTO \`memberships\` (user_id, tenant_id, role, status)
       VALUES (?, ?, 'owner', 'active')`,
      [userId, tenantId]
    );
    await connection.query(
      `UPDATE \`onboarding_escalations\`
          SET tenant_id = COALESCE(tenant_id, ?), status = IF(status = 'open', 'in_review', status)
        WHERE user_id = ? AND tenant_id IS NULL`,
      [tenantId, userId]
    ).catch(() => {});
    await connection.commit();
    return { created: true, user, tenant_id: tenantId, display_name: tenantName, role: "owner" };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

function cleanEscalationPriority(value) {
  const normalized = String(value || "urgent").trim().toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(normalized) ? normalized : "urgent";
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

async function createOnboardingEscalation({ user, tenantId = null, title, body, priority, source = "connect", metadata = {} }) {
  const escalationId = randomUUID();
  const finalTitle = String(title || "Tenant onboarding escalation").trim().slice(0, 512);
  const finalPriority = cleanEscalationPriority(priority);
  const meta = JSON.stringify({ ...safeMetadata(metadata), onboarding_source: source });
  let ticketId = null;

  if (tenantId) {
    ticketId = randomUUID();
    await getPool().query(
      `INSERT INTO \`tickets\` (ticket_id, tenant_id, title, category, priority, service_mode, metadata_json)
       VALUES (?, ?, ?, 'escalation', ?, 'managed', ?)`,
      [ticketId, tenantId, finalTitle, finalPriority, JSON.stringify({ body: body || null, source, metadata: safeMetadata(metadata) })]
    );
  }

  await getPool().query(
    `INSERT INTO \`onboarding_escalations\`
       (escalation_id, tenant_id, user_id, email, title, body, category, priority, status, source, metadata_json, ticket_id)
     VALUES (?, ?, ?, ?, ?, ?, 'escalation', ?, 'open', ?, ?, ?)`,
    [escalationId, tenantId || null, user?.user_id || null, user?.email || null, finalTitle, body || null, finalPriority, source, meta, ticketId]
  );

  return { escalation_id: escalationId, ticket_id: ticketId, title: finalTitle, priority: finalPriority, tenant_id: tenantId || null };
}

// ── HTML page ─────────────────────────────────────────────────────────────────

function buildConnectHtml(googleClientId) {
  return `<!doctype html>
<html lang="en" data-theme="light" data-type="manrope-inter" data-accent="default" data-density="comfortable">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Growth Intelligence Platform · Connect</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/connect/assets/tokens.css"/>
</head>
<body>
  <div id="root">
    <footer style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5;padding:20px;text-align:center;color:#3a3a3d">
      <strong>Growth Intelligence Platform</strong>
      <span aria-hidden="true"> · </span>
      <a href="/privacy-policy">Privacy Policy</a>
      <span aria-hidden="true"> · </span>
      <a href="/terms-of-use">Terms of Use</a>
    </footer>
  </div>
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
  const ALLOWED_ASSETS = new Set([
    'tokens.css',
    'tweaks-panel.jsx',
    'core.jsx',
    'steps-1.jsx',
    'steps-2.jsx',
    'steps-2-hub.jsx',
    'steps-3.jsx',
    'steps-4.jsx',
    'evidence.jsx',
    'app.jsx',
    'mad4b-logo-1080.png'
  ]);

  router.get("/connect/assets/:file", (req, res) => {
    const { file } = req.params;
    if (!ALLOWED_ASSETS.has(file)) return res.status(404).end();
    try {
      const content = readFileSync(join(CONNECT_STATIC, file));
      const ext = file.split('.').pop();
      const contentType = ext === 'css'
        ? 'text/css; charset=utf-8'
        : ext === 'png'
          ? 'image/png'
          : 'text/javascript; charset=utf-8';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', ext === 'png' ? 'public, max-age=86400' : 'no-cache');
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
      connection_modes: CANONICAL_CONNECTION_MODES,
      activation_mode_catalog: activationModeCatalog(),
      dedicated_integration_catalog: dedicatedIntegrationCatalog(),
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
      const state = await resolveConnectState(req.auth.user_id, req.auth.tenant_id || null);
      if (!state.user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });

      return res.json({
        ok: true,
        user: { user_id: state.user.user_id, email: state.user.email, display_name: state.user.display_name },
        tenant: state.resolvedTenantId ? {
          tenant_id: state.resolvedTenantId,
          display_name: state.membership?.tenant_display_name || null,
          role: state.membership?.role || null,
        } : null,
        memberships_count: state.memberships.length,
        memberships: state.memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role, display_name: m.tenant_display_name })),
        onboarding: state.onboarding,
        activation_mode_catalog: activationModeCatalog(),
        dedicated_integration_catalog: dedicatedIntegrationCatalog(),
        dedicated_integration_readiness: state.dedicatedIntegrationReadiness,
        connection: state.connection ? {
          mode: state.connection.connection_mode,
          status: state.connection.status,
          cloudflare_mode: state.connection.cloudflare_mode,
          google_auth_mode: state.connection.google_auth_mode,
          n8n_activation_mode: state.connection.n8n_activation_mode || "managed_main_server",
          device_count: state.connection.device_count,
          activated_at: state.connection.activated_at,
        } : null,
        devices: state.devices.map(d => ({ device_id: d.device_id, tunnel_url: d.tunnel_url, is_enabled: Boolean(d.is_enabled) })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "status_failed", message: err.message } });
    }
  });

  // GET /connect/onboarding-state — explicit no-tenant-safe onboarding state.
  router.get("/connect/onboarding-state", requireUserJwt, async (req, res) => {
    try {
      const state = await resolveConnectState(req.auth.user_id, req.auth.tenant_id || null);
      if (!state.user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });
      return res.status(200).json({
        ok: true,
        user: { user_id: state.user.user_id, email: state.user.email, display_name: state.user.display_name },
        tenant_id: state.resolvedTenantId || null,
        onboarding: state.onboarding,
        memberships_count: state.memberships.length,
        allowed_actions: state.onboarding.allowed_actions,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "onboarding_state_failed", message: err.message } });
    }
  });

  // POST /connect/workspace — idempotently create a workspace for a signed-in user with no tenant.
  router.post("/connect/workspace", requireUserJwt, async (req, res) => {
    try {
      const created = await createWorkspaceForUser({
        userId: req.auth.user_id,
        displayName: req.body?.display_name || req.body?.tenant_display_name,
        source: "connect_workspace_create",
      });
      return res.status(created.created ? 201 : 200).json({
        ok: true,
        created: created.created,
        tenant: { tenant_id: created.tenant_id, display_name: created.display_name, role: created.role },
        onboarding: { state: "workspace_ready_not_activated", workspace_required: false, allowed_actions: ["activate", "escalate"] },
        next_action: "connect_activate",
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_create_failed", message: err.message } });
    }
  });

  // POST /connect/escalate — tenantless-safe escalation path for onboarding failures.
  router.post("/connect/escalate", requireUserJwt, async (req, res) => {
    try {
      const state = await resolveConnectState(req.auth.user_id, req.auth.tenant_id || null);
      if (!state.user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });
      const escalation = await createOnboardingEscalation({
        user: state.user,
        tenantId: state.resolvedTenantId || null,
        title: req.body?.title || "Tenant onboarding escalation",
        body: req.body?.body || req.body?.message || null,
        priority: req.body?.priority || "urgent",
        source: "connect_escalate",
        metadata: {
          ...(safeMetadata(req.body?.metadata_json)),
          onboarding: state.onboarding,
          memberships_count: state.memberships.length,
        },
      });
      return res.status(201).json({ ok: true, escalation, onboarding: state.onboarding });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connect_escalate_failed", message: err.message } });
    }
  });

  // GET /me and /me/workspaces — minimal tenant control-plane identity package.
  router.get("/me", requireUserJwt, async (req, res) => {
    try {
      const state = await resolveConnectState(req.auth.user_id, req.auth.tenant_id || null);
      if (!state.user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });
      return res.status(200).json({
        ok: true,
        user: { user_id: state.user.user_id, email: state.user.email, display_name: state.user.display_name },
        tenant_id: state.resolvedTenantId || null,
        onboarding: state.onboarding,
        memberships: state.memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role, display_name: m.tenant_display_name })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "me_read_failed", message: err.message } });
    }
  });

  router.get("/me/workspaces", requireUserJwt, async (req, res) => {
    try {
      const memberships = await fetchActiveMemberships(req.auth.user_id);
      return res.status(200).json({
        ok: true,
        workspaces: memberships.map((m) => ({ tenant_id: m.tenant_id, display_name: m.tenant_display_name, role: m.role })),
        count: memberships.length,
        onboarding: memberships.length ? { state: "workspace_ready", workspace_required: false } : { state: "workspace_required", workspace_required: true, allowed_actions: ["create_workspace", "escalate"] },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspaces_list_failed", message: err.message } });
    }
  });

  router.post("/me/workspaces", requireUserJwt, async (req, res) => {
    try {
      const created = await createWorkspaceForUser({
        userId: req.auth.user_id,
        displayName: req.body?.display_name || req.body?.tenant_display_name,
        source: "me_workspaces_create",
      });
      return res.status(created.created ? 201 : 200).json({ ok: true, created: created.created, workspace: { tenant_id: created.tenant_id, display_name: created.display_name, role: created.role } });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_create_failed", message: err.message } });
    }
  });

  router.get("/me/capabilities", requireUserJwt, async (req, res) => {
    try {
      const state = await resolveConnectState(req.auth.user_id, req.auth.tenant_id || null);
      if (!state.user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });
      const capabilities = state.resolvedTenantId
        ? ["connect_activate", "connect_device_install", "support_ticket_create", "local_gateway_tools_list"]
        : [];
      return res.status(200).json({
        ok: true,
        tenant_id: state.resolvedTenantId || null,
        onboarding: state.onboarding,
        capabilities,
        next_actions: state.onboarding.allowed_actions,
        activation_mode_catalog: activationModeCatalog(),
        dedicated_integration_catalog: dedicatedIntegrationCatalog(),
        dedicated_integration_readiness: state.dedicatedIntegrationReadiness,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "capabilities_read_failed", message: err.message } });
    }
  });

  // POST /connect/activate — requires user JWT
  router.post("/connect/activate", requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const { cf_api_token, cf_account_id, hostinger_api_key } = req.body || {};
      let modePolicy;
      try {
        modePolicy = resolveActivationModePolicy(req.body || {});
      } catch (modeErr) {
        return res.status(modeErr.status || 400).json({
          ok: false,
          error: {
            code: modeErr.code || "invalid_activation_mode",
            message: modeErr.message,
            details: modeErr.details || activationModeCatalog(),
          },
        });
      }
      const { mode, cloudflare_mode, google_auth_mode, n8n_activation_mode } = modePolicy;

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
      const dedicatedIntegrationReadiness = await assessDedicatedIntegrationReadiness({
        tenantId: resolvedTenantId,
        userId: user_id,
        connection,
      });
      return res.json({
        ok: true,
        mode_policy: modePolicy,
        dedicated_integration_catalog: dedicatedIntegrationCatalog(),
        dedicated_integration_readiness: dedicatedIntegrationReadiness,
        next_actions: dedicatedIntegrationReadiness?.ready === false
          ? dedicatedIntegrationReadiness.next_actions
          : ["connect_device_install"],
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
      const { hostname = null, cloudflare_connection_id = null, hostinger_connection_id = null, local_apps = [] } = req.body || {};
      const device_id = String(req.body?.device_id || "").trim().toLowerCase();

      if (!device_id || !/^[a-z0-9-]{2,32}$/.test(device_id)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_device_id", message: "device_id must be 2-32 lowercase letters, numbers, or hyphens." } });
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

      const { sanitized, dropped } = sanitizeMetadataPayload(req.body, PREFERENCES_FIELD_ALLOWLIST);
      const serialized = JSON.stringify(sanitized);
      if (Buffer.byteLength(serialized, "utf8") > PROFILE_MAX_BYTES) {
        return res.status(413).json({ ok: false, error: { code: "preferences_too_large", message: `Preferences payload exceeds ${PROFILE_MAX_BYTES} bytes.` } });
      }

      await getPool().query(
        `UPDATE \`tenants\` SET metadata_json = JSON_SET(COALESCE(metadata_json, '{}'), '$.onboarding_preferences', CAST(? AS JSON)), updated_at = NOW() WHERE tenant_id = ?`,
        [serialized, resolvedTenantId]
      );
      return res.status(201).json({ ok: true, tenant_id: resolvedTenantId, dropped_fields: dropped });
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

      const { sanitized, dropped } = sanitizeMetadataPayload(req.body, BUSINESS_PROFILE_FIELD_ALLOWLIST);
      const serialized = JSON.stringify(sanitized);
      if (Buffer.byteLength(serialized, "utf8") > PROFILE_MAX_BYTES) {
        return res.status(413).json({ ok: false, error: { code: "profile_too_large", message: `Business profile payload exceeds ${PROFILE_MAX_BYTES} bytes. CMS credentials must use the CMS claim flow (/connect/api/cms/claims), not the profile blob.` } });
      }

      await getPool().query(
        `UPDATE \`tenants\` SET metadata_json = JSON_SET(COALESCE(metadata_json, '{}'), '$.business_profile', CAST(? AS JSON)), updated_at = NOW() WHERE tenant_id = ?`,
        [serialized, resolvedTenantId]
      );
      return res.status(201).json({ ok: true, tenant_id: resolvedTenantId, dropped_fields: dropped });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "profile_failed", message: err.message } });
    }
  });

  return router;
}
