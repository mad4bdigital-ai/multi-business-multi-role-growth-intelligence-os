import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const DEVICE_LINK_TTL_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 3;
const DEVICE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const PLATFORM_MANAGED_N8N_URL = "https://n8n.mad4b.com/";

function nowMs() {
  return Date.now();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomDisplayCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function cleanId(value, { fallback = "", max = 128 } = {}) {
  const raw = String(value || "").trim().slice(0, max);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function jsonString(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "{}";
  }
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function getBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  const host = req.get("host") || "auth.mad4b.com";
  return (process.env.PUBLIC_BASE_URL || `${proto}://${host}`).replace(/\/$/, "");
}

function defaultN8nProfile({ device }) {
  const tenantSlug = cleanId(device.tenant_id || "tenant", { fallback: "tenant", max: 64 });
  const userSlug = cleanId(device.user_id || "user", { fallback: "user", max: 64 });
  return {
    profile_source: "default_local_profile",
    lifecycle_mode: "local_manager_autopilot",
    install_mode: "npm_global_if_missing",
    local_only: true,
    command_path: "D:\\npm-global\\n8n.cmd",
    npm_prefix: "D:\\npm-global",
    user_folder: `D:\\Mad4B\\Tenants\\${tenantSlug}\\Users\\${userSlug}\\n8n-data`,
    local_url: "http://127.0.0.1:5678/",
    public_url: "",
    port: 5678,
    listen_address: "127.0.0.1",
    editor_base_url: "http://127.0.0.1:5678/",
    webhook_url: "http://127.0.0.1:5678/",
    secrets_included: false,
  };
}

function sanitizeN8nProfileConfig(value, { device }) {
  const fallback = defaultN8nProfile({ device });
  const cfg = parseJson(value) || {};
  const requestedPublicUrl = cleanText(cfg.public_url || cfg.tunnel_url || "", 255);
  const publicUrl = requestedPublicUrl.replace(/\/$/, "") === PLATFORM_MANAGED_N8N_URL.replace(/\/$/, "") ? "" : requestedPublicUrl;
  const localUrl = cleanText(cfg.local_url || fallback.local_url, 255) || fallback.local_url;
  const port = Math.min(Math.max(parseInt(cfg.port || fallback.port, 10) || fallback.port, 1024), 65535);
  const listenAddress = cleanText(cfg.listen_address || fallback.listen_address, 64) || fallback.listen_address;
  const userFolder = cleanText(cfg.user_folder || fallback.user_folder, 260) || fallback.user_folder;
  const commandPath = cleanText(cfg.command_path || fallback.command_path, 260) || fallback.command_path;
  const editorBaseUrl = cleanText(cfg.editor_base_url || publicUrl || localUrl, 255) || localUrl;
  const webhookUrl = cleanText(cfg.webhook_url || publicUrl || localUrl, 255) || localUrl;
  return {
    ...fallback,
    profile_source: cfg.profile_source || "connected_systems",
    lifecycle_mode: cleanText(cfg.lifecycle_mode || fallback.lifecycle_mode, 80) || fallback.lifecycle_mode,
    install_mode: cleanText(cfg.install_mode || fallback.install_mode, 80) || fallback.install_mode,
    local_only: cfg.local_only !== false,
    command_path: commandPath,
    npm_prefix: cleanText(cfg.npm_prefix || fallback.npm_prefix, 260) || fallback.npm_prefix,
    user_folder: userFolder,
    local_url: localUrl,
    public_url: publicUrl,
    port,
    listen_address: listenAddress,
    editor_base_url: editorBaseUrl,
    webhook_url: webhookUrl,
    secrets_included: false,
  };
}

async function resolveOrCreateTenantN8nProfile(device) {
  const pool = getPool();
  const systemKey = `local_n8n:${cleanId(device.device_id, { fallback: "device", max: 64 })}`;
  const [rows] = await pool.query(
    `SELECT cs.*, i.installation_id, i.meta_json AS installation_meta_json
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
        AND i.tenant_id = cs.tenant_id
        AND i.status = 'active'
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.user_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.device_id')) = ?
      WHERE cs.tenant_id = ?
        AND cs.system_key = ?
        AND cs.provider_family = 'n8n'
        AND cs.status IN ('active','pending')
      ORDER BY FIELD(cs.status, 'active', 'pending'), cs.updated_at DESC
      LIMIT 1`,
    [device.user_id, device.device_id, device.tenant_id || "", systemKey]
  );
  if (rows[0]) {
    return {
      system_id: rows[0].system_id,
      installation_id: rows[0].installation_id || null,
      display_name: rows[0].display_name,
      status: rows[0].status,
      profile: sanitizeN8nProfileConfig(rows[0].config_json, { device }),
      created: false,
    };
  }

  const systemId = crypto.randomUUID();
  const installationId = crypto.randomUUID();
  const profile = defaultN8nProfile({ device });
  await pool.query(
    `INSERT INTO \`connected_systems\`
      (system_id, tenant_id, system_key, display_name, provider_family, provider_domain, connector_family, auth_type, service_mode, self_serve_capable, assisted_capable, managed_capable, status, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'n8n', 'n8n.io', 'local_desktop', 'local_manual', 'self_serve', 1, 0, 0, 'active', ?, NOW(), NOW())`,
    [systemId, device.tenant_id || "", systemKey, "Local n8n", jsonString(profile)]
  );
  await pool.query(
    `INSERT INTO \`installations\`
      (installation_id, system_id, tenant_id, scope, credential_ref, status, installed_at, expires_at, meta_json)
     VALUES (?, ?, ?, 'local_device', NULL, 'active', NOW(), NULL, ?)`,
    [installationId, systemId, device.tenant_id || "", jsonString({ user_id: device.user_id, device_id: device.device_id, autopilot_enabled: true, local_only: true, writes_local_files: true, secrets_included: false })]
  );
  return { system_id: systemId, installation_id: installationId, display_name: "Local n8n", status: "active", profile, created: true };
}

async function ensureDeviceLinkTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS \`local_manager_device_link_sessions\` (
      \`session_id\` VARCHAR(64) NOT NULL,
      \`display_code\` VARCHAR(16) NOT NULL,
      \`display_code_hash\` VARCHAR(64) NOT NULL,
      \`poll_token_hash\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(24) NOT NULL DEFAULT 'pending',
      \`device_id\` VARCHAR(128) NOT NULL,
      \`hostname\` VARCHAR(255) NULL,
      \`platform\` VARCHAR(32) NULL,
      \`app_version\` VARCHAR(80) NULL,
      \`user_id\` VARCHAR(64) NULL,
      \`tenant_id\` VARCHAR(64) NULL,
      \`approved_at\` DATETIME NULL,
      \`completed_at\` DATETIME NULL,
      \`expires_at\` DATETIME NOT NULL,
      \`metadata_json\` JSON NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`session_id\`),
      UNIQUE KEY \`uq_local_manager_display_code_hash\` (\`display_code_hash\`),
      KEY \`idx_local_manager_device_link_status\` (\`status\`, \`expires_at\`),
      KEY \`idx_local_manager_device_link_owner\` (\`user_id\`, \`tenant_id\`),
      KEY \`idx_local_manager_device_link_device\` (\`device_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function sanitizeSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    status: row.status,
    device_id: row.device_id,
    hostname: row.hostname || null,
    platform: row.platform || null,
    app_version: row.app_version || null,
    user_id: row.user_id || null,
    tenant_id: row.tenant_id || null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    metadata: parseJson(row.metadata_json),
  };
}

async function fetchUserMembership({ userId, tenantId = null }) {
  const pool = getPool();
  const [userRows] = await pool.query(
    `SELECT user_id, email, display_name, status FROM \`users\` WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const user = userRows[0] || null;
  if (!user || user.status !== "active") return null;

  if (tenantId) {
    const [rows] = await pool.query(
      `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
         FROM \`memberships\` m
         LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ? AND m.tenant_id = ? AND m.status = 'active'
        LIMIT 1`,
      [userId, tenantId]
    );
    return rows[0] ? { user, membership: rows[0] } : null;
  }

  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM \`memberships\` m
       LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    [userId]
  );
  return rows[0] ? { user, membership: rows[0] } : { user, membership: { tenant_id: null, role: null, status: null, tenant_display_name: null } };
}

async function resolveCanonicalConnectorConfig({ userId, tenantId, deviceId, hostname }) {
  const pool = getPool();
  const candidateIds = [...new Set([deviceId, hostname].map((value) => cleanId(value, { max: 128 })).filter(Boolean))];

  if (candidateIds.length) {
    const placeholders = candidateIds.map(() => "?").join(", ");
    const [exactRows] = await pool.query(
      `SELECT config_id, user_id, tenant_id, device_id
         FROM \`local_connector_user_configs\`
        WHERE is_enabled = 1
          AND user_id = ?
          AND device_id IN (${placeholders})
        ORDER BY CASE WHEN tenant_id = ? THEN 0 WHEN tenant_id = '00000000-0000-0000-0000-000000000000' THEN 1 ELSE 2 END,
                 COALESCE(last_health_at, updated_at, created_at) DESC
        LIMIT 1`,
      [userId, ...candidateIds, tenantId || ""]
    );
    if (exactRows[0]) return exactRows[0];
  }

  const [fallbackRows] = await pool.query(
    `SELECT config_id, user_id, tenant_id, device_id
       FROM \`local_connector_user_configs\`
      WHERE is_enabled = 1
        AND user_id = ?
        AND (? IS NULL OR tenant_id = ? OR tenant_id = '00000000-0000-0000-0000-000000000000')
        AND COALESCE(tunnel_url, public_gateway_url, device_runtime_url, admin_recovery_url) IS NOT NULL
      ORDER BY CASE WHEN tenant_id = ? THEN 0 WHEN tenant_id = '00000000-0000-0000-0000-000000000000' THEN 1 ELSE 2 END,
               COALESCE(last_health_at, updated_at, created_at) DESC
      LIMIT 2`,
    [userId, tenantId || null, tenantId || null, tenantId || ""]
  );

  return fallbackRows.length === 1 ? fallbackRows[0] : null;
}

async function upsertConnectorAlias({ aliasDeviceId, canonical, principal }) {
  const pool = getPool();
  const alias = cleanId(aliasDeviceId, { max: 128 });
  const canonicalDeviceId = cleanId(canonical?.device_id, { max: 128 });
  if (!alias || !canonicalDeviceId || alias.toLowerCase() === canonicalDeviceId.toLowerCase()) return null;

  const reason = "Auto-created from Local Manager device-link approval so app hostname/device id resolves to the executable local connector device.";
  const [updateResult] = await pool.query(
    `UPDATE \`local_connector_device_aliases\`
        SET canonical_device_id = ?, canonical_config_id = ?, user_id = ?, tenant_id = ?, reason = ?, status = 'active', updated_at = NOW()
      WHERE alias_device_id = ?
        AND (user_id = ? OR user_id IS NULL)
      LIMIT 1`,
    [canonicalDeviceId, canonical.config_id, principal.user_id, principal.tenant_id || null, reason, alias, principal.user_id]
  );

  if (!Number(updateResult?.affectedRows || 0)) {
    await pool.query(
      `INSERT INTO \`local_connector_device_aliases\`
        (alias_device_id, canonical_device_id, canonical_config_id, user_id, tenant_id, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
      [alias, canonicalDeviceId, canonical.config_id, principal.user_id, principal.tenant_id || null, reason]
    );
  }

  return {
    alias_device_id: alias,
    canonical_device_id: canonicalDeviceId,
    canonical_config_id: canonical.config_id,
    status: "active",
  };
}

async function ensureLocalConnectorAliasForDeviceLink({ session, principal }) {
  try {
    const canonical = await resolveCanonicalConnectorConfig({
      userId: principal.user_id,
      tenantId: principal.tenant_id,
      deviceId: session.device_id,
      hostname: session.hostname,
    });
    if (!canonical) {
      return { attempted: true, resolved: false, reason: "canonical_connector_config_not_found", secrets_included: false };
    }

    const aliasInputs = [...new Set([session.device_id, session.hostname].filter(Boolean))];
    const aliases = [];
    for (const aliasDeviceId of aliasInputs) {
      const alias = await upsertConnectorAlias({ aliasDeviceId, canonical, principal });
      if (alias) aliases.push(alias);
    }

    return {
      attempted: true,
      resolved: true,
      canonical_device_id: canonical.device_id,
      canonical_config_id: canonical.config_id,
      aliases,
      secrets_included: false,
    };
  } catch (err) {
    return {
      attempted: true,
      resolved: false,
      reason: "connector_alias_upsert_failed",
      error: { code: err?.code || "connector_alias_upsert_failed", message: err?.message || String(err) },
      secrets_included: false,
    };
  }
}

export async function requireLocalManagerUser(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    const err = new Error("A signed-in user token is required.");
    err.status = 401;
    err.code = "user_jwt_required";
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error("User token is invalid or expired.");
    err.status = 401;
    err.code = "invalid_user_jwt";
    throw err;
  }

  const userId = cleanText(payload.user_id, 64);
  if (!userId) {
    const err = new Error("User token is missing user_id.");
    err.status = 401;
    err.code = "invalid_user_jwt";
    throw err;
  }
  const tenantId = cleanText(payload.tenant_id, 64) || null;
  const resolved = await fetchUserMembership({ userId, tenantId });
  if (!resolved) {
    const err = new Error("Active user membership was not found.");
    err.status = 403;
    err.code = "tenant_membership_required";
    throw err;
  }

  return {
    user_id: resolved.user.user_id,
    email: resolved.user.email,
    display_name: resolved.user.display_name,
    tenant_id: resolved.membership?.tenant_id || tenantId,
    role: resolved.membership?.role || null,
    tenant_display_name: resolved.membership?.tenant_display_name || null,
  };
}

export async function startDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const body = req.body || {};
    const hostname = cleanText(body.hostname || body.device_name || "", 255);
    const deviceId = cleanId(body.device_id, { fallback: cleanId(hostname, { fallback: `device-${crypto.randomUUID().slice(0, 8)}` }), max: 128 });
    const platform = cleanText(body.platform || "windows", 32) || "windows";
    const appVersion = cleanText(body.app_version || "", 80);
    const displayCode = randomDisplayCode();
    const pollToken = randomToken(32);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(nowMs() + DEVICE_LINK_TTL_SECONDS * 1000);
    const metadata = {
      source: "local_manager_windows_app",
      user_agent: cleanText(req.get("user-agent") || "", 255),
      ip_seen: cleanText(req.ip || req.socket?.remoteAddress || "", 64),
    };

    await getPool().query(
      `INSERT INTO \`local_manager_device_link_sessions\`
        (session_id, display_code, display_code_hash, poll_token_hash, status, device_id, hostname, platform, app_version, expires_at, metadata_json)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [sessionId, displayCode, sha256(displayCode), sha256(pollToken), deviceId, hostname || null, platform, appVersion || null, expiresAt, jsonString(metadata)]
    );

    const verificationUri = `${getBaseUrl(req)}/app/local-manager/link-device?code=${encodeURIComponent(displayCode)}`;
    return res.status(201).json({
      ok: true,
      session_id: sessionId,
      device_code: displayCode,
      user_code: displayCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUri,
      expires_in: DEVICE_LINK_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
      poll_token: pollToken,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_start_failed", message: err.message }, secrets_included: false });
  }
}

export async function previewDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const displayCode = cleanText(req.query?.code || req.query?.device_code || req.query?.user_code, 16).toUpperCase();
    if (!displayCode) {
      return res.status(400).json({ ok: false, error: { code: "missing_device_code", message: "A pairing code is required." }, secrets_included: false });
    }
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing code was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs() && row.status === "pending") {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ?`, [row.session_id]);
      row.status = "expired";
    }
    const safe = sanitizeSession(row);
    delete safe.user_id;
    delete safe.tenant_id;
    return res.status(200).json({ ok: true, status: safe.status, device: safe, secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_preview_failed", message: err.message }, secrets_included: false });
  }
}

export async function pollDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    const pollToken = cleanText(req.body?.poll_token, 200);
    if (!displayCode || !pollToken) {
      return res.status(400).json({ ok: false, error: { code: "missing_poll_fields", message: "device_code and poll_token are required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row || row.poll_token_hash !== sha256(pollToken)) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing session was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs() && row.status === "pending") {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ?`, [row.session_id]);
      return res.status(410).json({ ok: false, status: "expired", error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status === "pending") {
      return res.status(202).json({ ok: true, status: "pending", interval: POLL_INTERVAL_SECONDS, expires_at: new Date(row.expires_at).toISOString(), secrets_included: false });
    }
    if (row.status !== "approved") {
      return res.status(200).json({ ok: true, status: row.status, device: sanitizeSession(row), secrets_included: false });
    }
    if (row.completed_at) {
      return res.status(200).json({ ok: true, status: "completed", device: sanitizeSession(row), secrets_included: false });
    }

    const deviceAccessToken = jwt.sign(
      {
        purpose: "local_manager_device_access",
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        device_id: row.device_id,
        session_id: row.session_id,
        scope: "local_manager.device",
      },
      JWT_SECRET,
      { expiresIn: DEVICE_TOKEN_TTL_SECONDS, jwtid: crypto.randomUUID() }
    );
    await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\` SET status = 'completed', completed_at = NOW() WHERE session_id = ?`,
      [row.session_id]
    );
    return res.status(200).json({
      ok: true,
      status: "approved",
      device_access_token: deviceAccessToken,
      token_type: "Bearer",
      expires_in: DEVICE_TOKEN_TTL_SECONDS,
      device: sanitizeSession({ ...row, status: "completed", completed_at: new Date() }),
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_poll_failed", message: err.message }, secrets_included: false });
  }
}

export async function approveDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const principal = await requireLocalManagerUser(req);
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    if (!displayCode) {
      return res.status(400).json({ ok: false, error: { code: "missing_device_code", message: "A pairing code is required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing code was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs()) {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ? AND status = 'pending'`, [row.session_id]);
      return res.status(410).json({ ok: false, error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status !== "pending") {
      const sameOwner = row.user_id === principal.user_id && (!row.tenant_id || !principal.tenant_id || row.tenant_id === principal.tenant_id);
      if (sameOwner && ["approved", "completed"].includes(row.status)) {
        const connectorAlias = await ensureLocalConnectorAliasForDeviceLink({ session: row, principal });
        return res.status(200).json({
          ok: true,
          status: row.status,
          already_linked: true,
          user: principal,
          device: sanitizeSession(row),
          connector_alias: connectorAlias,
          message: "This pairing code was already approved for your account.",
          secrets_included: false,
        });
      }
      return res.status(409).json({ ok: false, status: row.status, error: { code: "device_link_not_pending", message: "Pairing code is no longer pending." }, secrets_included: false });
    }

    const [existingRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE device_id = ?
          AND user_id = ?
          AND (? IS NULL OR tenant_id = ?)
          AND status IN ('approved','completed')
        ORDER BY COALESCE(completed_at, approved_at, created_at) DESC
        LIMIT 1`,
      [row.device_id, principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    const existingLinked = existingRows[0] || null;

    await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\`
          SET status = 'approved', user_id = ?, tenant_id = ?, approved_at = NOW()
        WHERE session_id = ? AND status = 'pending'`,
      [principal.user_id, principal.tenant_id, row.session_id]
    );
    const approved = { ...row, status: "approved", user_id: principal.user_id, tenant_id: principal.tenant_id, approved_at: new Date() };
    const connectorAlias = await ensureLocalConnectorAliasForDeviceLink({ session: approved, principal });
    return res.status(200).json({
      ok: true,
      status: "approved",
      already_linked: Boolean(existingLinked),
      reauthorized_existing_device: Boolean(existingLinked),
      user: principal,
      device: sanitizeSession(approved),
      connector_alias: connectorAlias,
      message: existingLinked
        ? "This device was already linked for your account. The current app session was re-authorized."
        : undefined,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_approve_failed", message: err.message }, secrets_included: false });
  }
}

export async function listLinkedDevices(req, res) {
  try {
    await ensureDeviceLinkTable();
    const principal = await requireLocalManagerUser(req);
    const [linkRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE user_id = ? AND (? IS NULL OR tenant_id = ?)
        ORDER BY COALESCE(completed_at, approved_at, created_at) DESC
        LIMIT 50`,
      [principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    return res.status(200).json({ ok: true, user: principal, devices: linkRows.map(sanitizeSession), secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_list_failed", message: err.message }, secrets_included: false });
  }
}

export async function requireLocalManagerDevice(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    const err = new Error("A linked device token is required.");
    err.status = 401;
    err.code = "device_token_required";
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error("Device token is invalid or expired.");
    err.status = 401;
    err.code = "invalid_device_token";
    throw err;
  }

  if (payload.purpose !== "local_manager_device_access" || payload.scope !== "local_manager.device") {
    const err = new Error("Token is not a Local Manager device token.");
    err.status = 403;
    err.code = "wrong_token_scope";
    throw err;
  }

  const device = {
    user_id: cleanText(payload.user_id, 64),
    tenant_id: cleanText(payload.tenant_id, 64) || null,
    device_id: cleanText(payload.device_id, 128),
    session_id: cleanText(payload.session_id, 64),
  };
  if (!device.user_id || !device.device_id || !device.session_id) {
    const err = new Error("Device token is missing required claims.");
    err.status = 401;
    err.code = "invalid_device_token_claims";
    throw err;
  }

  await ensureDeviceLinkTable();
  const [rows] = await getPool().query(
    `SELECT * FROM \`local_manager_device_link_sessions\`
      WHERE session_id = ? AND device_id = ? AND user_id = ? AND status IN ('approved','completed')
      LIMIT 1`,
    [device.session_id, device.device_id, device.user_id]
  );
  const row = rows[0] || null;
  if (!row) {
    const err = new Error("Linked device session was not found.");
    err.status = 403;
    err.code = "device_session_not_found";
    throw err;
  }
  return { ...device, session: sanitizeSession(row) };
}

export async function getDeviceSession(req, res) {
  try {
    const device = await requireLocalManagerDevice(req);
    return res.status(200).json({
      ok: true,
      device,
      controls: {
        devices: "/local-manager/device/session",
        routes: "/local-manager/device/controls?section=routes",
        backups: "/local-manager/device/controls?section=backups",
        repairs: "/local-manager/device/controls?section=repairs",
        n8n: "/local-manager/device/controls?section=n8n",
        connector_repair_installer: "/local-connector/install/device-download-link",
        settings: "/local-manager/device/controls?section=settings",
      },
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_session_failed", message: err.message }, secrets_included: false });
  }
}

export async function getDeviceControls(req, res) {
  try {
    const device = await requireLocalManagerDevice(req);
    const section = cleanText(req.query.section || "overview", 32) || "overview";
    const allowedSections = new Set(["overview", "routes", "backups", "repairs", "n8n", "settings"]);
    if (!allowedSections.has(section)) {
      return res.status(400).json({ ok: false, error: { code: "invalid_control_section", message: "Unsupported device control section." }, secrets_included: false });
    }

    const baseControls = {
      overview: {
        label: "Device overview",
        actions: ["view_link_status", "open_dashboard", "check_update"],
        destructive_actions_enabled: false,
      },
      routes: {
        label: "Routes",
        actions: ["view_route_health", "view_selected_route"],
        write_actions_enabled: false,
        note: "Route mutations remain admin-governed until consent and entitlement checks are complete.",
      },
      backups: {
        label: "Backups and DR",
        actions: ["view_backup_policy_status", "view_restore_probe_readiness"],
        write_actions_enabled: false,
        note: "Restore probes require upgraded local connector aliases before execution.",
      },
      repairs: {
        label: "Connector repairs",
        actions: ["request_connector_upgrade_installer", "download_signed_installer", "run_installer_as_administrator", "verify_connector_policy"],
        write_actions_enabled: true,
        endpoint: "/local-connector/install/device-download-link",
        default_format: "bat",
        elevation_required: true,
        note: "Local Manager should call the endpoint with its device token, download the signed installer, elevate locally, run it, then verify /policy and alias refresh.",
      },
      repairs: {
        label: "Connector repairs",
        actions: ["request_connector_upgrade_installer", "download_signed_installer", "run_installer_as_administrator", "verify_connector_policy"],
        write_actions_enabled: true,
        endpoint: "/local-connector/install/device-download-link",
        default_format: "bat",
        elevation_required: true,
        note: "Local Manager should call the endpoint with its device token, download the signed installer, elevate locally, run it, then verify /policy and alias refresh.",
      },
      n8n: {
        label: "Local n8n",
        actions: ["resolve_connected_system_profile", "install_node_if_missing", "install_n8n_if_missing", "write_tenant_start_script", "start_local_n8n", "open_local_or_public_url", "validate_local_reachability"],
        write_actions_enabled: true,
        autopilot_enabled: true,
        local_only_default: true,
        requires_device_token: true,
        requires_tenant_membership: true,
        credential_policy: "No n8n API key is required for local start. API keys are optional and must be stored separately as credential_refs.",
        note: "Local Manager should use the returned profile. It may install Node/n8n locally, create the tenant data folder, write a start script, and launch n8n on 127.0.0.1.",
      },
      settings: {
        label: "Settings",
        actions: ["view_device_identity", "view_token_storage_status", "open_account_settings"],
        write_actions_enabled: false,
      },
    };

    const n8nConnector = section === "n8n" ? await resolveOrCreateTenantN8nProfile(device) : null;
    return res.status(200).json({
      ok: true,
      section,
      device,
      controls: baseControls[section],
      n8n_connector: n8nConnector,
      token_scope: "local_manager.device",
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_controls_failed", message: err.message }, secrets_included: false });
  }
}
